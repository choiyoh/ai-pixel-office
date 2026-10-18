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
  archiveOmpOutboxRuns,
} from "../platform/omp-outbox.mjs";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import { ompStreamEvent, ompExitEvent } from "../server/bridge/omp.mjs";

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-outbox-archive-")),
    directory = path.join(root, "omp-outbox"),
    bridgeDirectory = path.join(root, "provider-bridge-omp");
  let app;
  const start = async () => {
    app = await createProviderBridgeApp({
      stateDir: bridgeDirectory,
      providers: ["omp"],
      source: "fixture",
    });
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
    close,
    status: () => readOmpOutboxStatus({ directory, bridgeDirectory }),
    archive: (apply) => archiveOmpOutboxRuns({ directory, bridgeDirectory, apply }),
    cleanup: async () => {
      await close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function events(installationInstanceId, { complete = true, session = "c".repeat(64) } = {}) {
  const ctx = {
    installationInstanceId,
    nativeSessionId: session,
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
  const list = [
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
  ];
  if (complete) list.push(ompExitEvent(meta(), { exitCode: 0 }));
  return list;
}

async function enqueue(f, options) {
  const outbox = openOmpOutbox({
    directory: f.directory,
    bridgeDirectory: f.bridgeDirectory,
  });
  const list = events(outbox.installationInstanceId, options);
  for (const event of list) await outbox.send(event);
}

const stopWriter = (directory, run) => {
  const file = path.join(directory, run, "owner.json");
  const owner = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...owner, pid: 999999 }), {
    mode: 0o600,
  });
};

test("delivered runs move to the private archive while pending, live-writer and unverified runs stay", async () => {
  const f = await setup();
  try {
    // Run 1: fully observed and drained, but its writer process still lives.
    await enqueue(f);
    await replayOmpOutbox({
      directory: f.directory,
      bridgeDirectory: f.bridgeDirectory,
    });
    const blocked = f.archive(false);
    assert.deepEqual(blocked.archivableRuns, []);
    assert.deepEqual(blocked.retainedWriters, ["run-0000"]);
    stopWriter(f.directory, "run-0000");
    // Run 2: queued but not yet delivered. The bridge refuses a fresh startup
    // that reuses a completed native session, so each execution carries its
    // own observed session identity.
    await enqueue(f, { session: "d".repeat(64) });
    const mixed = f.archive(false);
    assert.equal(mixed.enabled, false);
    assert.deepEqual(mixed.archivableRuns, ["run-0000"]);
    assert.deepEqual(mixed.retainedPending, ["run-0001"]);
    const report = f.archive(true);
    assert.equal(report.enabled, true);
    assert.deepEqual(report.archivedRuns, ["run-0000"]);
    assert.ok(report.archiveDirectory.startsWith("archive/"));
    const target = path.join(f.directory, report.archiveDirectory, "run-0000");
    assert.equal(fs.existsSync(target), true);
    // Nothing is deleted: the canonical records and completion marker remain.
    assert.equal(fs.existsSync(path.join(target, "complete.json")), true);
    assert.deepEqual(
      fs
        .readdirSync(target)
        .filter((n) => n.endsWith(".event.json"))
        .length,
      0,
    );
    assert.equal(fs.existsSync(path.join(target, "owner.json")), true);
    assert.equal(fs.existsSync(path.join(f.directory, "binding.json")), true);
    // The slot is reusable and the retained run is untouched.
    const status = f.status();
    assert.equal(status.retainedRuns, 1);
    assert.equal(status.capacityRemaining, 1023);
    assert.equal(fs.existsSync(path.join(f.directory, "run-0001")), true);
    // Re-archiving after the pending run drains archives it too.
    await replayOmpOutbox({
      directory: f.directory,
      bridgeDirectory: f.bridgeDirectory,
    });
    stopWriter(f.directory, "run-0001");
    const second = f.archive(true);
    assert.deepEqual(second.archivedRuns, ["run-0001"]);
    assert.equal(f.status().retainedRuns, 0);
  } finally {
    await f.cleanup();
  }
});

test("a forced stop without the completion marker is retained as unverified", async () => {
  const f = await setup();
  try {
    await enqueue(f, { complete: false });
    await replayOmpOutbox({
      directory: f.directory,
      bridgeDirectory: f.bridgeDirectory,
    });
    stopWriter(f.directory, "run-0000");
    const report = f.archive(true);
    assert.deepEqual(report.archivableRuns, []);
    assert.deepEqual(report.retainedIncomplete, ["run-0000"]);
    assert.deepEqual(report.archivedRuns, []);
    assert.equal(fs.existsSync(path.join(f.directory, "run-0000")), true);
    assert.equal(fs.existsSync(path.join(f.directory, "run-0000", "owner.json")), true);
  } finally {
    await f.cleanup();
  }
});

test("archive refuses an unenrolled queue or a live conflicting installation", async () => {
  const f = await setup();
  try {
    // An outbox directory without an enrollment binding never archives.
    fs.mkdirSync(f.directory, { recursive: true, mode: 0o700 });
    assert.throws(
      () => f.archive(true),
      /Private OMP outbox unavailable/,
    );
    fs.rmSync(f.directory, { recursive: true, force: true });
    // A live registry enrolled to another installation never archives.
    await enqueue(f);
    await replayOmpOutbox({
      directory: f.directory,
      bridgeDirectory: f.bridgeDirectory,
    });
    stopWriter(f.directory, "run-0000");
    const registry = path.join(f.bridgeDirectory, "runtime", "omp.json");
    const current = JSON.parse(fs.readFileSync(registry, "utf8"));
    fs.writeFileSync(
      registry,
      JSON.stringify({ ...current, installationInstanceId: randomUUID() }),
      { mode: 0o600 },
    );
    assert.throws(
      () => f.archive(true),
      /Private OMP outbox unavailable/,
    );
    assert.equal(fs.existsSync(path.join(f.directory, "run-0000")), true);
  } finally {
    await f.cleanup();
  }
});

test("an absent queue archives nothing and creates nothing", async () => {
  const f = await setup();
  try {
    const report = f.archive(true);
    assert.equal(report.prepared, false);
    assert.deepEqual(report.archivedRuns, []);
    assert.equal(fs.existsSync(f.directory), false);
  } finally {
    await f.cleanup();
  }
});
