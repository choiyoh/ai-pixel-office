import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.mjs";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import { readOmpTransport } from "../platform/bridge-transport.mjs";
import { ompStreamEvent, ompExitEvent } from "../server/bridge/omp.mjs";

test("OMP office proxy is cookie protected, read only, source scoped and preserves Claude API", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-omp-office-"));
  let office, bridge;
  try {
    office = await createApp({
      mode: "claude-local",
      source: "fixture",
      stateDir: root,
    });
    await office.listen(0);
    const base = `http://127.0.0.1:${office.app.server.address().port}`;
    assert.equal((await fetch(base + "/api/omp/snapshot")).status, 401);
    const response = await fetch(base),
      cookie = response.headers.get("set-cookie").split(";")[0];
    const read = () =>
      fetch(base + "/api/omp/snapshot", { headers: { cookie } });
    assert.equal((await read()).status, 409);
    assert.equal(fs.existsSync(path.join(root, "provider-bridge-omp")), false);
    bridge = await createProviderBridgeApp({
      stateDir: path.join(root, "provider-bridge-omp"),
      source: "fixture",
      providers: ["omp"],
    });
    await bridge.listen(0);
    const transport = readOmpTransport({
      directory: path.join(root, "provider-bridge-omp"),
    });
    let sequence = 0;
    const context = {
      ...transport,
      nativeSessionId: "PRIVATE-SESSION",
      logicalTaskId: randomUUID(),
      executionId: randomUUID(),
      modelFamily: "deepseek",
      modelProvider: "commandcode",
      startSource: "startup",
    };
    const emit = (raw) =>
      transport.send(
        ompStreamEvent(raw, {
          ...context,
          eventId: randomUUID(),
          sequence: ++sequence,
          occurredAt: new Date().toISOString(),
        }),
      );
    await emit({ type: "session" });
    await emit({
      type: "tool_execution_start",
      toolName: "read",
      toolCallId: "PRIVATE-CALL|1",
      args: { path: "/PRIVATE-PATH" },
    });
    const ledger = path.join(
        root,
        "provider-bridge-omp/ledger/provider-bridge.json",
      ),
      before = fs.readFileSync(ledger);
    const r = await read();
    assert.equal(r.status, 200);
    const s = await r.json();
    assert.equal(s.actors.length, 1);
    assert.equal(s.actors[0].providerId, "omp");
    assert.equal(s.actors[0].modelFamily, "deepseek");
    assert.equal(s.actors[0].status, "working");
    assert.equal(s.actors[0].lastTool, "Read");
    assert.equal(s.actors[0].name, "OMP · 001");
    assert.deepEqual(fs.readFileSync(ledger), before);
    const registry = JSON.parse(
      fs.readFileSync(path.join(root, "provider-bridge-omp/runtime/omp.json")),
    );
    for (const secret of [
      "PRIVATE-SESSION",
      "PRIVATE-CALL",
      "PRIVATE-PATH",
      registry.token,
    ])
      assert.ok(!JSON.stringify(s).includes(secret));
    assert.equal(
      (
        await fetch(base + "/api/omp/snapshot", {
          headers: { cookie, origin: "https://untrusted.invalid" },
        })
      ).status,
      403,
    );
    const claude = await (
      await fetch(base + "/api/live/snapshot", { headers: { cookie } })
    ).json();
    assert.equal(claude.actors.length, 0);
    assert.notEqual(claude.installationInstanceId, s.installationInstanceId);
    await emit({
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "PRIVATE-CALL|1",
      isError: false,
    });
    const ended = await (await read()).json();
    assert.equal(ended.actors[0].status, "between-tools");
    assert.equal(ended.timeline[0].kind, "toolEnd");
    await transport.send(
      ompExitEvent(
        {
          ...context,
          eventId: randomUUID(),
          sequence: ++sequence,
          occurredAt: new Date().toISOString(),
        },
        { exitCode: 0 },
      ),
    );
    const terminal = await (await read()).json();
    assert.equal(terminal.actors.length, 0);
    assert.equal(terminal.timeline[0].kind, "sessionEnd");
    await bridge.app.close();
    bridge = null;
    assert.equal((await read()).status, 409);
  } finally {
    await bridge?.app.close();
    await office?.app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("OMP office rejects live/fixture drift without forwarding upstream payload", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-omp-source-"));
  let office, bridge;
  try {
    office = await createApp({
      mode: "claude-local",
      source: "fixture",
      stateDir: root,
    });
    await office.listen(0);
    bridge = await createProviderBridgeApp({
      stateDir: path.join(root, "provider-bridge-omp"),
      source: "live",
      providers: ["omp"],
    });
    await bridge.listen(0);
    const base = `http://127.0.0.1:${office.app.server.address().port}`,
      response = await fetch(base),
      cookie = response.headers.get("set-cookie").split(";")[0];
    const r = await fetch(base + "/api/omp/snapshot", { headers: { cookie } });
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), {
      ready: false,
      error: "omp-unavailable",
    });
  } finally {
    await bridge?.app.close();
    await office?.app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
