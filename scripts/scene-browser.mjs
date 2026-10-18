import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.mjs";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import { readOmpTransport } from "../platform/bridge-transport.mjs";
import { ompStreamEvent } from "../server/bridge/omp.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-scene-browser-"));
let app, bridge, browser, page, stage = "startup", base = "";
const result = { source: "synthetic-scene-http", realEnvironmentVerified: false };
try {
  app = await createApp({ mode: "claude-local", source: "fixture", stateDir: root });
  await app.listen(0);
  bridge = await createProviderBridgeApp({
    stateDir: path.join(root, "provider-bridge-omp"),
    source: "fixture",
    providers: ["omp"],
  });
  await bridge.listen(0);
  const token = JSON.parse(fs.readFileSync(path.join(root, "runtime/receiver.json"))).token;
  base = `http://127.0.0.1:${app.app.server.address().port}`;
  const transport = readOmpTransport({ directory: path.join(root, "provider-bridge-omp") });
  let sequence = 0;
  const context = {
    installationInstanceId: transport.installationInstanceId,
    nativeSessionId: "PRIVATE-OMP-SESSION",
    executionId: randomUUID(),
    logicalTaskId: randomUUID(),
    startSource: "startup",
    modelProvider: "commandcode",
    modelFamily: "deepseek",
  };
  const meta = () => ({ ...context, eventId: randomUUID(), sequence: ++sequence, occurredAt: new Date().toISOString() });
  const emit = async (raw) => expect((await transport.send(ompStreamEvent(raw, meta()))).accepted).toBe(true);
  const claude = async (event) =>
    expect(
      (
        await fetch(base + "/api/hooks/claude", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ session_id: "PRIVATE-CLAUDE", hook_event_name: event }),
        })
      ).status,
    ).toBe(200);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", () => errors.push(true));
  await page.goto(base);
  await page.getByRole("button", { name: "LIVE OFFICE", exact: true }).click();
  // Both channels independently hand out render id 1; the scene must not collide.
  await claude("SessionStart");
  await emit({ type: "session" });
  stage = "scene-channel";
  await page.getByLabel("Live 관찰 채널").selectOption("scene");
  await expect(page.getByLabel("Live 관찰 채널")).toHaveValue("scene");
  await expect(page.getByTestId("live-count")).toHaveText("2");
  await expect(page.getByTestId("live-connection")).toContainText("통합 관찰 준비");
  const actors = async () => JSON.parse((await page.locator("canvas").getAttribute("data-actors")) ?? "[]");
  await expect.poll(async () => (await actors()).map((a) => a.id).sort((x, y) => x - y)).toEqual([1, 1000001]);
  await expect(page.getByTestId("live-agent-1")).toContainText("Claude · 001");
  await expect(page.getByTestId("live-agent-1000001")).toContainText("OMP · 001");
  result.namespacedEngineKeys = [1, 1000001];
  const snapshot = await (await page.request.get(base + "/api/scene/snapshot")).json();
  expect(snapshot.ready).toBe(true);
  expect(snapshot.providers.claude.ready).toBe(true);
  expect(snapshot.providers.omp.ready).toBe(true);
  expect(snapshot.providers.omp.revision).toBe(snapshot.providers.omp.revision | 0);
  expect(snapshot.actors.map((a) => a.renderId).sort((x, y) => x - y)).toEqual([1, 1000001]);
  expect(snapshot.actors.find((a) => a.providerId === "omp").providerRenderId).toBe(1);
  expect(snapshot.actors.find((a) => a.providerId === "claude").providerRenderId).toBe(1);
  expect(JSON.stringify(snapshot).includes("parentExecution")).toBe(false);
  expect(snapshot.notices).toEqual([]);
  result.bothProvidersReady = true;
  stage = "single-channel-regression";
  await page.getByLabel("Live 관찰 채널").selectOption("claude");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await page.getByLabel("Live 관찰 채널").selectOption("omp");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await page.getByLabel("Live 관찰 채널").selectOption("scene");
  await expect(page.getByTestId("live-count")).toHaveText("2");
  result.channelSwitchPreserved = true;
  stage = "one-channel-ends";
  await claude("SessionEnd");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await expect(page.getByTestId("live-agent-1000001")).toContainText("OMP · 001");
  result.otherChannelSurvivesEnd = true;
  await page.screenshot({ path: "artifacts/scene-unified.png", fullPage: true });
  stage = "no-leak";
  const bytes = await page.content();
  const storage = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  for (const value of ["PRIVATE-OMP-SESSION", "PRIVATE-CLAUDE", token]) {
    expect(bytes.includes(value)).toBe(false);
    expect(storage.includes(value)).toBe(false);
  }
  expect(errors.length).toBe(0);
  result.passed = true;
} catch (error) {
  if (page) {
    const cookies = await page.context().cookies().catch(() => []);
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    result.snapshot = await fetch(base + "/api/scene/snapshot", { headers: { cookie } })
      .then((r) => r.json())
      .catch(() => null);
    result.lastView = {
      count: await page.getByTestId("live-count").textContent().catch(() => null),
      connection: await page.getByTestId("live-connection").textContent().catch(() => null),
      channel: await page.getByLabel("Live 관찰 채널").inputValue().catch(() => null),
      actors: await page
        .locator("canvas")
        .getAttribute("data-actors")
        .then((v) => JSON.parse(v ?? "[]").map((a) => ({ id: a.id, active: a.active, tool: a.tool })))
        .catch(() => []),
    };
  }
  result.passed = false;
  result.failure = {
    stage,
    kind: error?.name === "TimeoutError" ? "timeout" : "assertion-or-browser",
    message: String(error?.message ?? "").slice(0, 240),
  };
  process.exitCode = 1;
} finally {
  await browser?.close();
  await bridge?.app.close();
  await app?.app.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/p2-b6-scene-browser.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
}
