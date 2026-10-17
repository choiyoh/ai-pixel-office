import { observeOmp } from "../platform/observe-omp.mjs";
import { readOmpTransport } from "../platform/bridge-transport.mjs";
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 1024 * 1024) {
    console.error("OMP observer input limit exceeded.");
    process.exitCode = 2;
    break;
  }
  chunks.push(chunk);
}
if (!process.exitCode) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const result = await observeOmp({
      executable: process.env.ORBIT_OMP_EXECUTABLE ?? "omp",
      args,
      signal: controller.signal,
      cwd: process.cwd(),
      input: Buffer.concat(chunks),
      transport: readOmpTransport(),
      onOutput: (text) => process.stdout.write(text ? text + "\n" : ""),
    });
    process.exitCode = result.exitCode ?? 1;
  } catch {
    console.error(
      "OMP observer refused an unsupported launch. Existing settings were not modified.",
    );
    process.exitCode = 2;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
