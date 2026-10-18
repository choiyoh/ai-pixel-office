import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { observeOmp } from "../platform/observe-omp.mjs";
import { openOmpOutbox } from "../platform/omp-outbox.mjs";
import { stateRoot } from "../platform/runtime.mjs";
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
let size = 0;
const chunks = [];
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 1024 * 1024) {
    process.stderr.write("OMP observer input limit exceeded.\n");
    process.exitCode = 2;
    break;
  }
  chunks.push(chunk);
}
if (!process.exitCode) {
  const root = stateRoot(),
    controller = new AbortController(),
    stop = () => controller.abort();
  let worker = null,
    lastStart = 0,
    retryDelay = 1000;
  const kick = (force = false) => {
    if (
      !transport ||
      (!force && (worker || Date.now() - lastStart < retryDelay))
    )
      return;
    lastStart = Date.now();
    // The bounded replayer has no business stdin/stdout. It may finish after the
    // producer exits; its failures cannot replace OMP's response or exit code.
    try {
      worker = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./replay-omp-outbox.mjs", import.meta.url)),
          "--state-dir",
          root,
        ],
        {
          stdio: "ignore",
          shell: false,
          windowsHide: true,
          detached: true,
          env: Object.fromEntries(
            [
              "HOME",
              "USERPROFILE",
              "PATH",
              "TMPDIR",
              "TEMP",
              "TMP",
              "SystemRoot",
              "SYSTEMROOT",
              "LOCALAPPDATA",
            ]
              .filter((k) => process.env[k] !== undefined)
              .map((k) => [k, process.env[k]]),
          ),
        },
      );
      const ownedWorker = worker;
      worker.on("error", () => {
        if (worker === ownedWorker) worker = null;
      });
      worker.on("close", (code) => {
        if (worker === ownedWorker) {
          worker = null;
          retryDelay = code === 0 ? 1000 : Math.min(15000, retryDelay * 2);
        }
      });
      worker.unref();
    } catch {
      worker = null;
    }
  };
  let transport = null;
  try {
    transport = openOmpOutbox({
      directory: path.join(root, "omp-outbox"),
      bridgeDirectory: path.join(root, "provider-bridge-omp"),
      onQueued: kick,
    });
  } catch {
    process.stderr.write(
      "OMP durable observation unavailable; business execution will continue.\n",
    );
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const timer = setInterval(kick, 1500);
  timer.unref();
  try {
    const result = await observeOmp({
      executable: process.env.ORBIT_OMP_EXECUTABLE ?? "omp",
      args,
      signal: controller.signal,
      cwd: process.cwd(),
      input: Buffer.concat(chunks),
      transport,
      onOutput: (text) => process.stdout.write(text ? text + "\n" : ""),
    });
    process.exitCode = result.exitCode ?? 1;
    if (result.deliveryErrors || result.observationOverflow)
      process.stderr.write(
        "OMP observation was incomplete; queued events were retained.\n",
      );
    kick(true);
  } catch {
    process.stderr.write(
      "OMP observer refused an unsupported launch. Settings were not changed.\n",
    );
    process.exitCode = 2;
  } finally {
    clearInterval(timer);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
