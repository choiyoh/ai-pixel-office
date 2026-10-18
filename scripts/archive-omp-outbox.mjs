import path from "node:path";
import { stateRoot } from "../platform/runtime.mjs";
import { archiveOmpOutboxRuns } from "../platform/omp-outbox.mjs";
const args = process.argv.slice(2);
try {
  let apply = false,
    directory = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true;
    else if (args[i] === "--state-dir" && i + 1 < args.length)
      directory = args[++i];
    else throw Error("Unsupported option");
  }
  const root = directory ?? stateRoot();
  if (!path.isAbsolute(root)) throw Error("Absolute state required");
  const report = archiveOmpOutboxRuns({
    directory: path.join(root, "omp-outbox"),
    bridgeDirectory: path.join(root, "provider-bridge-omp"),
    apply,
  });
  console.log(JSON.stringify(report));
  // Exit 3: fully delivered runs were archived (or none were ready), but some
  // runs are waiting on delivery, a live writer, a missing completion marker,
  // or a corrupted directory and must be reviewed before the next archive.
  if (
    report.retainedPending.length ||
    report.retainedIncomplete.length ||
    report.retainedWriters.length ||
    report.retainedBlocked.length
  )
    process.exitCode = 3;
} catch {
  console.error(
    "OMP outbox archive unavailable. Existing runs were retained.",
  );
  process.exitCode = 2;
}
