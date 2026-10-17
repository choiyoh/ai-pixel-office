import { bridgeError } from "./schema.mjs";
const tools = new Map([
  ["read", "read"],
  ["grep", "read"],
  ["glob", "read"],
  ["edit", "edit"],
  ["write", "write"],
  ["bash", "shell"],
]);
// This classifies native model metadata, never text or a requested model flag.
export function ompModelObservation(model) {
  const provider = model?.provider,
    id = model?.model ?? model?.id;
  const knownProvider =
    provider === "commandcode"
      ? "commandcode"
      : provider === "deepseek"
        ? "deepseek"
        : typeof provider === "string"
          ? "other"
          : "unknown";
  const family =
    ["commandcode", "deepseek"].includes(knownProvider) &&
    typeof id === "string" &&
    /^(?:deepseek\/)?deepseek[-/][a-zA-Z0-9_.-]+$/.test(id)
      ? "deepseek"
      : typeof id === "string"
        ? "other"
        : "unknown";
  return { modelProvider: knownProvider, modelFamily: family };
}
export function ompStreamEvent(raw, context) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw bridgeError(422, "invalid-omp-event");
  const kinds = new Map(
    Object.entries({
      session: "session.start",
      tool_execution_start: "tool.start",
      tool_execution_end: "tool.end",
      agent_end: "turn.end",
    }),
  );
  const kind = kinds.get(raw.type);
  if (!kind) return null;
  const event = {
    schemaVersion: 1,
    providerId: "omp",
    installationInstanceId: context.installationInstanceId,
    nativeSessionId: context.nativeSessionId,
    executionId: context.executionId,
    logicalTaskId: context.logicalTaskId,
    actorRole: "executor",
    eventId: context.eventId,
    sequence: context.sequence,
    occurredAt: context.occurredAt,
    modelFamily: context.modelFamily ?? "unknown",
    modelProvider: context.modelProvider ?? "unknown",
    kind,
  };
  if (kind === "session.start") {
    if (context.startSource !== "startup")
      throw bridgeError(422, "omp-fresh-print-only");
    event.startSource = "startup";
  }
  if (kind.startsWith("tool.")) {
    if (
      typeof raw.toolName !== "string" ||
      typeof raw.toolCallId !== "string" ||
      !/^[\x21-\x7E]{1,512}$/.test(raw.toolCallId)
    )
      throw bridgeError(422, "missing-omp-tool-identity");
    event.tool = tools.get(raw.toolName) ?? "other";
    event.nativeToolCallId = raw.toolCallId;
    if (kind === "tool.end") {
      if (typeof raw.isError !== "boolean")
        throw bridgeError(422, "missing-omp-tool-outcome");
      event.toolFailed = raw.isError;
    }
  }
  return event;
}
export function ompExitEvent(context, { exitCode, signal }) {
  if (
    !Number.isInteger(exitCode) &&
    !["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP", "SIGABRT", "SIGSEGV"].includes(
      signal,
    )
  )
    throw bridgeError(422, "process-exit-not-observed");
  return {
    schemaVersion: 1,
    providerId: "omp",
    installationInstanceId: context.installationInstanceId,
    nativeSessionId: context.nativeSessionId,
    executionId: context.executionId,
    logicalTaskId: context.logicalTaskId,
    actorRole: "executor",
    eventId: context.eventId,
    sequence: context.sequence,
    occurredAt: context.occurredAt,
    kind: "execution.end",
    modelFamily: context.modelFamily ?? "unknown",
    modelProvider: context.modelProvider ?? "unknown",
    processOutcome: signal
      ? "signalled"
      : exitCode === 0
        ? "exited-zero"
        : "exited-nonzero",
  };
}
