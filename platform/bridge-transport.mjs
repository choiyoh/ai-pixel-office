import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { stateRoot } from "./runtime.mjs";
import { assertPrivate } from "./private-files.mjs";
// Registry/token remain local; no auth material crosses into OMP's model request.
export function readOmpTransport({
  directory = path.join(stateRoot(), "provider-bridge-omp"),
} = {}) {
  try {
    const file = path.join(directory, "runtime/omp.json");
    assertPrivate(file);
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      r.providerId !== "omp" ||
      !/^[a-f0-9]{64}$/.test(r.token) ||
      !Number.isInteger(r.port) ||
      r.port < 1 ||
      r.port > 65535 ||
      !Number.isInteger(r.pid) ||
      r.pid <= 0
    )
      return null;
    process.kill(r.pid, 0);
    return {
      installationInstanceId: r.installationInstanceId,
      send: (event) =>
        new Promise((resolve, reject) => {
          const body = JSON.stringify(event),
            request = http.request(
              {
                host: "127.0.0.1",
                port: r.port,
                path: "/api/bridge/omp",
                method: "POST",
                headers: {
                  authorization: `Bearer ${r.token}`,
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(body),
                },
                timeout: 1200,
              },
              (response) => {
                let text = "";
                response.on("data", (b) => {
                  text += b;
                  if (text.length > 4096) response.destroy();
                });
                response.on("end", () => {
                  try {
                    if (response.statusCode !== 200)
                      throw Error("intake rejected");
                    resolve(JSON.parse(text));
                  } catch {
                    reject(Error("observation delivery failed"));
                  }
                });
                response.on("error", () =>
                  reject(Error("observation delivery failed")),
                );
              },
            );
          request.on("error", () =>
            reject(Error("observation delivery failed")),
          );
          request.on("timeout", () => request.destroy());
          request.end(body);
        }),
    };
  } catch {
    return null;
  }
}
