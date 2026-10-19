// CI-only probe for P2-B.6 ④: on this platform, what shape does OMP install
// as, and can the observer spawn it without a command shell?
//
// Never run this against the live stack: it passes no transport, so no outbox
// and no bridge traffic is produced. It also carries no model credentials, so
// an authentication failure from OMP is an expected, recorded outcome rather
// than a fault. Dispatch `.github/workflows/native-omp-probe.yml` to collect
// the evidence; run it by hand only on a machine that may install OMP.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { observeOmp } from "../platform/observe-omp.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const report = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  binDir: null,
  binEntries: null,
  bunVersion: null,
  whichOmp: null,
  ompVersion: null,
  ompCli: null,
  spawns: [],
};

const bunInstall = process.env.BUN_INSTALL ?? path.join(os.homedir(), ".bun");
const binDir = path.join(bunInstall, "bin");
report.binDir = binDir;
try {
  report.binEntries = fs
    .readdirSync(binDir, { withFileTypes: true })
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
} catch (error) {
  report.binEntries = { error: error.code ?? String(error.message) };
}

const bunExe = path.join(
  binDir,
  process.platform === "win32" ? "bun.exe" : "bun",
);
const bun = spawnSync(bunExe, ["--version"], { encoding: "utf8", shell: false });
report.bunVersion =
  bun.status === 0
    ? bun.stdout.trim()
    : { status: bun.status, error: bun.error?.code };

const which = spawnSync(
  process.platform === "win32" ? "where.exe" : "which",
  ["omp"],
  { encoding: "utf8", shell: false },
);
report.whichOmp = (which.stdout || "").trim() || { status: which.status };

const omp = spawnSync("omp", ["--version"], { encoding: "utf8", shell: false });
report.ompVersion =
  omp.status === 0
    ? omp.stdout.trim()
    : {
        status: omp.status,
        error: omp.error?.code,
        stderr: (omp.stderr || "").trim().slice(0, 240),
      };

// The launcher the observer can use with no shell shim at all.
const cli = path.join(
  bunInstall,
  "install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js",
);
report.ompCli = { path: cli, exists: fs.existsSync(cli) };

// The exact launch shape the omp-deepseek delegation uses, minus the task.
const probeArgs = [
  "-p",
  "--model",
  "deepseek/deepseek-v4.1-flash",
  "--no-session",
  "--no-extensions",
  "--max-time",
  "1m",
  "Reply with OK only.",
];

const attempt = async (label, options) => {
  try {
    const result = await observeOmp({
      args: probeArgs,
      input: Buffer.from(""),
      ...options,
    });
    report.spawns.push({
      label,
      exitCode: result.exitCode,
      signal: result.signal,
      sent: result.sent,
      deliveryErrors: result.deliveryErrors,
      observedKinds: result.observedKinds,
      stderrSeen: result.stderrSeen,
    });
  } catch (error) {
    report.spawns.push({ label, refused: String(error.message) });
  }
};

await attempt("executable=omp (PATH)", { executable: "omp" });
if (fs.existsSync(bunExe) && fs.existsSync(cli))
  await attempt("executable=bun + cli launcher", {
    executable: bunExe,
    launcherPrefix: [cli],
  });

fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
const file = path.join(
  root,
  "artifacts",
  `omp-native-probe-${process.platform}.json`,
);
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
