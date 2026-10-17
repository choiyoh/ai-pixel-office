import path from "node:path";
import { createProviderBridgeApp } from "../server/bridge/app.mjs";
import { stateRoot } from "../platform/runtime.mjs";
// A distinct namespace and explicit launch. No hook or CLI is installed.
const instance = await createProviderBridgeApp({
  stateDir: path.join(stateRoot(), "provider-bridge"),
  source: "live",
});
await instance.listen(Number(process.env.ORBIT_BRIDGE_PORT ?? 4183));
console.log(
  "Orbit provider bridge ready on loopback. Real Command Code/DeepSeek remains unverified.",
);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await instance.app.close();
  process.disconnect?.();
};
process.on("message", (m) => {
  if (m?.type === "orbit:shutdown") void close();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void close();
  });
