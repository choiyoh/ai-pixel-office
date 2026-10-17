import { bridgeError } from "./schema.mjs";
const toolNames = new Map([
  ["read_file", "read"],
  ["write_file", "write"],
  ["edit_file", "edit"],
  ["shell_command", "shell"],
]);
// The CLI's four documented hooks are not Claude's twelve-hook protocol.
// Context identities come from an approved producer; never infer delegation
// or model ownership from prompts, names, stdout or tool arguments.
export function commandCodeHookEvent(raw, context) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    typeof raw.session_id !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(raw.session_id)
  )
    throw bridgeError(422, "invalid-command-code-hook");
  const kind = {
    SessionStart: "session.start",
    PreToolUse: "tool.start",
    PostToolUse: "tool.end",
    Stop: "turn.end",
  }[raw.hook_event_name];
  if (!kind) throw bridgeError(422, "unsupported-command-code-hook");
  const event = {
    schemaVersion: 1,
    providerId: "command-code",
    installationInstanceId: context.installationInstanceId,
    nativeSessionId: raw.session_id,
    executionId: context.executionId,
    logicalTaskId: context.logicalTaskId,
    actorRole: context.actorRole,
    eventId: context.eventId,
    sequence: context.sequence,
    occurredAt: context.occurredAt,
    kind,
  };
  for (const key of ["parentTaskId", "delegationId"])
    if (context[key] !== undefined) event[key] = context[key];
  if (kind.startsWith("tool.")) {
    if (
      typeof raw.tool_name !== "string" ||
      typeof raw.tool_use_id !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,160}$/.test(raw.tool_use_id)
    )
      throw bridgeError(422, "missing-command-code-tool-identity");
    event.tool = toolNames.get(raw.tool_name) ?? "other";
    event.nativeToolCallId = raw.tool_use_id;
  }
  if (kind === "session.start") {
    if (!["startup", "resume", "clear"].includes(raw.source))
      throw bridgeError(422, "unknown-command-code-source");
    event.startSource = raw.source;
  }
  return event;
}
export function commandCodeExitEvent(context, processResult) {
  if (
    !Number.isInteger(processResult.exitCode) &&
    !["SIGINT", "SIGTERM", "SIGKILL"].includes(processResult.signal)
  )
    throw bridgeError(422, "process-exit-not-observed");
  const {
    installationInstanceId,
    nativeSessionId,
    executionId,
    logicalTaskId,
    actorRole,
    eventId,
    sequence,
    occurredAt,
    parentTaskId,
    delegationId,
  } = context;
  return {
    schemaVersion: 1,
    providerId: "command-code",
    installationInstanceId,
    nativeSessionId,
    executionId,
    logicalTaskId,
    actorRole,
    eventId,
    sequence,
    occurredAt,
    ...(parentTaskId ? { parentTaskId } : {}),
    ...(delegationId ? { delegationId } : {}),
    kind: "execution.end",
    processOutcome: processResult.signal
      ? "signalled"
      : processResult.exitCode === 0
        ? "exited-zero"
        : "exited-nonzero",
  };
}
