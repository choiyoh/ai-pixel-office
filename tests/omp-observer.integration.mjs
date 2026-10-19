import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { openProviderBridge } from "../server/bridge/ledger.mjs";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import { readOmpTransport } from "../platform/bridge-transport.mjs";
import { observeOmp, ompEnvironment } from "../platform/observe-omp.mjs";
import {
  ompModelObservation,
  ompStreamEvent,
  ompExitEvent,
} from "../server/bridge/omp.mjs";
const args = ["-p", "--no-session", "--no-extensions", "--max-time", "5"];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-omp-test-"));
  const config = {
    directory: path.join(root, "ledger"),
    providers: ["omp"],
    source: "fixture",
  };
  const bridge = openProviderBridge(config),
    p = bridge.principal("omp");
  return {
    root,
    config,
    bridge,
    p,
    ctx: {
      ...p,
      executionId: randomUUID(),
      logicalTaskId: randomUUID(),
      nativeSessionId: "opaque-session",
      sequence: 1,
      eventId: randomUUID(),
      occurredAt: "2026-10-17T00:00:00Z",
      startSource: "startup",
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
function fakeCli(root, events) {
  const file = path.join(root, "fake-omp.cjs");
  fs.writeFileSync(
    file,
    `for(const event of ${JSON.stringify(events)})process.stdout.write(JSON.stringify(event)+'\\n');`,
  );
  return file;
}
const stream = [
  {
    type: "session",
    id: "PRIVATE-NATIVE",
    cwd: "/PRIVATE-PATH",
    parentSession: "PRIVATE-PARENT",
  },
  { type: "agent_start" },
  {
    type: "message_end",
    message: {
      role: "assistant",
      provider: "commandcode",
      model: "deepseek/deepseek-v4.1-flash",
      content: [{ type: "text", text: "PRIVATE-MODEL-ANSWER" }],
    },
  },
  {
    type: "tool_execution_start",
    toolCallId: "PRIVATE-CALL|native-item",
    toolName: "read",
    args: { path: "/PRIVATE-PATH", apiKey: "PRIVATE-KEY" },
  },
  {
    type: "tool_execution_end",
    toolCallId: "PRIVATE-CALL|native-item",
    toolName: "read",
    result: { content: "PRIVATE-CONTENT" },
    isError: false,
  },
  { type: "agent_end", messages: [{ content: "PRIVATE-PROMPT" }] },
];

test("OMP native metadata establishes model family, messages and flags do not establish it", () => {
  assert.deepEqual(
    ompModelObservation({
      provider: "commandcode",
      model: "deepseek/deepseek-v4.1-flash",
    }),
    { modelProvider: "commandcode", modelFamily: "deepseek" },
  );
  assert.equal(
    ompModelObservation({
      provider: "commandcode",
      model: "other-model",
      text: "deepseek",
    }).modelFamily,
    "other",
  );
  assert.equal(
    ompModelObservation({ requestedModel: "deepseek/deepseek-v4.1-flash" })
      .modelFamily,
    "unknown",
  );
});

test("OMP adapter maps native tool failure and does not use tool results or agent_end as process exit", () => {
  const f = fixture();
  try {
    let sequence = 0;
    const emit = (raw) => {
      const e = ompStreamEvent(raw, {
        ...f.ctx,
        ...ompModelObservation({
          provider: "commandcode",
          id: "deepseek/deepseek-v4.1-flash",
        }),
        sequence: ++sequence,
        eventId: randomUUID(),
      });
      if (e) f.bridge.receive(e, f.p);
      return e;
    };
    emit(stream[0]);
    emit(stream[3]);
    emit({ ...stream[4], isError: true });
    assert.equal(f.bridge.snapshot().actors[0].status, "tool-failed");
    assert.equal(f.bridge.snapshot().actors[0].toolFailureObserved, true);
    emit(stream[5]);
    assert.equal(f.bridge.snapshot().actors.length, 1);
    assert.equal(f.bridge.snapshot().actors[0].status, "turn-ended");
    f.bridge.receive(
      ompExitEvent(
        { ...f.ctx, sequence: ++sequence, eventId: randomUUID() },
        { exitCode: 0 },
      ),
      f.p,
    );
    assert.equal(f.bridge.snapshot().actors.length, 0);
    assert.equal(
      f.bridge.snapshot().timeline.at(-1).processOutcome,
      "exited-zero",
    );
    const bytes = fs.readFileSync(
      path.join(f.config.directory, "provider-bridge.json"),
      "utf8",
    );
    for (const value of [
      "PRIVATE-KEY",
      "PRIVATE-PROMPT",
      "PRIVATE-CONTENT",
      "PRIVATE-PATH",
    ])
      assert.ok(!bytes.includes(value));
  } finally {
    f.cleanup();
  }
});

test("owned OMP supervisor forwards sanitized sequence and final text without persisting content", async () => {
  const f = fixture();
  try {
    let output = "";
    const file = fakeCli(f.root, stream);
    const r = await observeOmp({
      executable: process.execPath,
      launcherPrefix: [file],
      args,
      cwd: f.root,
      input: "PRIVATE-INPUT",
      onOutput: (text) => {
        output = text;
      },
      transport: {
        installationInstanceId: f.p.installationInstanceId,
        send: (e) => f.bridge.receive(e, f.p),
      },
    });
    assert.equal(r.exitCode, 0);
    assert.equal(r.sent, 5);
    assert.equal(r.deliveryErrors, 0);
    assert.equal(r.modelFamily, "deepseek");
    assert.equal(output, "PRIVATE-MODEL-ANSWER");
    assert.equal(f.bridge.snapshot().actors.length, 0);
    assert.equal(f.bridge.snapshot().terminalCount, 1);
    for (const value of [
      "PRIVATE-INPUT",
      "PRIVATE-NATIVE",
      "PRIVATE-MODEL-ANSWER",
      "PRIVATE-CALL|native-item",
      "PRIVATE-KEY",
      "PRIVATE-PATH",
    ]) {
      assert.ok(!JSON.stringify(r).includes(value));
      assert.ok(
        !fs
          .readFileSync(
            path.join(f.config.directory, "provider-bridge.json"),
            "utf8",
          )
          .includes(value),
      );
    }
    assert.equal(openProviderBridge(f.config).snapshot().terminalCount, 1);
  } finally {
    f.cleanup();
  }
});

test("intake outage does not change OMP exit or suppress its final business response", async () => {
  const f = fixture();
  try {
    let output = "";
    const r = await observeOmp({
      executable: process.execPath,
      launcherPrefix: [fakeCli(f.root, stream)],
      args,
      cwd: f.root,
      input: "input",
      onOutput: (text) => {
        output = text;
      },
      transport: {
        installationInstanceId: f.p.installationInstanceId,
        send: async () => {
          throw Error("receiver offline");
        },
      },
    });
    assert.equal(r.exitCode, 0);
    assert.equal(output, "PRIVATE-MODEL-ANSWER");
    assert.equal(r.deliveryErrors, 1);
    assert.equal(r.producerReplayImplemented, false);
    assert.equal(f.bridge.snapshot().actors.length, 0);
  } finally {
    f.cleanup();
  }
});

test("bounded parser rejects unsupported launches and never turns oversized text into telemetry", async () => {
  const f = fixture();
  try {
    await assert.rejects(() =>
      observeOmp({ executable: process.execPath, args: ["-p"], cwd: f.root }),
    );
    await assert.rejects(() =>
      observeOmp({
        executable: process.execPath,
        args: [...args, "--api-key", "PRIVATE-KEY"],
        cwd: f.root,
      }),
    );
    const r = await observeOmp({
      executable: process.execPath,
      launcherPrefix: [
        fakeCli(f.root, [
          { type: "message_update", content: "x".repeat(5000) },
        ]),
      ],
      args,
      cwd: f.root,
      maxLineBytes: 1024,
    });
    assert.equal(r.exitCode, 0);
    assert.equal(r.observationOverflow, true);
    assert.equal(r.sent, 0);
    assert.ok(!JSON.stringify(r).includes("xxxx"));
  } finally {
    f.cleanup();
  }
});

test("OMP child receives only required runtime/provider environment and no other provider secrets", () => {
  const env = ompEnvironment({
    HOME: "/home/user",
    PATH: "/bin",
    COMMAND_CODE_API_KEY: "required",
    ANTHROPIC_API_KEY: "unrelated",
    ORBIT_SECRET: "intake",
    DEEPSEEK_API_KEY: "required-deepseek",
  });
  assert.equal(env.COMMAND_CODE_API_KEY, "required");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ORBIT_SECRET, undefined);
});

test("OMP HTTP registry binds the native observer to its own principal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-omp-http-"));
  let app;
  try {
    app = await createProviderBridgeApp({
      stateDir: path.join(root, "state"),
      providers: ["omp"],
      source: "fixture",
    });
    await app.listen(0);
    const transport = readOmpTransport({ directory: path.join(root, "state") });
    assert.ok(transport);
    const r = await observeOmp({
      executable: process.execPath,
      launcherPrefix: [fakeCli(root, stream)],
      args,
      cwd: root,
      input: "input",
      transport,
    });
    assert.equal(r.exitCode, 0);
    assert.equal(r.sent, 5);
    assert.equal(r.deliveryErrors, 0);
    await app.app.close();
    app = null;
    assert.equal(
      readOmpTransport({ directory: path.join(root, "state") }),
      null,
    );
  } finally {
    await app?.app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Bridge v1 state is upgraded without discarding its existing actor mappings", () => {
  const f = fixture();
  try {
    f.bridge.receive(ompStreamEvent(stream[0], f.ctx), f.p);
    const before = f.bridge.snapshot().actors[0],
      file = path.join(f.config.directory, "provider-bridge.json"),
      v = JSON.parse(fs.readFileSync(file));
    v.version = 1;
    for (const e of Object.values(v.executions)) {
      delete e.modelFamily;
      delete e.modelProvider;
      delete e.toolFailureObserved;
      delete e.parentExecution;
    }
    fs.writeFileSync(file, JSON.stringify(v));
    const bytes = fs.readFileSync(file),
      next = openProviderBridge(f.config);
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.equal(next.snapshot().actors[0].actorId, before.actorId);
    assert.equal(next.snapshot().actors[0].modelFamily, "unknown");
  } finally {
    f.cleanup();
  }
});

test("opaque native tool IDs allow OMP punctuation but reject controls and unbounded IDs", () => {
  const f = fixture();
  try {
    assert.equal(ompStreamEvent({ type: "toString" }, f.ctx), null);
    for (const id of ["call|item:0", "x".repeat(512)]) {
      assert.equal(
        ompStreamEvent({ ...stream[3], toolCallId: id }, f.ctx)
          .nativeToolCallId,
        id,
      );
    }
    for (const id of [
      "",
      "x".repeat(513),
      "call\nitem",
      "call item",
      "call\u0000item",
    ]) {
      assert.throws(() =>
        ompStreamEvent({ ...stream[3], toolCallId: id }, f.ctx),
      );
    }
  } finally {
    f.cleanup();
  }
});

test("cancelling the owned OMP child observes its real close rather than inventing success", async () => {
  const f = fixture();
  try {
    const file = path.join(f.root, "waiting-omp.cjs");
    fs.writeFileSync(
      file,
      `process.stdout.write(JSON.stringify({type:'session',id:'owned-child'})+'\\n');setInterval(()=>{},1000);`,
    );
    const controller = new AbortController();
    const r = await observeOmp({
      executable: process.execPath,
      launcherPrefix: [file],
      args,
      cwd: f.root,
      signal: controller.signal,
      transport: {
        installationInstanceId: f.p.installationInstanceId,
        send: (e) => {
          const receipt = f.bridge.receive(e, f.p);
          if (e.kind === "session.start") controller.abort();
          return receipt;
        },
      },
    });
    assert.notEqual(r.exitCode, 0);
    assert.equal(r.sent, 2);
    assert.equal(f.bridge.snapshot().actors.length, 0);
    assert.equal(f.bridge.snapshot().terminalCount, 1);
    assert.ok(
      ["signalled", "exited-nonzero"].includes(
        f.bridge.snapshot().timeline.at(-1).processOutcome,
      ),
    );
  } finally {
    f.cleanup();
  }
});

test("native session identity is stable across runs and scoped to the installation", async () => {
  const f = fixture();
  try {
    const cli = fakeCli(f.root, [{ type: "session", id: "PRIVATE-NATIVE" }]);
    const runOnce = async (installationId) => {
      const seen = [];
      await observeOmp({
        executable: process.execPath,
        launcherPrefix: [cli],
        args,
        cwd: f.root,
        transport: {
          installationInstanceId: installationId,
          send: async (e) => {
            seen.push(e);
            return { accepted: true, disposition: "committed" };
          },
        },
      });
      return seen.find((e) => e.kind === "session.start").nativeSessionId;
    };
    const first = await runOnce(f.p.installationInstanceId);
    const second = await runOnce(f.p.installationInstanceId);
    const other = await runOnce("00000000-0000-4000-8000-000000000001");
    assert.equal(typeof first, "string");
    assert.ok(first.length > 0);
    // A resumed native session must map to the same actor, so the digest has
    // to survive a new process; the raw native id still never appears.
    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.ok(![first, second, other].includes("PRIVATE-NATIVE"));
  } finally {
    f.cleanup();
  }
});

test("an unreported installation keeps per-run session identity", async () => {
  const f = fixture();
  try {
    const cli = fakeCli(f.root, [{ type: "session", id: "PRIVATE-NATIVE" }]);
    const runOnce = async () => {
      const seen = [];
      await observeOmp({
        executable: process.execPath,
        launcherPrefix: [cli],
        args,
        cwd: f.root,
        transport: {
          send: async (e) => {
            seen.push(e);
            return { accepted: true, disposition: "committed" };
          },
        },
      });
      return seen.find((e) => e.kind === "session.start").nativeSessionId;
    };
    assert.notEqual(await runOnce(), await runOnce());
  } finally {
    f.cleanup();
  }
});

test("OMP observer accepts an explicit resume run and refuses unsafe resume variants", async () => {
  const f = fixture();
  try {
    const cli = fakeCli(f.root, [{ type: "session", id: "PRIVATE-NATIVE" }]);
    const launch = (extra, over = {}) =>
      observeOmp({
        executable: process.execPath,
        launcherPrefix: [cli],
        args: ["-p", "--no-extensions", "--max-time", "5", ...extra],
        cwd: f.root,
        ...over,
      });
    // The fresh path is unchanged: it still requires an ephemeral session or
    // an explicit directory for a stored one.
    await assert.rejects(() => launch([]), /fresh ephemeral, stored or explicit resume/);
    // A resume cannot be ephemeral, and needs a directory plus a real target.
    await assert.rejects(
      () =>
        launch([
          "--no-session",
          "--resume",
          "opaque",
          "--session-dir",
          "/tmp/omp-sessions",
        ]),
      /cannot resume an ephemeral session/,
    );
    await assert.rejects(
      () => launch(["--resume", "opaque"]),
      /explicit session directory/,
    );
    await assert.rejects(
      () => launch(["--resume", "--session-dir", "/tmp/omp-sessions"]),
      /explicit session id/,
    );
    // Continue, profiles and other unreviewed launch options stay refused.
    await assert.rejects(
      () =>
        launch([
          "--resume",
          "opaque",
          "--session-dir",
          "/tmp/omp-sessions",
          "--continue",
        ]),
      /Unreviewed OMP observer launch option/,
    );
    await assert.rejects(
      () =>
        launch([
          "--resume",
          "opaque",
          "--session-dir",
          "/tmp/omp-sessions",
          "--profile",
          "x",
        ]),
      /Unreviewed OMP observer launch option/,
    );
    // The reviewed resume run reports its source and reaches the ledger.
    const sent = [];
    const r = await launch(
      ["--resume", "opaque", "--session-dir", "/tmp/omp-sessions"],
      {
        transport: {
          installationInstanceId: f.p.installationInstanceId,
          send: async (e) => {
            sent.push(e);
            return { accepted: true, disposition: "committed" };
          },
        },
      },
    );
    assert.equal(r.exitCode, 0);
    const starts = sent.filter((e) => e.kind === "session.start");
    assert.equal(starts.length, 1);
    assert.equal(starts[0].startSource, "resume");
    assert.equal(sent.filter((e) => e.startSource !== undefined).length, 1);
    // The same event reaches a real bridge and starts a visible actor.
    const receipt = f.bridge.receive(starts[0], f.p);
    assert.equal(receipt.accepted, true);
    assert.equal(f.bridge.snapshot().actors.length, 1);
  } finally {
    f.cleanup();
  }
});
