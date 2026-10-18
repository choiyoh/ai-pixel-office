import path from "node:path";
import { stateRoot } from "../platform/runtime.mjs";
import { replayOmpOutbox } from "../platform/omp-outbox.mjs";
const args = process.argv.slice(2);
try {
  if (
    args.some((a, i) => i % 2 === 0 && !["--state-dir"].includes(a)) ||
    ![0, 2].includes(args.length)
  )
    throw Error("Unsupported option");
  const directory = args.length ? args[1] : stateRoot();
  if (!path.isAbsolute(directory)) throw Error("Absolute state required");
  const report = await replayOmpOutbox({
    directory: path.join(directory, "omp-outbox"),
    bridgeDirectory: path.join(directory, "provider-bridge-omp"),
  });
  console.log(JSON.stringify(report));
  if (
    report.blockedRuns ||
    report.installationMismatch ||
    report.capacityRemaining === 0
  )
    process.exitCode = 2;
  else if (report.pending || report.offline || report.rejected)
    process.exitCode = 3;
} catch {
  console.error("OMP replay unavailable. Existing events were retained.");
  process.exitCode = 2;
}
