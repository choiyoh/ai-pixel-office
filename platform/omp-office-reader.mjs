import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { assertPrivate } from "./private-files.mjs";
import { uuid } from "../server/bridge/schema.mjs";
import { projectOmpOffice } from "../server/bridge/office-projection.mjs";
// Same-host backend proxy; no registry, token, or upstream response reaches the browser.
function get(port, url, cookie) {
  return new Promise((resolve, reject) => {
    let timer;
    const request = http.get(
      { host: "127.0.0.1", port, path: url, headers: cookie ? { cookie } : {} },
      (response) => {
        let bytes = 0;
        const chunks = [];
        response.on("data", (b) => {
          bytes += b.length;
          if (bytes > 256 * 1024) request.destroy(Error("response limit"));
          else chunks.push(b);
        });
        response.on("error", reject);
        response.on("end", () => {
          if (response.statusCode !== 200)
            return reject(Error("upstream unavailable"));
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            cookies: response.headers["set-cookie"] ?? [],
          });
        });
      },
    );
    timer = setTimeout(() => request.destroy(Error("upstream timeout")), 1200);
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}
export async function readOmpOffice({ directory, environment, source }) {
  const file = path.join(directory, "runtime/omp.json");
  if (!fs.existsSync(file))
    throw Object.assign(Error("OMP bridge unprepared"), { statusCode: 409 });
  assertPrivate(file);
  if (fs.statSync(file).size > 4096) throw Error("Invalid registry");
  const registryText = fs.readFileSync(file, "utf8"),
    r = JSON.parse(registryText);
  if (
    r.providerId !== "omp" ||
    !uuid(r.installationInstanceId) ||
    !Number.isInteger(r.pid) ||
    r.pid <= 0 ||
    !Number.isInteger(r.port) ||
    r.port < 1 ||
    r.port > 65535
  )
    throw Error("Invalid registry");
  process.kill(r.pid, 0);
  const welcome = await get(r.port, "/");
  const cookie = welcome.cookies
    .find((c) => /^orbit_bridge_session=[a-f0-9]{64};/.test(c))
    ?.split(";")[0];
  if (!cookie) throw Error("Invalid upstream session");
  const response = await get(r.port, "/api/bridge/snapshot", cookie);
  // Recheck registry to reject a concurrent installation replacement.
  if (fs.readFileSync(file, "utf8") !== registryText)
    throw Error("Registry changed");
  return projectOmpOffice(JSON.parse(response.body), {
    installationInstanceId: r.installationInstanceId,
    environment,
    source,
  });
}
