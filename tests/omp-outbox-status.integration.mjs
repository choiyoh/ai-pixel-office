import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  openOmpOutbox,
  replayOmpOutbox,
  readOmpOutboxStatus,
} from "../platform/omp-outbox.mjs";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import { createApp } from "../server/app.mjs";
import { ompStreamEvent, ompExitEvent } from "../server/bridge/omp.mjs";

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-outbox-status-")),
    directory = path.join(root, "omp-outbox"),
    bridgeDirectory = path.join(root, "provider-bridge-omp");
  let app;
  const start = async (hook) => {
    app = await createProviderBridgeApp({
      stateDir: bridgeDirectory,
      providers: ["omp"],
      source: "fixture",
    });
    if (hook) hook(app.app);
    await app.listen(0);
  };
  const close = async () => {
    await app?.app.close();
    app = null;
  };
  await start();
  return {
    root,
    directory,
    bridgeDirectory,
    start,
    close,
    status: () => readOmpOutboxStatus({ directory, bridgeDirectory }),
    cleanup: async () => {
      await close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function events(installationInstanceId) {
  const ctx = {
    installationInstanceId,
    nativeSessionId: "a".repeat(64),
    executionId: randomUUID(),
    logicalTaskId: randomUUID(),
    startSource: "startup",
    modelFamily: "deepseek",
    modelProvider: "commandcode",
  };
  let sequence = 0;
  const meta = () => ({
    ...ctx,
    eventId: randomUUID(),
    sequence: ++sequence,
    occurredAt: new Date().toISOString(),
  });
  return [
    ompStreamEvent({ type: "session" }, meta()),
    ompStreamEvent(
      {
        type: "tool_execution_start",
        toolName: "read",
        toolCallId: "PRIVATE-NATIVE-CALL|raw",
      },
      meta(),
    ),
    ompStreamEvent(
      {
        type: "tool_execution_end",
        toolName: "read",
        toolCallId: "PRIVATE-NATIVE-CALL|raw",
        isError: false,
      },
      meta(),
    ),
    ompStreamEvent({ type: "agent_end" }, meta()),
    ompExitEvent(meta(), { exitCode: 0 }),
  ];
}

async function enqueue(f) {
  const outbox = openOmpOutbox({
    directory: f.directory,
    bridgeDirectory: f.bridgeDirectory,
  });
  const list = events(outbox.installationInstanceId);
  for (const event of list) await outbox.send(event);
}

const tree = (directory) =>
  fs
    .readdirSync(directory)
    .sort()
    .flatMap((n) => {
      const p = path.join(directory, n);
      return fs.statSync(p).isDirectory()
        ? fs.readdirSync(p)
            .sort()
            .map((c) => `${n}/${c}`)
        : [n];
    });

test("read-only status reports queue depth, capacity and writers without touching files", async () => {
  const f = await setup();
  try {
    await enqueue(f);
    const before = tree(f.directory);
    const status = f.status();
    assert.equal(status.prepared, true);
    assert.equal(status.enrolled, true);
    assert.equal(status.pending, 5);
    assert.equal(status.retainedRuns, 1);
    assert.equal(status.capacityRemaining, 1023);
    assert.equal(status.blockedRuns, 0);
    assert.equal(status.installationMismatch, false);
    assert.equal(status.registry, "alive");
    assert.deepEqual(status.writers, [
      { run: "run-0000", pid: process.pid, alive: true },
    ]);
    assert.equal(status.lastRejection, null);
    assert.equal(status.recoveryRequired, false);
    assert.deepEqual(tree(f.directory), before);
    // Only enum/count fields may leave the private queue: no key, token,
    // prompt, path, or raw native identifier is part of the status.
    const text = JSON.stringify(status);
    assert.ok(!/token|secret|PRIVATE|nativeSession|a{64}/.test(text));
  } finally {
    await f.cleanup();
  }
});

test("an absent outbox reports unprepared without creating anything", async () => {
  const f = await setup();
  try {
    const status = f.status();
    assert.equal(status.prepared, false);
    assert.equal(status.enrolled, false);
    assert.equal(status.pending, 0);
    assert.equal(status.capacityRemaining, 1024);
    assert.equal(status.registry, "alive");
    assert.equal(fs.existsSync(f.directory), false);
  } finally {
    await f.cleanup();
  }
});

test("registry missing, stale and installation mismatch are reported but never repaired", async () => {
  const f = await setup();
  try {
    await enqueue(f);
    const registry = path.join(f.bridgeDirectory, "runtime", "omp.json");
    const current = JSON.parse(fs.readFileSync(registry, "utf8"));
    const original = fs.readFileSync(registry, "utf8");
    assert.equal(f.status().registry, "alive");
    assert.equal(f.status().installationMismatch, false);
    // A live registry enrolled to a different installation is a mismatch.
    fs.writeFileSync(
      registry,
      JSON.stringify({ ...current, installationInstanceId: randomUUID() }),
      { mode: 0o600 },
    );
    const mismatch = f.status();
    assert.equal(mismatch.registry, "alive");
    assert.equal(mismatch.installationMismatch, true);
    assert.equal(mismatch.pending, 5);
    // A registry whose process is gone is stale, not alive.
    fs.writeFileSync(registry, JSON.stringify({ ...current, pid: 999999 }), {
      mode: 0o600,
    });
    const stale = f.status();
    assert.equal(stale.registry, "stale");
    assert.equal(stale.installationMismatch, false);
    // Restore and verify the queue itself was never rewritten by a probe.
    fs.writeFileSync(registry, original, { mode: 0o600 });
    const restored = f.status();
    assert.equal(restored.registry, "alive");
    assert.equal(restored.pending, 5);
    assert.equal(
      fs.readFileSync(registry, "utf8").includes(current.token),
      true,
    );
  } finally {
    await f.cleanup();
  }
});

test("a corrupted run is reported as blocked and is never repaired", async () => {
  const f = await setup();
  try {
    await enqueue(f);
    const run = path.join(f.directory, "run-0000");
    fs.writeFileSync(path.join(run, "junk.txt"), "x", { mode: 0o600 });
    const status = f.status();
    assert.equal(status.blockedRuns, 1);
    assert.equal(status.pending, 0);
    assert.equal(status.retainedRuns, 1);
    assert.equal(fs.existsSync(path.join(run, "junk.txt")), true);
    assert.equal(status.writers.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("receiver rejection is recorded as an advisory note and reported read-only", async () => {
  const f = await setup();
  try {
    await enqueue(f);
    await f.close();
    await f.start((app) =>
      app.addHook("onRequest", async (request, reply) => {
        if (request.url.endsWith("/batch"))
          return reply.code(429).send({ error: "capacity" });
      }),
    );
    const result = await replayOmpOutbox({
      directory: f.directory,
      bridgeDirectory: f.bridgeDirectory,
    });
    assert.equal(result.rejected, true);
    assert.equal(result.lastStatus, 429);
    const file = path.join(f.directory, "last-rejection.json");
    const note = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(note).sort(), ["at", "statusCode", "version"]);
    assert.equal(note.statusCode, 429);
    const status = f.status();
    assert.equal(status.pending, 5);
    assert.deepEqual(status.lastRejection, {
      at: note.at,
      statusCode: 429,
    });
    // The note is advisory: the same bounded replay can still recover.
    await f.close();
    await f.start();
    assert.equal(
      (
        await replayOmpOutbox({
          directory: f.directory,
          bridgeDirectory: f.bridgeDirectory,
        })
      ).pending,
      0,
    );
    assert.equal(f.status().lastRejection.statusCode, 429);
  } finally {
    await f.cleanup();
  }
});

test("recoveryRequired appears only when queued work remains with no producer and a reachable bridge", async () => {
  const f = await setup();
  try {
    await enqueue(f);
    // The test process still owns the run: no recovery hint while a producer lives.
    assert.equal(f.status().recoveryRequired, false);
    const ownerFile = path.join(f.directory, "run-0000", "owner.json");
    const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
    fs.writeFileSync(ownerFile, JSON.stringify({ ...owner, pid: 999999 }), {
      mode: 0o600,
    });
    const stopped = f.status();
    assert.equal(stopped.writers[0].alive, false);
    assert.equal(stopped.recoveryRequired, true);
    // An installation mismatch must never look like a drainable queue.
    const registry = path.join(f.bridgeDirectory, "runtime", "omp.json");
    const current = JSON.parse(fs.readFileSync(registry, "utf8"));
    fs.writeFileSync(
      registry,
      JSON.stringify({ ...current, installationInstanceId: randomUUID() }),
      { mode: 0o600 },
    );
    assert.equal(f.status().recoveryRequired, false);
    fs.writeFileSync(registry, JSON.stringify(current), { mode: 0o600 });
    // Draining the queue clears the hint even though the note stays.
    assert.equal(
      (
        await replayOmpOutbox({
          directory: f.directory,
          bridgeDirectory: f.bridgeDirectory,
        })
      ).pending,
      0,
    );
    assert.equal(f.status().recoveryRequired, false);
  } finally {
    await f.cleanup();
  }
});

test("the office exposes the outbox status through a cookie protected read-only route", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-outbox-route-"));
  let office;
  try {
    office = await createApp({
      mode: "claude-local",
      source: "fixture",
      stateDir: root,
    });
    await office.listen(0);
    const base = `http://127.0.0.1:${office.app.server.address().port}`;
    assert.equal((await fetch(base + "/api/omp/outbox")).status, 401);
    const response = await fetch(base),
      cookie = response.headers.get("set-cookie").split(";")[0];
    const first = await fetch(base + "/api/omp/outbox", {
      headers: { cookie },
    });
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.ready, true);
    assert.equal(body.prepared, false);
    assert.equal(body.enrolled, false);
    assert.equal(body.pending, 0);
    assert.equal(body.capacityRemaining, 1024);
    assert.equal(body.recoveryRequired, false);
    const text = JSON.stringify(body);
    assert.ok(!text.includes(root));
    assert.ok(!/token|secret/i.test(text));
  } finally {
    await office?.app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
