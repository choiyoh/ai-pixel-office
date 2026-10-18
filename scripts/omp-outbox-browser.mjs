import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.mjs";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import { openOmpOutbox, replayOmpOutbox } from "../platform/omp-outbox.mjs";
import { ompStreamEvent, ompExitEvent } from "../server/bridge/omp.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-outbox-browser-"));
let app, bridge, browser, page;
const result = {
  source: "synthetic-delayed-outbox",
  realEnvironmentVerified: false,
};
try {
  const directory = path.join(root, "omp-outbox"),
    bridgeDirectory = path.join(root, "provider-bridge-omp");
  bridge = await createProviderBridgeApp({
    stateDir: bridgeDirectory,
    providers: ["omp"],
    source: "fixture",
  });
  await bridge.listen(0);
  const transport = openOmpOutbox({ directory, bridgeDirectory });
  const ctx = {
    installationInstanceId: transport.installationInstanceId,
    executionId: randomUUID(),
    logicalTaskId: randomUUID(),
    nativeSessionId: "b".repeat(64),
    startSource: "startup",
    modelFamily: "deepseek",
    modelProvider: "commandcode",
  };
  let sequence = 0;
  const meta = () => ({
    ...ctx,
    eventId: randomUUID(),
    sequence: ++sequence,
    occurredAt: new Date(Date.now() - 60000).toISOString(),
  });
  await transport.send(ompStreamEvent({ type: "session" }, meta()));
  await transport.send(
    ompStreamEvent(
      {
        type: "tool_execution_start",
        toolName: "read",
        toolCallId: "PRIVATE-CALL|1",
      },
      meta(),
    ),
  );
  app = await createApp({
    mode: "claude-local",
    source: "fixture",
    stateDir: root,
  });
  await app.listen(0);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(`http://127.0.0.1:${app.app.server.address().port}`);
  await page.getByRole("button", { name: "LIVE OFFICE", exact: true }).click();
  await page.getByLabel("Live 관찰 채널").selectOption("omp");
  await expect(page.getByTestId("live-count")).toHaveText("0");
  expect((await replayOmpOutbox({ directory, bridgeDirectory })).pending).toBe(
    0,
  );
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await expect(page.getByTestId("live-working")).toHaveText("0");
  const actors = async () =>
    JSON.parse(
      (await page.locator("canvas").getAttribute("data-actors")) ?? "[]",
    );
  await expect.poll(async () => (await actors())[0]?.active).toBe(false);
  expect((await actors())[0]?.tool).toBe(null);
  await page.getByTestId("live-agent-1").click();
  await expect(page.getByTestId("live-inspector")).toContainText("stale");
  result.oldWorkFrozen = true;
  await page.screenshot({
    path: "artifacts/omp-outbox-stale.png",
    fullPage: true,
  });
  await transport.send(
    ompStreamEvent(
      {
        type: "tool_execution_end",
        toolName: "read",
        toolCallId: "PRIVATE-CALL|1",
        isError: false,
      },
      meta(),
    ),
  );
  await transport.send(ompStreamEvent({ type: "agent_end" }, meta()));
  await transport.send(ompExitEvent(meta(), { exitCode: 0 }));
  expect((await replayOmpOutbox({ directory, bridgeDirectory })).pending).toBe(
    0,
  );
  await expect(page.getByTestId("live-count")).toHaveText("0");
  await expect.poll(async () => (await actors()).length).toBe(0);
  result.terminalReplayed = true;
  const raw = JSON.parse(
    fs.readFileSync(path.join(bridgeDirectory, "ledger/provider-bridge.json")),
  );
  expect(raw.revision).toBe(5);
  expect(Object.values(raw.executions)[0].terminal).toBe(true);
  expect(
    JSON.stringify(await page.locator("body").innerText()).includes(
      "PRIVATE-CALL",
    ),
  ).toBe(false);
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.failureType =
    error?.name === "TimeoutError" ? "timeout" : "assertion-or-browser";
  process.exitCode = 1;
} finally {
  await browser?.close();
  await bridge?.app.close();
  await app?.app.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.writeFileSync(
    "artifacts/omp-outbox-browser.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
}
