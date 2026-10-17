import { createHash } from "node:crypto";
export const bridgeKinds = [
  "session.start",
  "tool.start",
  "tool.end",
  "turn.end",
  "execution.end",
];
export const bridgeTools = ["read", "write", "edit", "shell", "other"];
export const bridgeRoles = ["executor", "relay", "observer"];
const keys = [
  "schemaVersion",
  "providerId",
  "installationInstanceId",
  "nativeSessionId",
  "executionId",
  "logicalTaskId",
  "parentTaskId",
  "delegationId",
  "actorRole",
  "eventId",
  "sequence",
  "occurredAt",
  "kind",
  "tool",
  "nativeToolCallId",
  "startSource",
  "processOutcome",
];
export const uuid = (v) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
export const bridgeError = (statusCode, code) =>
  Object.assign(Error(code), { statusCode, code });
export function parseBridgeEvent(value, principal) {
  const fail = () => {
    throw bridgeError(422, "invalid-bridge-event");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  if (value.schemaVersion !== 1)
    throw bridgeError(409, "unsupported-bridge-version");
  if (Object.keys(value).some((k) => !keys.includes(k))) fail();
  if (
    value.providerId !== principal.providerId ||
    value.installationInstanceId !== principal.installationInstanceId
  )
    throw bridgeError(403, "principal-mismatch");
  for (const k of [
    "installationInstanceId",
    "executionId",
    "logicalTaskId",
    "eventId",
  ])
    if (!uuid(value[k])) fail();
  for (const k of ["parentTaskId", "delegationId"])
    if (value[k] !== undefined && !uuid(value[k])) fail();
  if (
    typeof value.nativeSessionId !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.nativeSessionId) ||
    !bridgeRoles.includes(value.actorRole) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    value.sequence > 1000000 ||
    !bridgeKinds.includes(value.kind) ||
    typeof value.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(value.occurredAt))
  )
    fail();
  if (!principal.roles.includes(value.actorRole))
    throw bridgeError(403, "actor-role-not-authorized");
  if (value.parentTaskId === value.logicalTaskId) fail();
  if (value.kind.startsWith("tool.")) {
    if (
      !bridgeTools.includes(value.tool) ||
      typeof value.nativeToolCallId !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.nativeToolCallId)
    )
      fail();
  } else if (value.tool !== undefined || value.nativeToolCallId !== undefined)
    fail();
  if (value.kind === "session.start") {
    if (!["startup", "resume", "clear"].includes(value.startSource)) fail();
  } else if (value.startSource !== undefined) fail();
  if (value.kind === "execution.end") {
    if (
      !["exited-zero", "exited-nonzero", "signalled"].includes(
        value.processOutcome,
      )
    )
      fail();
  } else if (value.processOutcome !== undefined) fail();
  const event = {};
  for (const key of keys) if (value[key] !== undefined) event[key] = value[key];
  event.occurredAt = new Date(event.occurredAt).toISOString();
  return {
    event,
    digest: createHash("sha256").update(JSON.stringify(event)).digest("hex"),
  };
}
