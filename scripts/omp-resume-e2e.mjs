#!/usr/bin/env node
// Manual end-to-end check for the OMP resume contract (real model calls, real
// bridge ledger). Runs a stored-fresh session and then resumes it, printing the
// actor/generation verdict. Never run from CI: it needs a signed-in OMP.
//
//   node scripts/omp-resume-e2e.mjs [root-dir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openProviderBridge } from "../server/bridge/ledger.mjs";
import { observeOmp } from "../platform/observe-omp.mjs";

const OMP = process.env.OMP_BIN ?? "omp";
const ROOT =
  process.argv[2] ??
  fs.mkdtempSync(path.join(os.tmpdir(), "orbit-omp-resume-"));
fs.rmSync(ROOT, { recursive: true, force: true });
const work = path.join(ROOT, "work"),
  sessions = path.join(ROOT, "sessions");
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(sessions, { recursive: true });
const bridge = openProviderBridge({
  directory: path.join(ROOT, "ledger"),
  providers: ["omp"],
  source: "fixture",
});
const principal = bridge.principal("omp");
const say = (...a) => console.log(...a);

async function run(label, args) {
  const seen = [];
  const r = await observeOmp({
    executable: OMP,
    args,
    cwd: work,
    transport: {
      installationInstanceId: principal.installationInstanceId,
      send: (e) => {
        seen.push(e);
        return bridge.receive(e, principal);
      },
    },
    onOutput: () => {},
  });
  for (const e of seen)
    if (["session.start", "tool.start", "tool.end"].includes(e.kind))
      say(
        `${label} ${e.kind}`,
        JSON.stringify({
          startSource: e.startSource,
          native: e.nativeSessionId
            ? String(e.nativeSessionId).slice(0, 10)
            : null,
        }),
      );
  say(`${label} exit=${r.exitCode} sent=${r.sent} deliveryErrors=${r.deliveryErrors}`);
}

const common = ["--no-extensions", "--max-time", "3m", "--session-dir", sessions];

say("=== RUN A: stored fresh ===");
await run("A", [
  "-p",
  "Create a file named hello-e2e.txt whose content is exactly: orbit resume works",
  ...common,
  "--tools",
  "read,write,edit",
  "--auto-approve",
]);
const files = fs.readdirSync(sessions).filter((f) => f.endsWith(".jsonl"));
const sidPath = path.join(sessions, files.sort().at(-1));
say("session files:", JSON.stringify(files));
say("hello-e2e.txt A:", JSON.stringify(fs.readFileSync(path.join(work, "hello-e2e.txt"), "utf8")));

say("=== RUN B: explicit resume ===");
await run("B", [
  "-p",
  "Read hello-e2e.txt and append a second line containing: resumed ok",
  ...common,
  "--resume",
  sidPath,
  "--tools",
  "read,write,edit",
  "--auto-approve",
]);
say("hello-e2e.txt B:", JSON.stringify(fs.readFileSync(path.join(work, "hello-e2e.txt"), "utf8")));

const snap = bridge.snapshot();
const starts = snap.timeline.filter((e) => e.kind === "session.start");
say(
  "VERDICT:",
  JSON.stringify({
    sameNative:
      starts.length === 2 &&
      starts[0].nativeSessionId === starts[1].nativeSessionId,
    sources: starts.map((s) => s.startSource ?? null),
    generations: starts.map((s) => s.generation),
    distinctActors: new Set(starts.map((s) => s.actorId)).size,
    liveActors: snap.actors.length,
    terminalCount: snap.terminalCount,
  }),
);
