import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { stateRoot } from "./runtime.mjs";
import { assertPrivate } from "./private-files.mjs";
import { uuid } from "../server/bridge/schema.mjs";
// Credentials stay in this transport, never in a queue or the OMP environment.
export function readOmpTransport({
  directory = path.join(stateRoot(), "provider-bridge-omp"),
} = {}) {
  try {
    const file = path.join(directory, "runtime/omp.json");
    if (assertPrivate(file).size > 4096) return null;
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      r.providerId !== "omp" ||
      !uuid(r.installationInstanceId) ||
      !/^[a-f0-9]{64}$/.test(r.token) ||
      !Number.isInteger(r.port) ||
      r.port < 1 ||
      r.port > 65535 ||
      !Number.isInteger(r.pid) ||
      r.pid <= 0
    )
      return null;
    process.kill(r.pid, 0);
    const post = (suffix, event, limit) =>
      new Promise((resolve, reject) => {
        const body = JSON.stringify(event);
        let timer;
        const request = http.request(
          {
            host: "127.0.0.1",
            port: r.port,
            path: "/api/bridge/omp" + suffix,
            method: "POST",
            headers: {
              authorization: `Bearer ${r.token}`,
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
          },
          (response) => {
            let bytes = 0;
            const chunks = [];
            response.on("data", (b) => {
              bytes += b.length;
              if (bytes > limit) request.destroy();
              else chunks.push(b);
            });
            response.on("error", () =>
              reject(Error("observation delivery failed")),
            );
            response.on("end", () => {
              try {
                if (response.statusCode !== 200)
                  throw Object.assign(Error("intake rejected"), {
                    statusCode: response.statusCode,
                  });
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
              } catch (error) {
                reject(
                  Object.assign(Error("observation delivery failed"), {
                    statusCode: Number.isInteger(error.statusCode)
                      ? error.statusCode
                      : null,
                  }),
                );
              }
            });
          },
        );
        timer = setTimeout(() => request.destroy(), 1200);
        request.on("close", () => clearTimeout(timer));
        request.on("error", () => reject(Error("observation delivery failed")));
        request.end(body);
      });
    return {
      installationInstanceId: r.installationInstanceId,
      send: (event) => post("", event, 4096),
      sendBatch: (events) => post("/batch", { events }, 32768),
    };
  } catch {
    return null;
  }
}
