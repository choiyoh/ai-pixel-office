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

const which = (name) =>
  spawnSync(process.platform === "win32" ? "where.exe" : "which", [name], {
    encoding: "utf8",
    shell: false,
  });
const whichOmp = which("omp");
report.whichOmp = (whichOmp.stdout || "").trim() || { status: whichOmp.status };

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

// A CI runner has no ~/.bun/bin on PATH, so resolve every candidate by absolute
// path as well — the point is to learn which ones the observer can spawn.
const absolute = (...parts) => path.join(binDir, ...parts);
const dedupe = (values) => values.filter((v, i, a) => a.indexOf(v) === i);
report.candidates = {
  omp: dedupe([
    absolute(process.platform === "win32" ? "omp.exe" : "omp"),
    absolute("omp.exe"),
    absolute("omp"),
  ]),
  bun: dedupe([absolute(process.platform === "win32" ? "bun.exe" : "bun"), absolute("bun.exe"), absolute("bun")]),
};
report.candidates.omp = report.candidates.omp.filter((p) => fs.existsSync(p));
report.candidates.bun = report.candidates.bun.filter((p) => fs.existsSync(p));
const npmPrefix = spawnSync("npm", ["prefix", "-g"], { encoding: "utf8", shell: false });
report.npmPrefix = npmPrefix.status === 0 ? npmPrefix.stdout.trim() : { status: npmPrefix.status };
if (npmPrefix.status === 0) {
  const prefix = npmPrefix.stdout.trim();
  for (const relative of [
    process.platform === "win32" ? "bun.exe" : "bin/bun",
    process.platform === "win32" ? "bun.cmd" : "bin/bun.cmd",
    "bun.exe",
    "bun",
  ]) {
    const npmBun = path.join(prefix, relative);
    if (fs.existsSync(npmBun)) report.candidates.bun.push(npmBun);
  }
}
const whereBun = which("bun");
report.whichBun = (whereBun.stdout || "").trim() || { status: whereBun.status };

// Two shapes are recorded. The first is the omp-deepseek delegation verbatim;
// the second pins the provider, because a runner holding only a Command Code
// credential may need it explicit before deepseek/* resolves there (the first
// probe run resolved it to openrouter and stopped for a missing key).
const tail = [
  "--no-session",
  "--no-extensions",
  "--max-time",
  "1m",
  "Reply with OK only.",
];
const shapes = [
  {
    label: "delegation shape",
    args: ["-p", "--model", "deepseek/deepseek-v4.1-flash", ...tail],
  },
  {
    label: "provider pinned",
    args: [
      "-p",
      "--provider",
      "commandcode",
      "--model",
      "deepseek/deepseek-v4.1-flash",
      ...tail,
    ],
  },
];

// PROBE_SKIP_RUNS=1 exercises the resolution half locally without launching
// OMP, which would answer for real on a credentialed machine.
const skipRuns = process.env.PROBE_SKIP_RUNS === "1";

const attempt = async (label, options) => {
  if (skipRuns) {
    report.spawns.push({ label, skipped: "PROBE_SKIP_RUNS" });
    return;
  }
  try {
    const result = await observeOmp({
      args: options.args,
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

// A user's login shell has ~/.bun/bin on PATH; give the runner the same view
// before falling back to absolute paths.
const delimiter = process.platform === "win32" ? ";" : ":";
process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ""}`;

// Absolute shapes (bun + cli.js) were proven in run 39186534438; this pass
// records both launch shapes through PATH and the absolute shim only, which
// keeps a credentialed run down to a handful of cheap calls.
for (const shape of shapes) {
  await attempt(`[${shape.label}] executable=omp (PATH incl. bun bin)`, {
    executable: "omp",
    args: shape.args,
  });
  const absoluteOmp = report.candidates.omp[0];
  if (absoluteOmp)
    await attempt(`[${shape.label}] executable=${absoluteOmp}`, {
      executable: absoluteOmp,
      args: shape.args,
    });
}

// The observer reports only that stderr was seen; the decisive evidence is the
// child's own output, so run each candidate directly and keep the tail. This is
// why the probe is CI-only: a credentialed machine would print a real answer.
report.direct = skipRuns
  ? report.candidates.omp.flatMap((candidate) =>
      shapes.map((shape) => ({
        candidate,
        shape: shape.label,
        skipped: "PROBE_SKIP_RUNS",
      })),
    )
  : report.candidates.omp.flatMap((candidate) => {
      const version = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        shell: false,
        timeout: 60000,
      });
      return shapes.map((shape) => {
        const run = spawnSync(candidate, shape.args, {
          encoding: "utf8",
          shell: false,
          timeout: 120000,
          input: "",
        });
        return {
          candidate,
          shape: shape.label,
          version: {
            status: version.status,
            stdout: (version.stdout || "").trim().slice(0, 200),
            stderr: (version.stderr || "").trim().slice(0, 200),
          },
          run: {
            status: run.status,
            stdoutTail: (run.stdout || "").trim().slice(-400),
            stderrTail: (run.stderr || "").trim().slice(-400),
          },
        };
      });
    });

fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
const file = path.join(
  root,
  "artifacts",
  `omp-native-probe-${process.platform}.json`,
);
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
