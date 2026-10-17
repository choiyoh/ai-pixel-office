import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { openProviderBridge } from "./ledger.mjs";
import {
  ensurePrivateDirectory,
  writePrivateExclusive,
} from "../../platform/private-files.mjs";
const equal = (a, b) => {
  const x = Buffer.from(a ?? ""),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
// Separate opt-in intake: never replaces /api/hooks/claude or its registry.
export async function createProviderBridgeApp({
  stateDir,
  source = "fixture",
  providers = ["command-code"],
  roles = {},
  delegations = [],
  limits = {},
}) {
  if (!path.isAbsolute(stateDir))
    throw Error("Bridge stateDir must be absolute");
  const allowedLimits = [
    "maxExecutions",
    "maxActors",
    "maxDeliveries",
    "maxPending",
    "maxPendingPerExecution",
    "maxGapMs",
  ];
  if (
    Object.keys(limits).some(
      (k) =>
        !allowedLimits.includes(k) ||
        !Number.isSafeInteger(limits[k]) ||
        limits[k] < 1,
    )
  )
    throw Error("Invalid bridge limits");
  ensurePrivateDirectory(stateDir);
  const bridge = openProviderBridge({
    directory: path.join(stateDir, "ledger"),
    source,
    providers,
    delegations,
    ...limits,
  });
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  const cookie = randomBytes(32).toString("hex");
  const principals = new Map(
    providers.map((provider) => [
      provider,
      {
        ...bridge.principal(provider, roles[provider] ?? ["executor"]),
        token: randomBytes(32).toString("hex"),
      },
    ]),
  );
  const owned = [];
  app.setErrorHandler((e, request, reply) => {
    reply.code(e.statusCode === 413 ? 413 : (e.statusCode ?? 503)).send({
      error:
        e.statusCode === 413
          ? "body-too-large"
          : e.code?.startsWith("FST_")
            ? "bridge-unavailable"
            : e.statusCode
              ? e.code
              : "bridge-unavailable",
    });
  });
  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host;
    if (!host || !/^((127\.0\.0\.1)|(localhost))(:\d+)?$/.test(host))
      return reply.code(403).send({ error: "loopback-host-required" });
    if (request.headers.origin && request.headers.origin !== `http://${host}`)
      return reply.code(403).send({ error: "same-origin-required" });
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    if (request.method === "GET" && request.url === "/")
      reply.header(
        "set-cookie",
        `orbit_bridge_session=${cookie}; HttpOnly; SameSite=Strict; Path=/`,
      );
    if (request.routeOptions.url === "/api/bridge/snapshot") {
      const value =
        (request.headers.cookie ?? "")
          .split(";")
          .map((p) => p.trim())
          .find((p) => p.startsWith("orbit_bridge_session="))
          ?.slice(21) ?? "";
      if (!equal(value, cookie))
        return reply.code(401).send({ error: "local-session-required" });
    }
  });
  app.get("/", (request, reply) =>
    reply
      .type("text/html")
      .send(
        "<!doctype html><title>Orbit Provider Bridge</title><p>Provider bridge API. Existing Live Office is unchanged.</p>",
      ),
  );
  app.get("/api/health", () => ({
    status: "ok",
    mode: "provider-bridge",
    source,
    realEnvironmentVerified: false,
  }));
  app.get("/api/bridge/snapshot", () => bridge.snapshot());
  app.post("/api/bridge/:providerId", (request, reply) => {
    const target = principals.get(request.params.providerId);
    if (!target) return reply.code(404).send({ error: "unknown-provider" });
    const claimed = request.headers.authorization ?? "";
    if (!equal(claimed, `Bearer ${target.token}`)) {
      const other = [...principals.values()].some((p) =>
        equal(claimed, `Bearer ${p.token}`),
      );
      return reply
        .code(other ? 403 : 401)
        .send({ error: other ? "provider-token-mismatch" : "unauthorized" });
    }
    return bridge.receive(request.body, target);
  });
  app.addHook("onClose", async () => {
    for (const { file, token } of owned)
      try {
        const current = JSON.parse(fs.readFileSync(file, "utf8"));
        if (equal(current.token, token)) fs.unlinkSync(file);
      } catch {
        /* Only our matching registry token can authorize removal. */
      }
  });
  return {
    app,
    async listen(port = 0) {
      await app.listen({ host: "127.0.0.1", port });
      try {
        const directory = path.join(stateDir, "runtime");
        ensurePrivateDirectory(directory);
        for (const [provider, p] of principals) {
          const file = path.join(directory, `${provider}.json`);
          writePrivateExclusive(file, {
            version: 1,
            providerId: provider,
            installationInstanceId: p.installationInstanceId,
            token: p.token,
            port: app.server.address().port,
            pid: process.pid,
          });
          owned.push({ file, token: p.token });
        }
      } catch (e) {
        await app.close();
        throw e;
      }
    },
  };
}
