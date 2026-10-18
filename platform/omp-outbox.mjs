import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { ensurePrivateDirectory, assertPrivate } from "./private-files.mjs";
import { readOmpTransport } from "./omp-outbox-transport.mjs";
import { parseBridgeEvent, uuid } from "../server/bridge/schema.mjs";
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const fail = () => {
  throw Error("Private OMP outbox unavailable");
};
const syncDir = (directory) => {
  if (process.platform === "win32") return;
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};
// Publish only complete fsynced bytes, without replacing an existing identity.
function publish(file, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 8192) fail();
  const temp = path.join(path.dirname(file), "." + randomUUID() + ".tmp");
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.linkSync(temp, file);
    syncDir(path.dirname(file));
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function read(file) {
  if (assertPrivate(file).size > 8192) fail();
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function binding(directory, transport, create) {
  const file = path.join(directory, "binding.json");
  if (!fs.existsSync(file)) {
    if (!create || !uuid(transport?.installationInstanceId)) fail();
    try {
      publish(file, {
        version: 1,
        installationInstanceId: transport.installationInstanceId,
        key: randomBytes(32).toString("hex"),
      });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  const b = read(file);
  if (
    Object.keys(b).sort().join() !== "installationInstanceId,key,version" ||
    b.version !== 1 ||
    !uuid(b.installationInstanceId) ||
    !hex(b.key)
  )
    fail();
  if (
    transport &&
    transport.installationInstanceId !== b.installationInstanceId
  )
    fail();
  return b;
}
function canonical(event, b) {
  const { event: e } = parseBridgeEvent(event, {
    providerId: "omp",
    installationInstanceId: b.installationInstanceId,
    roles: ["executor"],
  });
  if (
    e.providerId !== "omp" ||
    e.actorRole !== "executor" ||
    (e.kind === "session.start" && e.startSource !== "startup") ||
    !hex(e.nativeSessionId) ||
    e.parentTaskId !== undefined ||
    e.delegationId !== undefined
  )
    fail();
  return e;
}
function row(file, b, owner) {
  const r = read(file);
  if (
    Object.keys(r).sort().join() !== "digest,event,version" ||
    r.version !== 1 ||
    !hex(r.digest)
  )
    fail();
  const e = canonical(r.event, b);
  if (
    hash(e) !== r.digest ||
    e.executionId !== owner.executionId ||
    e.nativeSessionId !== owner.nativeSessionId ||
    e.logicalTaskId !== owner.logicalTaskId ||
    e.sequence < 1 ||
    e.sequence > 128 ||
    (e.nativeToolCallId !== undefined && !hex(e.nativeToolCallId)) ||
    path.basename(file) !== eventName(e)
  )
    fail();
  return e;
}
const eventName = (e) =>
  `${String(e.sequence).padStart(7, "0")}-${e.eventId}.event.json`;
function ownerRecord(directory) {
  const o = read(path.join(directory, "owner.json"));
  if (
    Object.keys(o).sort().join() !==
      "executionId,logicalTaskId,nativeSessionId,pid,version" ||
    o.version !== 1 ||
    !uuid(o.executionId) ||
    !uuid(o.logicalTaskId) ||
    !hex(o.nativeSessionId) ||
    !Number.isInteger(o.pid) ||
    o.pid < 1
  )
    fail();
  return o;
}
function slots(directory) {
  return fs
    .readdirSync(directory)
    .filter((n) => /^run-\d{4}$/.test(n) && Number(n.slice(4)) < 1024)
    .sort();
}
const entries = (directory) => {
  const names = fs.readdirSync(directory),
    event = /^\d{7}-[a-f0-9-]{36}\.event\.json$/;
  if (
    names.some(
      (n) =>
        !["owner.json", "complete.json"].includes(n) &&
        !event.test(n) &&
        !/^\.[a-f0-9-]{36}\.tmp$/.test(n),
    )
  )
    fail();
  return names.filter((n) => event.test(n)).sort();
};

export function openOmpOutbox({
  directory,
  bridgeDirectory,
  onQueued = () => {},
}) {
  ensurePrivateDirectory(directory);
  const initial = readOmpTransport({ directory: bridgeDirectory }),
    b = binding(directory, initial, true);
  let run = null,
    owner = null,
    lastSequence = 0,
    closed = false;
  const seen = new Set();
  return {
    durable: true,
    installationInstanceId: b.installationInstanceId,
    async send(raw) {
      const e = canonical(raw, b);
      if (e.nativeToolCallId !== undefined)
        e.nativeToolCallId = createHmac("sha256", b.key)
          .update(e.nativeToolCallId)
          .digest("hex");
      if (
        closed ||
        e.sequence !== lastSequence + 1 ||
        e.sequence > 128 ||
        seen.has(e.eventId)
      )
        fail();
      if (!run) {
        if (e.kind !== "session.start" || e.sequence !== 1) fail();
        for (let i = 0; i < 1024; i++) {
          const candidate = path.join(
            directory,
            `run-${String(i).padStart(4, "0")}`,
          );
          try {
            fs.mkdirSync(candidate, { mode: 0o700 });
            run = candidate;
            break;
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
          }
        }
        if (!run) fail();
        ensurePrivateDirectory(run);
        owner = {
          version: 1,
          pid: process.pid,
          executionId: e.executionId,
          nativeSessionId: e.nativeSessionId,
          logicalTaskId: e.logicalTaskId,
        };
        publish(path.join(run, "owner.json"), owner);
      }
      if (
        e.executionId !== owner.executionId ||
        e.nativeSessionId !== owner.nativeSessionId ||
        e.logicalTaskId !== owner.logicalTaskId
      )
        fail();
      const record = { version: 1, event: e, digest: hash(e) };
      if (Buffer.byteLength(JSON.stringify(record)) > 2048) fail();
      publish(path.join(run, eventName(e)), record);
      lastSequence = e.sequence;
      seen.add(e.eventId);
      if (e.kind === "execution.end") {
        closed = true;
        publish(path.join(run, "complete.json"), {
          version: 1,
          executionId: e.executionId,
          finalSequence: e.sequence,
        });
      }
      try {
        onQueued();
      } catch {
        /* A worker failure cannot undo the durable event. */
      }
      return { accepted: true, disposition: "queued" };
    },
  };
}
// Multiple workers are safe: immutable event identities and receiver receipts,
// rather than a PID lease, arbitrate duplicate deliveries after a crash.
export async function replayOmpOutbox({
  directory,
  bridgeDirectory,
  maxMs = 10000,
  maxEvents = 256,
} = {}) {
  const result = {
    delivered: 0,
    duplicateReceipts: 0,
    pending: 0,
    blockedRuns: 0,
    retainedRuns: 0,
    capacityRemaining: 1024,
    offline: false,
    rejected: false,
    lastStatus: null,
    installationMismatch: false,
  };
  if (!fs.existsSync(directory)) return result;
  assertPrivate(directory, { directory: true });
  const b = binding(directory, null, false),
    deadline = Date.now() + maxMs;
  for (const name of slots(directory)) {
    if (Date.now() > deadline || result.delivered >= maxEvents) break;
    const run = path.join(directory, name);
    try {
      assertPrivate(run, { directory: true });
      const owner = ownerRecord(run);
      let files = entries(run);
      if (files.length > 128) fail();
      while (
        files.length &&
        Date.now() < deadline &&
        result.delivered < maxEvents
      ) {
        const transport = readOmpTransport({ directory: bridgeDirectory });
        if (!transport) {
          result.offline = true;
          break;
        }
        if (transport.installationInstanceId !== b.installationInstanceId) {
          result.installationMismatch = true;
          break;
        }
        const loaded = [];
        for (const name of files.slice(
          0,
          Math.min(64, maxEvents - result.delivered),
        )) {
          if (Date.now() > deadline) break;
          try {
            loaded.push({
              file: path.join(run, name),
              event: row(path.join(run, name), b, owner),
            });
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
        if (!loaded.length) break;
        let ack;
        try {
          ack = await transport.sendBatch(loaded.map((x) => x.event));
        } catch (error) {
          if (
            Number.isInteger(error.statusCode) &&
            error.statusCode >= 400 &&
            error.statusCode < 500
          ) {
            result.rejected = true;
            result.lastStatus = error.statusCode;
          } else result.offline = true;
          break;
        }
        if (
          ack?.accepted !== true ||
          !Array.isArray(ack.receipts) ||
          ack.receipts.length !== loaded.length
        )
          fail();
        // Validate every ack before deleting any event in this response.
        if (
          !ack.receipts.every(
            (r, i) =>
              r.eventId === loaded[i].event.eventId &&
              r.accepted === true &&
              r.disposition === "committed" &&
              Number.isSafeInteger(r.nextSequence) &&
              r.nextSequence > loaded[i].event.sequence &&
              Number.isSafeInteger(r.revision) &&
              r.revision > 0,
          )
        )
          fail();
        result.duplicateReceipts += ack.receipts.filter(
          (r) => r.duplicate === true,
        ).length;
        for (const item of loaded) {
          try {
            fs.unlinkSync(item.file);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          result.delivered++;
        }
        syncDir(run);
        files = entries(run);
      }
      // Retain immutable owner/completion markers. Slots are never reused by
      // workers, so a late duplicate ack cannot erase a newer producer's files.
    } catch (error) {
      if (error.code !== "ENOENT") result.blockedRuns++;
    }
  }
  // A bounded scan reports pending work; never silently discard unknown files.
  result.retainedRuns = slots(directory).length;
  result.capacityRemaining = 1024 - result.retainedRuns;
  for (const name of slots(directory))
    try {
      result.pending += entries(path.join(directory, name)).length;
    } catch (e) {
      if (e.code !== "ENOENT") result.blockedRuns++;
    }
  return result;
}
