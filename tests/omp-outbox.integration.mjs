import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openOmpOutbox, replayOmpOutbox } from "../platform/omp-outbox.mjs";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import { observeOmp } from "../platform/observe-omp.mjs";
import { ompStreamEvent, ompExitEvent } from "../server/bridge/omp.mjs";
const args = ["-p", "--no-session", "--no-extensions", "--max-time", "5"];
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-outbox-")),
    directory = path.join(root, "outbox"),
    bridgeDirectory = path.join(root, "bridge");
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
  await start();
  return {
    root,
    directory,
    bridgeDirectory,
    start,
    get app() {
      return app;
    },
    close: async () => {
      await app?.app.close();
      app = null;
    },
    cleanup: async () => {
      await app?.app.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
function events(
  installationInstanceId,
  at = new Date().toISOString(),
  sessionId = "a".repeat(64),
) {
  const ctx = {
    installationInstanceId,
    nativeSessionId: sessionId,
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
    occurredAt: at,
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
const files = (directory) =>
  fs
    .readdirSync(directory)
    .filter((n) => /^run-/.test(n))
    .flatMap((n) =>
      fs
        .readdirSync(path.join(directory, n))
        .filter((f) => f.endsWith(".event.json"))
        .map((f) => path.join(directory, n, f)),
    );
async function enqueue(f) {
  const outbox = openOmpOutbox(f);
  const e = events(outbox.installationInstanceId);
  for (const event of e) await outbox.send(event);
  return e;
}

test("offline owned OMP persists sanitized observations without changing its exit or final answer; fresh worker recovers", async () => {
  const f = await setup();
  try {
    const transport = openOmpOutbox(f);
    await f.close();
    const script = path.join(f.root, "fake.cjs");
    const stream = [
      { type: "session", id: "PRIVATE-NATIVE-SESSION", cwd: "/PRIVATE-PATH" },
      {
        type: "message_end",
        message: {
          role: "assistant",
          provider: "commandcode",
          model: "deepseek/deepseek-v4.1-flash",
          content: [{ type: "text", text: "PRIVATE-BUSINESS-ANSWER" }],
        },
      },
      {
        type: "tool_execution_start",
        toolName: "read",
        toolCallId: "PRIVATE-NATIVE-CALL|raw",
        args: { path: "/PRIVATE-PATH", token: "PRIVATE-KEY" },
      },
      {
        type: "tool_execution_end",
        toolName: "read",
        toolCallId: "PRIVATE-NATIVE-CALL|raw",
        isError: false,
        result: "PRIVATE-RESULT",
      },
      { type: "agent_end" },
    ];
    fs.writeFileSync(
      script,
      `for(const e of ${JSON.stringify(stream)})process.stdout.write(JSON.stringify(e)+'\\n');`,
    );
    let answer = "";
    const r = await observeOmp({
      executable: process.execPath,
      launcherPrefix: [script],
      args,
      cwd: f.root,
      input: "PRIVATE-PROMPT",
      transport,
      onOutput: (text) => {
        answer = text;
      },
    });
    assert.equal(r.exitCode, 0);
    assert.equal(answer, "PRIVATE-BUSINESS-ANSWER");
    assert.equal(r.producerReplayImplemented, true);
    assert.equal(r.durablyQueued, 5);
    assert.equal(r.sent, 0);
    assert.equal(r.deliveryErrors, 0);
    const paths = files(f.directory);
    assert.equal(paths.length, 5);
    const bytes = paths.map((p) => fs.readFileSync(p, "utf8")).join();
    for (const secret of [
      "PRIVATE-PROMPT",
      "PRIVATE-BUSINESS-ANSWER",
      "PRIVATE-NATIVE-SESSION",
      "PRIVATE-NATIVE-CALL",
      "PRIVATE-PATH",
      "PRIVATE-KEY",
      "PRIVATE-RESULT",
    ])
      assert.ok(!bytes.includes(secret));
    const offline = await replayOmpOutbox(f);
    assert.equal(offline.offline, true);
    assert.equal(offline.pending, 5);
    await f.start();
    const replay = await replayOmpOutbox(f);
    assert.equal(replay.delivered, 5);
    assert.equal(replay.pending, 0);
    assert.equal(replay.blockedRuns, 0);
    const state = JSON.parse(
      fs.readFileSync(
        path.join(f.bridgeDirectory, "ledger/provider-bridge.json"),
      ),
    );
    assert.equal(state.revision, 5);
    assert.ok(Object.values(state.executions)[0].terminal);
    assert.equal(Object.keys(state.executions).length, 1);
  } finally {
    await f.cleanup();
  }
});

test("ack loss after durable commit retains identical events; restart/token rotation and concurrent replay do not duplicate executions", async () => {
  const f = await setup();
  try {
    const source = await enqueue(f),
      bytes = files(f.directory).map((p) => [
        path.basename(p),
        fs.readFileSync(p),
      ]);
    await f.close();
    let drop = true;
    await f.start((app) =>
      app.addHook("onSend", async (request, reply, payload) => {
        if (drop && request.url.endsWith("/batch")) {
          drop = false;
          reply.raw.destroy();
        }
        return payload;
      }),
    );
    const lost = await replayOmpOutbox(f);
    assert.equal(lost.offline, true);
    assert.equal(lost.pending, 5);
    let state = JSON.parse(
      fs.readFileSync(
        path.join(f.bridgeDirectory, "ledger/provider-bridge.json"),
      ),
    );
    assert.equal(state.revision, 5);
    assert.equal(
      Object.values(state.executions).filter((e) => e.terminal).length,
      1,
    );
    for (const [name, content] of bytes)
      assert.deepEqual(
        fs.readFileSync(
          files(f.directory).find((p) => path.basename(p) === name),
        ),
        content,
      );
    await f.close();
    await f.start();
    const results = await Promise.all([replayOmpOutbox(f), replayOmpOutbox(f)]);
    assert.ok(results.every((r) => r.blockedRuns === 0));
    assert.equal(files(f.directory).length, 0);
    state = JSON.parse(
      fs.readFileSync(
        path.join(f.bridgeDirectory, "ledger/provider-bridge.json"),
      ),
    );
    assert.equal(state.revision, 5);
    assert.equal(Object.keys(state.executions).length, 1);
    assert.deepEqual(
      state.timeline.map((e) => e.occurredAt),
      source.map((e) => e.occurredAt),
    );
  } finally {
    await f.cleanup();
  }
});

test("corruption and changed installation retain queued data instead of guessing a new identity", async () => {
  const f = await setup();
  try {
    await enqueue(f);
    const first = files(f.directory)[0],
      original = fs.readFileSync(first),
      bad = JSON.parse(original);
    bad.event.prompt = "PRIVATE-PROMPT";
    fs.writeFileSync(first, JSON.stringify(bad));
    const corrupt = await replayOmpOutbox(f);
    assert.equal(corrupt.blockedRuns, 1);
    assert.equal(corrupt.pending, 5);
    fs.writeFileSync(first, original);
    await f.close();
    fs.renameSync(
      path.join(f.bridgeDirectory, "ledger"),
      path.join(f.root, "old-ledger"),
    );
    await f.start();
    const mismatched = await replayOmpOutbox(f);
    assert.equal(mismatched.installationMismatch, true);
    assert.equal(mismatched.pending, 5);
    assert.throws(() => openOmpOutbox(f));
  } finally {
    await f.cleanup();
  }
});

test("durable queue has an explicit per-execution capacity and refuses unobserved resume", async () => {
  const f = await setup();
  try {
    const outbox = openOmpOutbox(f),
      [start] = events(outbox.installationInstanceId);
    await assert.rejects(() =>
      outbox.send({ ...start, startSource: "resume" }),
    );
    await outbox.send(start);
    for (let sequence = 2; sequence <= 128; sequence++)
      await outbox.send({
        ...start,
        eventId: randomUUID(),
        sequence,
        kind: "turn.end",
        startSource: undefined,
      });
    await assert.rejects(() =>
      outbox.send({
        ...start,
        eventId: randomUUID(),
        sequence: 129,
        kind: "execution.end",
        startSource: undefined,
        processOutcome: "exited-zero",
      }),
    );
    assert.equal(files(f.directory).length, 128);
  } finally {
    await f.cleanup();
  }
});

test("a resume is accepted only for a session the queue already observed", async () => {
  const f = await setup();
  try {
    const [start] = events(openOmpOutbox(f).installationInstanceId);
    const first = openOmpOutbox(f);
    // Unseen resume stays refused, exactly as before.
    await assert.rejects(() => first.send({ ...start, startSource: "resume" }));
    await first.send(start);
    await first.send({
      ...start,
      eventId: randomUUID(),
      sequence: 2,
      kind: "turn.end",
      startSource: undefined,
    });
    await first.send({
      ...start,
      eventId: randomUUID(),
      sequence: 3,
      kind: "execution.end",
      startSource: undefined,
      processOutcome: "exited-zero",
    });
    // A new process resuming the observed session is queued as its own run.
    const resumes = openOmpOutbox(f);
    const resumed = {
      ...start,
      startSource: "resume",
      executionId: randomUUID(),
      logicalTaskId: randomUUID(),
      eventId: randomUUID(),
      sequence: 1,
    };
    const receipt = await resumes.send(resumed);
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.disposition, "queued");
    // A session this queue never saw is still refused.
    const other = openOmpOutbox(f);
    await assert.rejects(() =>
      other.send({
        ...resumed,
        nativeSessionId: "f".repeat(64),
        eventId: randomUUID(),
      }),
    );
  } finally {
    await f.cleanup();
  }
});

test("batch auth, body bounds, committed prefix and exact retry preserve the receiver contract", async () => {
  const f = await setup();
  try {
    const registry = JSON.parse(
        fs.readFileSync(path.join(f.bridgeDirectory, "runtime/omp.json")),
      ),
      url = `http://127.0.0.1:${registry.port}/api/bridge/omp/batch`,
      e = events(registry.installationInstanceId);
    const send = (body, authorized = true) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorized ? { authorization: `Bearer ${registry.token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await send({ events: e }, false)).status, 401);
    assert.equal((await send({ events: [] })).status, 422);
    assert.equal(
      (await send({ events: Array.from({ length: 65 }, () => e[0]) })).status,
      422,
    );
    assert.equal(
      (await send({ events: [e[0], { ...e[1], tool: "PRIVATE-TOOL" }] }))
        .status,
      422,
    );
    const response = await send({ events: e });
    assert.equal(response.status, 200);
    const ack = await response.json();
    assert.equal(ack.receipts.length, 5);
    assert.equal(ack.receipts[0].duplicate, true);
    assert.equal(ack.receipts.at(-1).eventId, e.at(-1).eventId);
  } finally {
    await f.cleanup();
  }
});

test("a malformed committed ACK cannot erase events even when the receiver committed the batch", async () => {
  const f = await setup();
  try {
    await enqueue(f);
    await f.close();
    await f.start((app) =>
      app.addHook("onSend", async (request, reply, payload) => {
        if (request.url.endsWith("/batch")) {
          const data = JSON.parse(String(payload));
          for (const receipt of data.receipts) delete receipt.nextSequence;
          return JSON.stringify(data);
        }
        return payload;
      }),
    );
    const bad = await replayOmpOutbox(f);
    assert.equal(bad.blockedRuns, 1);
    assert.equal(bad.pending, 5);
    await f.close();
    await f.start();
    const recovered = await replayOmpOutbox(f);
    assert.equal(recovered.pending, 0);
    assert.equal(recovered.duplicateReceipts, 5);
  } finally {
    await f.cleanup();
  }
});

test("enrollment never invents an installation and the execution slot capacity is finite", async () => {
  const f = await setup();
  try {
    await f.close();
    assert.throws(() => openOmpOutbox(f));
    assert.deepEqual(fs.readdirSync(f.directory), []);
    await f.start();
    const outbox = openOmpOutbox(f);
    for (let i = 0; i < 1024; i++)
      fs.mkdirSync(
        path.join(f.directory, `run-${String(i).padStart(4, "0")}`),
        { mode: 0o700 },
      );
    const [start] = events(outbox.installationInstanceId);
    await assert.rejects(() => outbox.send(start));
    assert.equal(
      fs.readdirSync(f.directory).filter((n) => /^run-/.test(n)).length,
      1024,
    );
  } finally {
    await f.cleanup();
  }
});

test("receiver rejection is reported separately from offline and cannot delete a pending event", async () => {
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
    const result = await replayOmpOutbox(f);
    assert.equal(result.rejected, true);
    assert.equal(result.lastStatus, 429);
    assert.equal(result.offline, false);
    assert.equal(result.pending, 5);
    await f.close();
    await f.start();
    assert.equal((await replayOmpOutbox(f)).pending, 0);
  } finally {
    await f.cleanup();
  }
});

test("two writers racing the same queue each reserve their own slot without losing events", async () => {
  const f = await setup();
  try {
    const writer = path.join(f.root, "writer.mjs"),
      outboxUrl = new URL("../platform/omp-outbox.mjs", import.meta.url).href,
      ompUrl = new URL("../server/bridge/omp.mjs", import.meta.url).href;
    fs.writeFileSync(
      writer,
      `
import { openOmpOutbox } from ${JSON.stringify(outboxUrl)};
import { ompStreamEvent, ompExitEvent } from ${JSON.stringify(ompUrl)};
import { randomUUID } from "node:crypto";
const [directory, bridgeDirectory, tag] = process.argv.slice(2);
const outbox = openOmpOutbox({ directory, bridgeDirectory });
const ctx = {
  installationInstanceId: outbox.installationInstanceId,
  nativeSessionId: tag.repeat(64),
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
for (const event of [
  ompStreamEvent({ type: "session" }, meta()),
  ompStreamEvent({ type: "agent_end" }, meta()),
  ompExitEvent(meta(), { exitCode: 0 }),
])
  await outbox.send(event);
process.exit(0);
`,
    );
    const run = (tag) =>
      new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          [writer, f.directory, f.bridgeDirectory, tag],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        child.on("close", (code) => resolve({ code, out }));
      });
    // Two real processes start together; the mkdir-based slot reservation must
    // hand them different runs rather than racing into one.
    const [one, two] = await Promise.all([run("a"), run("b")]);
    assert.equal(one.code, 0, one.out);
    assert.equal(two.code, 0, two.out);
    const slots = fs
      .readdirSync(f.directory)
      .filter((n) => /^run-\d{4}$/.test(n));
    assert.equal(slots.length, 2);
    const replay = await replayOmpOutbox(f);
    assert.equal(replay.delivered, 6);
    assert.equal(replay.pending, 0);
    assert.equal(replay.blockedRuns, 0);
  } finally {
    await f.cleanup();
  }
});

test("a bridge restart mid-run queues the live stream and lets a new run flow immediately", async () => {
  const f = await setup();
  try {
    const first = openOmpOutbox(f),
      a = events(first.installationInstanceId);
    await first.send(a[0]); // delivered while the bridge is up
    // The bridge restarts while execution A is still running: its own instance
    // keeps the original binding, so the rest of the stream cannot reach it.
    await f.close();
    await f.start();
    for (let i = 1; i < a.length; i++) await first.send(a[i]);
    // A fresh run binds the restarted bridge through the refreshed transport.
    const second = openOmpOutbox(f),
      b = events(second.installationInstanceId, new Date().toISOString(), "b".repeat(64));
    for (const event of b) await second.send(event);
    const replay = await replayOmpOutbox(f);
    // Nothing may stay pending and no run may be blocked; the exact delivered
    // count also includes events the bridge had already committed, because the
    // replay re-offers the whole unacknowledged tail and the bridge dedupes on
    // receipt (covered by the receipts test).
    assert.equal(replay.pending, 0);
    assert.equal(replay.blockedRuns, 0);
    assert.ok(replay.delivered >= 4, `delivered ${replay.delivered}`);
  } finally {
    await f.cleanup();
  }
});
