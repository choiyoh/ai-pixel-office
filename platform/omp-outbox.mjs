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
    // A stored session may be resumed: the observer only marks resume runs
    // from reviewed launch arguments, so both sources are valid here while
    // anything else stays refused.
    (e.kind === "session.start" &&
      !["startup", "resume"].includes(e.startSource)) ||
    !hex(e.nativeSessionId) ||
    e.parentTaskId !== undefined ||
    e.delegationId !== undefined ||
    (e.parentExecution !== undefined && e.kind !== "session.start")
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
// A resume must continue a session this queue already observed; otherwise the
// queue would be inventing a history it never saw.
function observedSession(directory, nativeSessionId) {
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!/^run-\d{4}$/.test(name)) continue;
    try {
      if (
        ownerRecord(path.join(directory, name)).nativeSessionId ===
        nativeSessionId
      )
        return true;
    } catch {
      /* An unreadable run is not evidence of the session. */
    }
  }
  return false;
}
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
        if (
          e.startSource === "resume" &&
          !observedSession(directory, e.nativeSessionId)
        )
          fail();
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
  maxMs = 30000,
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
          Math.min(8, maxEvents - result.delivered),
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
            try {
              recordRejection(directory, error.statusCode);
            } catch {
              /* The rejection note is advisory; pending events are retained. */
            }
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
// The last receiver rejection is an advisory operator note. It carries a
// status code and time only: never prompts, credentials, or event payloads.
function recordRejection(directory, statusCode) {
  const bytes = Buffer.from(
    JSON.stringify({ version: 1, at: new Date().toISOString(), statusCode }),
  );
  const temp = path.join(directory, "." + randomUUID() + ".tmp");
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, path.join(directory, "last-rejection.json"));
    syncDir(directory);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
// Distinguish a live, dead, and absent registry without opening a transport.
function probeRegistry(bridgeDirectory) {
  const probe = { state: "missing", installationInstanceId: null };
  try {
    const file = path.join(bridgeDirectory, "runtime/omp.json");
    if (!fs.existsSync(file)) return probe;
    if (assertPrivate(file).size > 4096) return probe;
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      r.providerId !== "omp" ||
      !uuid(r.installationInstanceId) ||
      !Number.isInteger(r.pid) ||
      r.pid <= 0
    )
      return probe;
    probe.installationInstanceId = r.installationInstanceId;
    probe.state = alive(r.pid) ? "alive" : "stale";
  } catch {
    /* An unreadable registry is reported as missing, never modified. */
  }
  return probe;
}
// Read-only queue status for operators and the office UI. It never sends,
// deletes, or creates events; counts are filename-level and a corrupted run
// is reported through blockedRuns instead of being repaired.
export function readOmpOutboxStatus({ directory, bridgeDirectory } = {}) {
  const status = {
    version: 1,
    prepared: false,
    enrolled: false,
    pending: 0,
    retainedRuns: 0,
    capacityRemaining: 1024,
    blockedRuns: 0,
    installationMismatch: false,
    registry: "missing",
    writers: [],
    lastRejection: null,
    recoveryRequired: false,
  };
  const registry = probeRegistry(bridgeDirectory);
  status.registry = registry.state;
  if (typeof directory !== "string" || !fs.existsSync(directory)) return status;
  assertPrivate(directory, { directory: true });
  status.prepared = true;
  const bindingFile = path.join(directory, "binding.json");
  let b = null;
  if (fs.existsSync(bindingFile)) {
    b = binding(directory, null, false);
    status.enrolled = true;
  }
  if (
    b &&
    registry.state === "alive" &&
    registry.installationInstanceId !== b.installationInstanceId
  )
    status.installationMismatch = true;
  try {
    const r = read(path.join(directory, "last-rejection.json"));
    if (
      Object.keys(r).sort().join() === "at,statusCode,version" &&
      r.version === 1 &&
      typeof r.at === "string" &&
      Number.isFinite(Date.parse(r.at)) &&
      Number.isInteger(r.statusCode) &&
      r.statusCode >= 400 &&
      r.statusCode < 500
    )
      status.lastRejection = { at: r.at, statusCode: r.statusCode };
  } catch {
    /* A missing or malformed note is simply not reported. */
  }
  let runs = [];
  try {
    runs = slots(directory);
  } catch {
    return status;
  }
  for (const name of runs) {
    try {
      const run = path.join(directory, name);
      assertPrivate(run, { directory: true });
      const owner = ownerRecord(run);
      const pending = entries(run);
      if (pending.length > 128) fail();
      status.pending += pending.length;
      status.writers.push({
        run: name,
        pid: owner.pid,
        alive: alive(owner.pid),
      });
    } catch (error) {
      if (error.code !== "ENOENT") status.blockedRuns++;
    }
  }
  status.retainedRuns = runs.length;
  status.capacityRemaining = 1024 - runs.length;
  // Bounded recovery signal: queued work exists, the bridge is reachable and
  // enrolled to this queue, and no producer still owns a run. This is a hint
  // for the explicit `npm run omp:replay` command; no daemon acts on it.
  status.recoveryRequired =
    status.pending > 0 &&
    status.registry === "alive" &&
    !status.installationMismatch &&
    status.writers.every((w) => !w.alive);
  return status;
}
// Explicit, operator-invoked maintenance: move fully delivered runs into a
// private archive so the 1024-slot budget can be reused. Nothing is deleted;
// incomplete, pending, blocked, or writer-owned runs are retained and
// reported. Safety first: an unenrolled queue or a conflicting live
// installation always refuses.
export function archiveOmpOutboxRuns({ directory, bridgeDirectory, apply = false } = {}) {
  const report = {
    enabled: apply === true,
    prepared: false,
    scannedRuns: 0,
    archivableRuns: [],
    archivedRuns: [],
    retainedPending: [],
    retainedIncomplete: [],
    retainedWriters: [],
    retainedBlocked: [],
    archiveDirectory: null,
  };
  if (typeof directory !== "string" || !fs.existsSync(directory)) return report;
  assertPrivate(directory, { directory: true });
  report.prepared = true;
  if (!fs.existsSync(path.join(directory, "binding.json"))) fail();
  const b = binding(directory, null, false);
  const registry = probeRegistry(bridgeDirectory);
  if (
    registry.state === "alive" &&
    registry.installationInstanceId !== b.installationInstanceId
  )
    fail();
  const runs = slots(directory);
  report.scannedRuns = runs.length;
  for (const name of runs) {
    const run = path.join(directory, name);
    let owner, files;
    try {
      assertPrivate(run, { directory: true });
      owner = ownerRecord(run);
      files = entries(run);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      report.retainedBlocked.push(name);
      continue;
    }
    if (files.length) {
      report.retainedPending.push(name);
      continue;
    }
    if (alive(owner.pid)) {
      report.retainedWriters.push(name);
      continue;
    }
    // Without the completion marker a forced stop left this execution
    // unverified; it stays in place instead of being guessed complete.
    let marker = null;
    try {
      marker = read(path.join(run, "complete.json"));
    } catch {
      marker = null;
    }
    if (
      !marker ||
      Object.keys(marker).sort().join() !== "executionId,finalSequence,version" ||
      marker.version !== 1 ||
      marker.executionId !== owner.executionId ||
      !Number.isSafeInteger(marker.finalSequence) ||
      marker.finalSequence < 1 ||
      marker.finalSequence > 128
    ) {
      report.retainedIncomplete.push(name);
      continue;
    }
    report.archivableRuns.push(name);
  }
  if (!apply || !report.archivableRuns.length) return report;
  const archiveRoot = path.join(directory, "archive");
  ensurePrivateDirectory(archiveRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(archiveRoot, stamp);
  fs.mkdirSync(target, { mode: 0o700 });
  ensurePrivateDirectory(target);
  for (const name of report.archivableRuns) {
    fs.renameSync(path.join(directory, name), path.join(target, name));
    report.archivedRuns.push(name);
  }
  syncDir(archiveRoot);
  syncDir(target);
  report.archiveDirectory = path.join("archive", stamp);
  return report;
}
