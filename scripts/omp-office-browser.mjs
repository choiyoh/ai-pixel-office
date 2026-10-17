import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.mjs";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import { readOmpTransport } from "../platform/bridge-transport.mjs";
import { ompStreamEvent, ompExitEvent } from "../server/bridge/omp.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-omp-browser-"));
let app,
  bridge,
  browser,
  page,
  stage = "startup";
const result = {
  source: "synthetic-omp-office-http",
  realEnvironmentVerified: false,
};
try {
  app = await createApp({
    mode: "claude-local",
    source: "fixture",
    stateDir: root,
  });
  await app.listen(0);
  const startBridge = async () => {
    bridge = await createProviderBridgeApp({
      stateDir: path.join(root, "provider-bridge-omp"),
      source: "fixture",
      providers: ["omp"],
    });
    await bridge.listen(0);
  };
  await startBridge();
  const base = `http://127.0.0.1:${app.app.server.address().port}`,
    token = JSON.parse(
      fs.readFileSync(path.join(root, "runtime/receiver.json")),
    ).token;
  let transport = readOmpTransport({
      directory: path.join(root, "provider-bridge-omp"),
    }),
    sequence = 0;
  const context = {
    installationInstanceId: transport.installationInstanceId,
    nativeSessionId: "PRIVATE-OMP-SESSION",
    executionId: randomUUID(),
    logicalTaskId: randomUUID(),
    startSource: "startup",
    modelProvider: "commandcode",
    modelFamily: "deepseek",
  };
  const meta = () => ({
    ...context,
    eventId: randomUUID(),
    sequence: ++sequence,
    occurredAt: new Date().toISOString(),
  });
  const emit = async (raw) =>
    expect((await transport.send(ompStreamEvent(raw, meta()))).accepted).toBe(
      true,
    );
  const claude = async (event) =>
    expect(
      (
        await fetch(base + "/api/hooks/claude", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            session_id: "PRIVATE-CLAUDE",
            hook_event_name: event,
          }),
        })
      ).status,
    ).toBe(200);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", () => errors.push(true));
  await page.goto(base);
  await page.getByRole("button", { name: "LIVE OFFICE", exact: true }).click();
  await claude("SessionStart");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await page.getByTestId("live-agent-1").click();
  await page.getByLabel("Live 좌석 이동").selectOption("meeting-1");
  const actors = async () =>
    JSON.parse(
      (await page.locator("canvas").getAttribute("data-actors")) ?? "[]",
    );
  stage = "omp-channel";
  await page.getByLabel("Live 관찰 채널").selectOption("omp");
  await expect(page.getByTestId("live-count")).toHaveText("0");
  await emit({ type: "session" });
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await page.getByTestId("live-agent-1").click();
  await expect(page.getByTestId("live-inspector")).toContainText("DeepSeek");
  await expect(page.getByTestId("live-inspector")).toContainText(
    "Command Code",
  );
  await page.getByLabel("Live 좌석 이동").selectOption("meeting-2");
  stage = "short-read";
  await page.waitForResponse((r) => r.url().endsWith("/api/omp/snapshot"));
  await emit({
    type: "tool_execution_start",
    toolName: "read",
    toolCallId: "PRIVATE-CALL|1",
    args: { path: "/PRIVATE-PATH" },
  });
  await new Promise((r) => setTimeout(r, 100));
  await emit({
    type: "tool_execution_end",
    toolName: "read",
    toolCallId: "PRIVATE-CALL|1",
    isError: false,
    result: { text: "PRIVATE-RESULT" },
  });
  await expect
    .poll(async () => (await actors())[0]?.tool, {
      timeout: 5000,
      intervals: [20],
    })
    .toBe("Read");
  await expect(page.getByTestId("live-working")).toHaveText("0");
  await expect(page.getByTestId("live-inspector")).toContainText("도구 종료");
  await page.screenshot({
    path: "artifacts/omp-office-short-read.png",
    fullPage: true,
  });
  await expect
    .poll(async () => (await actors())[0]?.tool, {
      timeout: 3000,
      intervals: [20],
    })
    .toBe(null);
  result.shortReadBusinessEnded = true;
  stage = "seat-scope";
  await page.reload();
  await expect(page.getByLabel("Live 관찰 채널")).toHaveValue("omp");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await expect.poll(async () => (await actors())[0]?.seat).toBe("meeting-2");
  await page.getByLabel("Live 관찰 채널").selectOption("claude");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await expect.poll(async () => (await actors())[0]?.seat).toBe("meeting-1");
  await expect(page.getByTestId("live-agent-1")).toContainText("Claude");
  await page.getByLabel("Live 관찰 채널").selectOption("omp");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await expect.poll(async () => (await actors())[0]?.seat).toBe("meeting-2");
  result.channelSeatsPreserved = true;
  stage = "mode-return";
  await page.getByRole('button',{name:'MOCK SANDBOX',exact:true}).click();
  await emit({type:'tool_execution_start',toolName:'read',toolCallId:'PRIVATE-CALL|mode'});
  await emit({type:'tool_execution_end',toolName:'read',toolCallId:'PRIVATE-CALL|mode',isError:false});
  await page.getByRole('button',{name:'LIVE OFFICE',exact:true}).click();
  await page.waitForResponse(r=>r.url().endsWith('/api/omp/snapshot'));
  await expect(page.getByTestId('live-working')).toHaveText('0');
  expect((await actors())[0]?.tool).toBe(null);
  result.modeReturnSkippedOldAnimation=true;
  stage = "outage";
  await page.route("**/api/omp/snapshot", (route) =>
    route.fulfill({
      status: 503,
      json: { ready: false, error: "omp-unavailable" },
    }),
  );
  await expect(page.getByTestId("live-connection")).toContainText("연결 끊김");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await expect.poll(async () => (await actors())[0]?.active).toBe(false);
  await emit({
    type: "tool_execution_start",
    toolName: "edit",
    toolCallId: "PRIVATE-CALL|2",
  });
  await emit({
    type: "tool_execution_end",
    toolName: "edit",
    toolCallId: "PRIVATE-CALL|2",
    isError: false,
  });
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByTestId("live-connection")).toContainText(
    "OMP 로컬 수신 준비",
  );
  await expect(page.getByTestId("live-working")).toHaveText("0");
  expect((await actors())[0]?.tool).toBe(null);
  result.recoverySkippedOldAnimation = true;
  stage = "bridge-restart";
  await page.getByRole('button',{name:'MOCK SANDBOX',exact:true}).click();
  await bridge.app.close();
  bridge = null;
  await page.getByRole('button',{name:'LIVE OFFICE',exact:true}).click();
  await expect(page.getByTestId("live-connection")).toContainText("연결 끊김");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await startBridge();
  transport = readOmpTransport({
    directory: path.join(root, "provider-bridge-omp"),
  });
  await expect(page.getByTestId("live-connection")).toContainText(
    "OMP 로컬 수신 준비",
  );
  await expect.poll(async () => (await actors())[0]?.seat).toBe("meeting-2");
  result.bridgeRestartPreservedIdentity = true;
  stage = "privacy";
  await page.getByTestId("live-agent-1").click();
  const bytes = await page.locator("body").innerText(),
    storage = await page.evaluate(() => JSON.stringify(localStorage));
  for (const value of [
    "PRIVATE-OMP-SESSION",
    "PRIVATE-CLAUDE",
    "PRIVATE-PATH",
    "PRIVATE-RESULT",
    "PRIVATE-CALL",
    token,
  ]) {
    expect(bytes.includes(value)).toBe(false);
    expect(storage.includes(value)).toBe(false);
  }
  expect(storage.includes(context.nativeSessionId)).toBe(false);
  stage = "mobile";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/omp-office-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  stage = "terminal";
  await transport.send(ompExitEvent(meta(), { exitCode: 0 }));
  await expect(page.getByTestId("live-count")).toHaveText("0");
  await expect.poll(async () => (await actors()).length).toBe(0);
  expect(errors.length).toBe(0);
  result.passed = true;
} catch (error) {
  if(page){
    result.lastView={count:await page.getByTestId('live-count').textContent().catch(()=>null),connection:await page.getByTestId('live-connection').textContent().catch(()=>null),actors:await page.locator('canvas').getAttribute('data-actors').then(v=>JSON.parse(v??'[]').map(a=>({id:a.id,active:a.active,tool:a.tool,seat:a.seat}))).catch(()=>[])};
  }
  result.passed = false;
  result.failure = {
    stage,
    kind: error?.name === "TimeoutError" ? "timeout" : "assertion-or-browser",
  };
  process.exitCode = 1;
} finally {
  await browser?.close();
  await bridge?.app.close();
  await app?.app.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/omp-office-browser.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
}
