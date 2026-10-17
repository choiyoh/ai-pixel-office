import path from "node:path";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import { stateRoot } from "../platform/runtime.mjs";
import { ensurePrivateDirectory } from "../platform/private-files.mjs";
// A distinct namespace and explicit launch. No hook or CLI is installed.
let instance;
try {
  const port = Number(process.env.ORBIT_BRIDGE_PORT ?? 4183);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("invalid-port");
  ensurePrivateDirectory(stateRoot());
  instance = await createProviderBridgeApp({
    stateDir: path.join(stateRoot(), "provider-bridge-omp"),
    source: "live",
    providers: ["omp"],
  });
  await instance.listen(port);
  console.log(
    "Orbit OMP provider bridge ready on loopback. Live Office integration is separate.",
  );
} catch {
  console.error(
    "Provider bridge startup refused. Existing state and registry were not reset. Check local permissions and port ownership.",
  );
  process.exitCode = 1;
}
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await instance?.app.close();
  process.disconnect?.();
};
process.on("message", (m) => {
  if (m?.type === "orbit:shutdown") void close();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void close();
  });
