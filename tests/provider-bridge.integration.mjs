import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { openProviderBridge } from "../server/bridge/ledger.mjs";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import {
  commandCodeHookEvent,
  commandCodeExitEvent,
} from "../server/bridge/command-code.mjs";
import { assertPrivate } from "../platform/private-files.mjs";
const uuid = () => randomUUID();
function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-bridge-test-"));
  let clock = Date.parse("2026-10-17T00:00:00Z");
  const config = {
    directory: path.join(root, "state"),
    providers: ["claude", "command-code"],
    source: "fixture",
    now: () => clock,
    ...options,
  };
  const bridge = openProviderBridge(config);
  return {
    root,
    bridge,
    config,
    tick: (n) => {
      clock += n;
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
function producer(
  principal,
  {
    nativeSessionId = "PRIVATE-NATIVE",
    executionId = uuid(),
    logicalTaskId = uuid(),
    actorRole = "executor",
    delegationId,
    parentTaskId,
  } = {},
) {
  return (sequence, kind, extra = {}) => ({
    schemaVersion: 1,
    providerId: principal.providerId,
    installationInstanceId: principal.installationInstanceId,
    nativeSessionId,
    executionId,
    logicalTaskId,
    actorRole,
    eventId: uuid(),
    sequence,
    occurredAt: "2026-10-17T00:00:00Z",
    kind,
    ...(kind === "session.start" ? { startSource: "startup" } : {}),
    ...(kind.startsWith("tool.")
      ? {
          tool: "read",
          nativeToolCallId: `call-${kind === "tool.end" ? sequence - 1 : sequence}`,
        }
      : {}),
    ...(kind === "execution.end" ? { processOutcome: "exited-zero" } : {}),
    ...(delegationId ? { delegationId } : {}),
    ...(parentTaskId ? { parentTaskId } : {}),
    ...extra,
  });
}
const code = (status, reason) => (e) =>
  e.statusCode === status && (!reason || e.code === reason);

test("bridge principal namespace isolates equal provider-native/execution/event IDs and preserves mappings on restart", () => {
  const f = fixture();
  try {
    const a = f.bridge.principal("claude"),
      b = f.bridge.principal("command-code"),
      same = { executionId: uuid(), logicalTaskId: uuid() },
      eventId = uuid();
    const one = producer(a, same),
      two = producer(b, same);
    f.bridge.receive(one(1, "session.start", { eventId }), a);
    f.bridge.receive(two(1, "session.start", { eventId }), b);
    const s = f.bridge.snapshot();
    assert.equal(s.actors.length, 2);
    assert.equal(new Set(s.actors.map((a) => a.actorId)).size, 2);
    assert.equal(new Set(s.actors.map((a) => a.renderId)).size, 2);
    const restored = openProviderBridge(f.config).snapshot();
    assert.deepEqual(restored.actors, s.actors);
    assert.equal(restored.realEnvironmentVerified, false);
    assert.equal(restored.source, "fixture");
    assert.ok(!JSON.stringify(restored).includes("PRIVATE-NATIVE"));
    assertPrivate(path.join(f.config.directory, "provider-bridge.json"));
  } finally {
    f.cleanup();
  }
});

test("durable event receipts deduplicate, reject conflicting event/sequence reuse and preserve terminal boundaries", () => {
  const f = fixture();
  try {
    const p = f.bridge.principal("command-code"),
      make = producer(p),
      start = make(1, "session.start");
    const ack = f.bridge.receive(start, p),
      file = path.join(f.config.directory, "provider-bridge.json");
    const before = fs.readFileSync(file);
    assert.deepEqual(f.bridge.receive(start, p), { ...ack, duplicate: true });
    assert.deepEqual(fs.readFileSync(file), before);
    assert.throws(
      () => f.bridge.receive({ ...start, startSource: "clear" }, p),
      code(409, "event-id-conflict"),
    );
    assert.throws(
      () => f.bridge.receive(make(1, "tool.start"), p),
      code(409, "sequence-conflict"),
    );
    f.bridge.receive(make(2, "turn.end"), p);
    assert.equal(f.bridge.snapshot().actors.length, 1);
    assert.equal(f.bridge.snapshot().actors[0].status, "turn-ended");
    f.bridge.receive(make(3, "execution.end"), p);
    assert.equal(f.bridge.snapshot().actors.length, 0);
    const revision = f.bridge.snapshot().revision;
    assert.throws(
      () => f.bridge.receive(make(4, "tool.start"), p),
      code(409, "terminal-execution"),
    );
    assert.equal(f.bridge.snapshot().revision, revision);
    assert.deepEqual(openProviderBridge(f.config).receive(start, p), {
      ...ack,
      duplicate: true,
    });
    assert.equal(
      f.bridge.snapshot().timeline.at(-1).processOutcome,
      "exited-zero",
    );
    assert.ok(!("completedTasks" in f.bridge.snapshot()));
  } finally {
    f.cleanup();
  }
});

test("reordered tools cannot create actors, missing sequences remain explicit and bounded, replay drains atomically", () => {
  const f = fixture({ maxPendingPerExecution: 2 });
  try {
    const p = f.bridge.principal("command-code"),
      make = producer(p);
    f.bridge.receive(make(2, "tool.start"), p);
    assert.equal(f.bridge.snapshot().actors.length, 0);
    const b = make(3, "tool.end");
    assert.equal(f.bridge.receive(b, p).disposition, "buffered");
    assert.throws(
      () => f.bridge.receive(make(4, "turn.end"), p),
      code(429, "reorder-capacity"),
    );
    const restarted = openProviderBridge(f.config);
    restarted.receive(make(1, "session.start"), p);
    assert.equal(restarted.snapshot().actors.length, 1);
    assert.equal(restarted.snapshot().actors[0].status, "between-tools");
    assert.equal(restarted.snapshot().pendingCount, 0);
    restarted.receive(make(5, "tool.start"), p);
    assert.equal(restarted.snapshot().actors[0].quality, "sequence-gap");
    f.tick(5001);
    assert.equal(restarted.snapshot().actors[0].quality, "gap-expired");
    restarted.receive(make(4, "turn.end"), p);
    assert.equal(restarted.snapshot().actors[0].quality, "contiguous");
    assert.equal(restarted.snapshot().actors[0].status, "working");
  } finally {
    f.cleanup();
  }
});

test("resume is an explicit new execution, retains identity, blocks overlap and old terminal traffic", () => {
  const f = fixture();
  try {
    const p = f.bridge.principal("command-code"),
      task = uuid(),
      first = producer(p, { logicalTaskId: task }),
      second = producer(p, { logicalTaskId: task });
    f.bridge.receive(first(1, "session.start"), p);
    const original = f.bridge.snapshot().actors[0];
    assert.throws(
      () =>
        f.bridge.receive(
          second(1, "session.start", { startSource: "resume" }),
          p,
        ),
      code(409, "ambiguous-session-reuse"),
    );
    f.bridge.receive(first(2, "execution.end"), p);
    assert.throws(
      () => f.bridge.receive(second(1, "session.start"), p),
      code(409, "ambiguous-session-reuse"),
    );
    f.bridge.receive(second(1, "session.start", { startSource: "resume" }), p);
    const resumed = f.bridge.snapshot().actors[0];
    assert.equal(resumed.actorId, original.actorId);
    assert.equal(resumed.renderId, original.renderId);
    assert.equal(resumed.palette, original.palette);
    assert.equal(resumed.generation, 2);
    assert.throws(
      () => f.bridge.receive(first(3, "tool.start"), p),
      code(409, "terminal-execution"),
    );
    assert.equal(f.bridge.snapshot().actors.length, 1);
    assert.equal(
      openProviderBridge(f.config).snapshot().actors[0].generation,
      2,
    );
  } finally {
    f.cleanup();
  }
});

test("only registered delegation joins relay/executor; relay and observer never become characters", () => {
  const delegationId = uuid(),
    logicalTaskId = uuid(),
    f = fixture({
      delegations: [
        {
          delegationId,
          logicalTaskId,
          relayProviderId: "claude",
          executorProviderId: "command-code",
        },
      ],
    });
  try {
    const relay = f.bridge.principal("claude", ["relay"]),
      exec = f.bridge.principal("command-code"),
      r = producer(relay, { logicalTaskId, delegationId, actorRole: "relay" }),
      e = producer(exec, { logicalTaskId, delegationId });
    f.bridge.receive(r(1, "session.start"), relay);
    f.bridge.receive(r(2, "tool.start", { tool: "shell" }), relay);
    assert.equal(f.bridge.snapshot().actors.length, 0);
    f.bridge.receive(e(1, "session.start"), exec);
    assert.equal(f.bridge.snapshot().actors.length, 1);
    assert.equal(f.bridge.snapshot().actors[0].providerId, "command-code");
    assert.equal(f.bridge.snapshot().actors[0].delegationId, delegationId);
    assert.equal(
      f.bridge.snapshot().timeline.filter((e) => e.actorRole === "relay")
        .length,
      2,
    );
    assert.throws(
      () =>
        f.bridge.receive(
          producer(exec, { delegationId: uuid() })(1, "session.start"),
          exec,
        ),
      code(403, "unregistered-delegation"),
    );
    assert.throws(
      () =>
        f.bridge.receive(
          producer(exec, { actorRole: "relay" })(1, "session.start"),
          exec,
        ),
      code(403, "actor-role-not-authorized"),
    );
  } finally {
    f.cleanup();
  }
});

test("parent correlation rejects unknown, cyclic and foreign ownership without fuzzy matching", () => {
  const f = fixture();
  try {
    const a = f.bridge.principal("claude"),
      b = f.bridge.principal("command-code"),
      parentTask = uuid(),
      childTask = uuid();
    f.bridge.receive(
      producer(a, { logicalTaskId: parentTask })(1, "session.start"),
      a,
    );
    assert.throws(
      () =>
        f.bridge.receive(
          producer(b, { parentTaskId: parentTask })(1, "session.start"),
          b,
        ),
      code(403, "foreign-parent"),
    );
    assert.throws(
      () =>
        f.bridge.receive(
          producer(b, { parentTaskId: uuid() })(1, "session.start"),
          b,
        ),
      code(409, "parent-not-observed"),
    );
    f.bridge.receive(
      producer(a, {
        logicalTaskId: childTask,
        parentTaskId: parentTask,
        nativeSessionId: "child",
      })(1, "session.start"),
      a,
    );
    assert.throws(
      () =>
        f.bridge.receive(
          producer(a, {
            logicalTaskId: parentTask,
            parentTaskId: childTask,
            nativeSessionId: "cycle",
          })(1, "session.start"),
          a,
        ),
      code(422, "cyclic-parent"),
    );
    assert.equal(f.bridge.snapshot().actors.length, 2);
  } finally {
    f.cleanup();
  }
});

test("Command Code adapter uses documented canonical tools, keeps Stop nonterminal and discards all content", () => {
  const f = fixture();
  try {
    const p = f.bridge.principal("command-code"),
      ctx = {
        ...p,
        executionId: uuid(),
        logicalTaskId: uuid(),
        actorRole: "executor",
        eventId: uuid(),
        sequence: 1,
        occurredAt: "2026-10-17T00:00:00Z",
      };
    const raw = {
      session_id: "PRIVATE-NATIVE",
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: "/PRIVATE-PATH",
      transcript_path: "/PRIVATE-TRANSCRIPT",
      prompt: "PRIVATE-PROMPT",
      tool_input: { secret: "PRIVATE-KEY" },
      tool_response: "PRIVATE-OUTPUT",
    };
    f.bridge.receive(commandCodeHookEvent(raw, ctx), p);
    let sequence = 1;
    for (const [name, tool] of [
      ["read_file", "read"],
      ["write_file", "write"],
      ["edit_file", "edit"],
      ["shell_command", "shell"],
      ["unknown", "other"],
    ]) {
      const e = commandCodeHookEvent(
        {
          ...raw,
          hook_event_name: "PreToolUse",
          tool_name: name,
          tool_use_id: `PRIVATE-CALL-${sequence}`,
        },
        { ...ctx, sequence: ++sequence, eventId: uuid() },
      );
      assert.equal(e.tool, tool);
      f.bridge.receive(e, p);
      f.bridge.receive(
        commandCodeHookEvent(
          {
            ...raw,
            hook_event_name: "PostToolUse",
            tool_name: name,
            tool_use_id: e.nativeToolCallId,
          },
          { ...ctx, sequence: ++sequence, eventId: uuid() },
        ),
        p,
      );
    }
    const stop = commandCodeHookEvent(
      { ...raw, hook_event_name: "Stop" },
      { ...ctx, sequence: ++sequence, eventId: uuid() },
    );
    f.bridge.receive(stop, p);
    assert.equal(f.bridge.snapshot().actors.length, 1);
    assert.equal(f.bridge.snapshot().actors[0].status, "turn-ended");
    const exit = commandCodeExitEvent(
      {
        ...ctx,
        nativeSessionId: raw.session_id,
        sequence: ++sequence,
        eventId: uuid(),
      },
      { exitCode: 0 },
    );
    f.bridge.receive(exit, p);
    assert.equal(f.bridge.snapshot().actors.length, 0);
    for (const forbidden of [
      "SessionEnd",
      "PermissionRequest",
      "SubagentStart",
    ])
      assert.throws(
        () => commandCodeHookEvent({ ...raw, hook_event_name: forbidden }, ctx),
        code(422, "unsupported-command-code-hook"),
      );
    assert.throws(
      () => commandCodeExitEvent(ctx, {}),
      code(422, "process-exit-not-observed"),
    );
    const bytes = fs.readFileSync(
      path.join(f.config.directory, "provider-bridge.json"),
      "utf8",
    );
    for (const secret of [
      "PRIVATE-NATIVE",
      "PRIVATE-PATH",
      "PRIVATE-TRANSCRIPT",
      "PRIVATE-PROMPT",
      "PRIVATE-KEY",
      "PRIVATE-OUTPUT",
      "PRIVATE-CALL",
    ])
      assert.ok(!bytes.includes(secret));
  } finally {
    f.cleanup();
  }
});

test("bridge refuses corrupt state, public permissions and delivery overflow without discarding history", () => {
  const f = fixture({ maxDeliveries: 2 });
  try {
    const p = f.bridge.principal("command-code"),
      make = producer(p);
    f.bridge.receive(make(1, "session.start"), p);
    f.bridge.receive(make(2, "turn.end"), p);
    const file = path.join(f.config.directory, "provider-bridge.json"),
      bytes = fs.readFileSync(file);
    assert.throws(
      () => f.bridge.receive(make(3, "execution.end"), p),
      code(429, "delivery-capacity"),
    );
    assert.deepEqual(fs.readFileSync(file), bytes);
    fs.writeFileSync(file, '{"broken":true}');
    assert.throws(
      () => openProviderBridge(f.config),
      code(503, "private-bridge-state-unavailable"),
    );
    assert.equal(fs.readFileSync(file, "utf8"), '{"broken":true}');
    if (process.platform !== "win32") {
      const pub = path.join(f.root, "public");
      fs.mkdirSync(pub, { mode: 0o755 });
      fs.chmodSync(pub, 0o755);
      assert.throws(() => openProviderBridge({ ...f.config, directory: pub }));
      assert.equal(fs.statSync(pub).mode & 0o777, 0o755);
    }
  } finally {
    f.cleanup();
  }
});

test("provider-bound HTTP rejects spoofing, untrusted origins, excess bodies and raw envelope fields", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-bridge-http-"));
  let service;
  try {
    service = await createProviderBridgeApp({
      stateDir: path.join(root, "state"),
      source: "fixture",
      providers: ["claude", "command-code"],
    });
    await service.listen(0);
    const base = `http://127.0.0.1:${service.app.server.address().port}`,
      claude = JSON.parse(
        fs.readFileSync(path.join(root, "state/runtime/claude.json")),
      ),
      cmd = JSON.parse(
        fs.readFileSync(path.join(root, "state/runtime/command-code.json")),
      ),
      event = producer({ ...cmd, roles: ["executor"] })(1, "session.start");
    const post = (provider, token, body, headers = {}) =>
      fetch(base + "/api/bridge/" + provider, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      });
    assert.equal((await post("command-code", "invalid", event)).status, 401);
    assert.equal((await post("command-code", claude.token, event)).status, 403);
    assert.equal((await post("unknown", cmd.token, event)).status, 404);
    assert.equal(
      (
        await post("command-code", cmd.token, {
          ...event,
          providerId: "claude",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post("command-code", cmd.token, {
          ...event,
          installationInstanceId: uuid(),
        })
      ).status,
      403,
    );
    assert.equal(
      (await post("command-code", cmd.token, { ...event, schemaVersion: 99 }))
        .status,
      409,
    );
    assert.equal(
      (
        await post("command-code", cmd.token, {
          ...event,
          prompt: "PRIVATE-PROMPT",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await post("command-code", cmd.token, event, {
          origin: "https://foreign.invalid",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post("command-code", cmd.token, {
          ...event,
          prompt: "x".repeat(70000),
        })
      ).status,
      413,
    );
    assert.equal((await post("command-code", cmd.token, event)).status, 200);
    assert.equal((await fetch(base + "/api/bridge/snapshot")).status, 401);
    const r = await fetch(base),
      cookie = r.headers.get("set-cookie").split(";")[0],
      snapshot = await fetch(base + "/api/bridge/snapshot", {
        headers: { cookie },
      });
    assert.equal(snapshot.status, 200);
    const value = await snapshot.json();
    assert.equal(value.actors.length, 1);
    assert.equal(value.source, "fixture");
    assert.equal(value.realEnvironmentVerified, false);
    assert.ok(!JSON.stringify(value).includes(cmd.token));
    assert.ok(!JSON.stringify(value).includes("PRIVATE-NATIVE"));
    await service.app.close();
    service = null;
    assert.equal(
      fs.existsSync(path.join(root, "state/runtime/command-code.json")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(root, "state/runtime/claude.json")),
      false,
    );
  } finally {
    await service?.app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parallel tool correlation keeps remaining work active and rejects late reused call identities", () => {
  const f = fixture();
  try {
    const p = f.bridge.principal("command-code"),
      make = producer(p);
    f.bridge.receive(make(1, "session.start"), p);
    f.bridge.receive(
      make(2, "tool.start", {
        nativeToolCallId: "private-call-a",
        tool: "read",
      }),
      p,
    );
    f.bridge.receive(
      make(3, "tool.start", {
        nativeToolCallId: "private-call-b",
        tool: "edit",
      }),
      p,
    );
    f.bridge.receive(
      make(4, "tool.end", { nativeToolCallId: "private-call-a", tool: "read" }),
      p,
    );
    assert.equal(f.bridge.snapshot().actors[0].status, "working");
    assert.equal(f.bridge.snapshot().actors[0].tool, "edit");
    assert.equal(f.bridge.snapshot().actors[0].activeToolCount, 1);
    f.bridge.receive(
      make(5, "tool.end", { nativeToolCallId: "private-call-b", tool: "edit" }),
      p,
    );
    assert.equal(f.bridge.snapshot().actors[0].status, "between-tools");
    assert.equal(f.bridge.snapshot().actors[0].activeToolCount, 0);
    assert.throws(
      () =>
        f.bridge.receive(
          make(6, "tool.start", { nativeToolCallId: "private-call-a" }),
          p,
        ),
      code(409, "tool-identity-reused"),
    );
    assert.ok(
      !fs
        .readFileSync(
          path.join(f.config.directory, "provider-bridge.json"),
          "utf8",
        )
        .includes("private-call"),
    );
  } finally {
    f.cleanup();
  }
});

test("separate bridge startup never overwrites an existing registry and close removes only owned tokens", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-bridge-registry-"));
  let first, second;
  try {
    first = await createProviderBridgeApp({
      stateDir: path.join(root, "state"),
      source: "fixture",
    });
    await first.listen(0);
    const registry = path.join(root, "state/runtime/command-code.json"),
      before = fs.readFileSync(registry);
    second = await createProviderBridgeApp({
      stateDir: path.join(root, "state"),
      source: "fixture",
    });
    await assert.rejects(() => second.listen(0));
    second = null;
    assert.deepEqual(fs.readFileSync(registry), before);
    const replaced = { ...JSON.parse(before), token: "f".repeat(64) };
    fs.writeFileSync(registry, JSON.stringify(replaced));
    await first.app.close();
    first = null;
    assert.deepEqual(JSON.parse(fs.readFileSync(registry)), replaced);
  } finally {
    await second?.app.close();
    await first?.app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("active actor capacity is bounded without deleting terminal identity mappings", () => {
  const f = fixture({ maxActors: 1 });
  try {
    const p = f.bridge.principal("command-code"),
      first = producer(p, { nativeSessionId: "one" }),
      second = producer(p, { nativeSessionId: "two" });
    f.bridge.receive(first(1, "session.start"), p);
    const original = f.bridge.snapshot().actors[0].actorId;
    assert.throws(
      () => f.bridge.receive(second(1, "session.start"), p),
      code(429, "active-actor-capacity"),
    );
    f.bridge.receive(first(2, "execution.end"), p);
    f.bridge.receive(second(1, "session.start"), p);
    assert.equal(f.bridge.snapshot().actors.length, 1);
    assert.notEqual(f.bridge.snapshot().actors[0].actorId, original);
    assert.equal(f.bridge.snapshot().terminalCount, 1);
  } finally {
    f.cleanup();
  }
});

test("bridge refuses a public or symlinked namespace before creating a ledger", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "orbit-bridge-namespace-"),
  );
  try {
    if (process.platform !== "win32") {
      const pub = path.join(root, "public");
      fs.mkdirSync(pub, { mode: 0o755 });
      fs.chmodSync(pub, 0o755);
      await assert.rejects(() => createProviderBridgeApp({ stateDir: pub }));
      assert.equal(fs.existsSync(path.join(pub, "ledger")), false);
      assert.equal(fs.statSync(pub).mode & 0o777, 0o755);
      const target = path.join(root, "target"),
        link = path.join(root, "link");
      fs.mkdirSync(target, { mode: 0o700 });
      fs.symlinkSync(target, link, "dir");
      await assert.rejects(() => createProviderBridgeApp({ stateDir: link }));
      assert.equal(fs.existsSync(path.join(target, "ledger")), false);
    } else {
      // Exercise the new namespace ACL path on Windows without requiring symlink privilege.
      const stateDir = path.join(root, "private"),
        service = await createProviderBridgeApp({ stateDir });
      assertPrivate(stateDir, { directory: true });
      await service.app.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("two executions streaming at once never cross sequences, actors or terminals", () => {
  const f = fixture();
  try {
    const p = f.bridge.principal("command-code");
    const A = producer(p, { nativeSessionId: "PRIVATE-A" }),
      B = producer(p, { nativeSessionId: "PRIVATE-B" });
    const plan = (make) => [
      make(1, "session.start"),
      make(2, "tool.start"),
      make(3, "tool.end"),
      make(4, "turn.end"),
      make(5, "execution.end"),
    ];
    const a = plan(A),
      b = plan(B);
    // Two subprocesses write at their own pace, so the bridge sees the streams
    // interleaved rather than one run after another. Both use call-2 as their
    // first tool call: equal native IDs must stay inside their own execution.
    for (let step = 0; step < 5; step++) {
      f.bridge.receive(a[step], p);
      f.bridge.receive(b[step], p);
      if (step === 0) {
        const mid = f.bridge.snapshot();
        assert.equal(mid.actors.length, 2);
        assert.equal(new Set(mid.actors.map((x) => x.renderId)).size, 2);
      }
    }
    assert.equal(f.bridge.snapshot().actors.length, 0);
    const ledger = JSON.parse(
      fs.readFileSync(path.join(f.config.directory, "provider-bridge.json")),
    );
    const executions = Object.values(ledger.executions).filter((e) => e.started);
    assert.equal(executions.length, 2);
    assert.equal(executions.filter((e) => e.terminal).length, 2);
    assert.equal(new Set(executions.map((e) => e.sessionKey)).size, 2);
  } finally {
    f.cleanup();
  }
});

test("a finished execution cannot swallow the other stream, and neither revives", () => {
  const f = fixture();
  try {
    const p = f.bridge.principal("command-code");
    const A = producer(p, { nativeSessionId: "PRIVATE-A" }),
      B = producer(p, { nativeSessionId: "PRIVATE-B" });
    f.bridge.receive(A(1, "session.start"), p);
    f.bridge.receive(B(1, "session.start"), p);
    // B finishes first while A is still mid-tool.
    f.bridge.receive(B(2, "tool.start"), p);
    f.bridge.receive(B(3, "tool.end"), p);
    f.bridge.receive(B(4, "turn.end"), p);
    f.bridge.receive(B(5, "execution.end"), p);
    assert.equal(f.bridge.snapshot().actors.length, 1);
    // A keeps working; B's terminal must not reach across.
    f.bridge.receive(A(2, "tool.start"), p);
    f.bridge.receive(A(3, "tool.end"), p);
    assert.equal(f.bridge.snapshot().actors.length, 1);
    assert.throws(
      () => f.bridge.receive(B(6, "tool.start"), p),
      code(409, "terminal-execution"),
    );
    f.bridge.receive(A(4, "turn.end"), p);
    f.bridge.receive(A(5, "execution.end"), p);
    assert.equal(f.bridge.snapshot().actors.length, 0);
  } finally {
    f.cleanup();
  }
});
