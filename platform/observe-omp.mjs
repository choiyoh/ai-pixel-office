import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  ompStreamEvent,
  ompExitEvent,
  ompModelObservation,
} from "../server/bridge/omp.mjs";
const allowedEnv = [
  "HOME",
  "USERPROFILE",
  "PATH",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SYSTEMROOT",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "PI_CODING_AGENT_DIR",
  "OMP_PROFILE",
  "BUN_INSTALL",
  "COMMAND_CODE_API_KEY",
  "DEEPSEEK_API_KEY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "LANG",
  "LC_ALL",
];
export const ompEnvironment = (env) =>
  Object.fromEntries(
    allowedEnv.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]),
  );
const flag = (args, key) => {
  const index = args.indexOf(key);
  if (index >= 0) return args[index + 1];
  return args.find((a) => a.startsWith(key + "="))?.slice(key.length + 1);
};
function printContract(args) {
  if (
    (!args.includes("-p") && !args.includes("--print")) ||
    !args.includes("--no-session") ||
    !args.includes("--no-extensions")
  )
    throw Error(
      "OMP observer supports fresh print/no-session/no-extensions runs only",
    );
  if (
    args.some(
      (a) =>
        /^--(?:api-key|profile|from-claude|from-codex|continue|resume|session-dir|config|hook|extension|plugin-dir|alias)(?:=|$)/.test(
          a,
        ) || ["-r", "-c", "-e"].includes(a),
    )
  )
    throw Error("Unreviewed OMP observer launch option");
  const mode = flag(args, "--mode");
  if (mode && mode !== "json")
    throw Error("OMP observer requires JSON event output");
  const duration = flag(args, "--max-time") ?? "",
    m = String(duration).match(/^(\d+)(s|m|h)?$/);
  if (!m) throw Error("OMP observer requires a bounded max-time");
  const ms = Number(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2] ?? "s"];
  if (ms < 1000 || ms > 3600000)
    throw Error("OMP max-time outside observer budget");
  return {
    args: mode ? args : ["--mode", "json", ...args],
    timeoutMs: ms + 5000,
  };
}
// Opt-in supervisor. Raw JSON is held only in a bounded parser, never spooled.
// The existing OMP environment is narrowed to required runtime/provider keys.
export async function observeOmp({
  executable,
  args,
  cwd,
  input,
  transport = null,
  env = process.env,
  launcherPrefix = [],
  onOutput,
  signal,
  maxLineBytes = 1024 * 1024,
  maxPending = 128,
} = {}) {
  const launch = printContract(args);
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable))
    throw Error(
      "Verified Bun executable and OMP entry required; no command shell fallback",
    );
  const result = {
    runtime: "omp",
    exitCode: null,
    signal: null,
    modelFamily: "unknown",
    modelProvider: "unknown",
    sent: 0,
    deliveryErrors: 0,
    observationOverflow: false,
    rawOutputStored: false,
    producerReplayImplemented: false,
    stderrSeen: false,
    observedKinds: [],
    protocolErrors: [],
    toolShapes: [],
  };
  const context = {
    installationInstanceId: transport?.installationInstanceId,
    executionId: randomUUID(),
    logicalTaskId: randomUUID(),
    nativeSessionId: null,
    startSource: "startup",
    modelFamily: "unknown",
    modelProvider: "unknown",
  };
  const identityKey = randomBytes(32);
  let sequence = 0,
    pending = 0,
    tail = Promise.resolve(),
    lastText = "",
    stream = "",
    dropping = false,
    disabled = false,
    deliveryBroken = false,
    started = false,
    spawnError = false;
  const send = (event) => {
    if (!transport || disabled || !event) return;
    if (pending >= maxPending) {
      disabled = true;
      result.observationOverflow = true;
      return;
    }
    sequence++;
    event.sequence = sequence;
    pending++;
    tail = tail.then(async () => {
      if (deliveryBroken) {
        pending--;
        return;
      }
      try {
        const ack = await transport.send(event);
        if (ack?.accepted !== true || ack.disposition !== "committed")
          throw Error("not committed");
        result.sent++;
      } catch {
        result.deliveryErrors++;
        disabled = true;
        deliveryBroken = true;
      } finally {
        pending--;
      }
    });
  };
  const meta = () => ({
    ...context,
    eventId: randomUUID(),
    sequence: sequence + 1,
    occurredAt: new Date().toISOString(),
  });
  const record = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    if (
      result.toolShapes.length < 32 &&
      ["tool_execution_start", "tool_execution_end"].includes(raw.type)
    )
      result.toolShapes.push({
        event: raw.type,
        name: ["read", "edit", "write", "bash", "grep", "glob"].includes(
          raw.toolName,
        )
          ? raw.toolName
          : typeof raw.toolName,
        idType: typeof raw.toolCallId,
        idLength:
          typeof raw.toolCallId === "string" ? raw.toolCallId.length : null,
        idContainsExtendedCharacters:
          typeof raw.toolCallId === "string" &&
          !/^[A-Za-z0-9_.:-]+$/.test(raw.toolCallId),
      });
    const message = raw.message;
    if (message?.role === "assistant") {
      const model = ompModelObservation(message);
      if (model.modelFamily !== "unknown") {
        Object.assign(context, model);
        Object.assign(result, model);
      }
      if (
        onOutput &&
        raw.type === "message_end" &&
        Array.isArray(message.content)
      )
        lastText = message.content
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("");
    }
    if (raw.type === "session") {
      if (
        started ||
        typeof raw.id !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,160}$/.test(raw.id)
      ) {
        disabled = true;
        return;
      }
      context.nativeSessionId = createHmac("sha256", identityKey)
        .update(raw.id)
        .digest("hex");
      started = true;
    }
    if (!started) return;
    try {
      const event = ompStreamEvent(raw, meta());
      if (event) {
        if (!result.observedKinds.includes(event.kind))
          result.observedKinds.push(event.kind);
        send(event);
      }
    } catch (error) {
      if (result.protocolErrors.length < 32)
        result.protocolErrors.push(
          typeof error.code === "string" && /^[a-z-]+$/.test(error.code)
            ? error.code
            : "observer-protocol-error",
        );
      disabled = true;
      result.deliveryErrors++;
    }
  };
  const child = spawn(executable, [...launcherPrefix, ...launch.args], {
    cwd,
    env: ompEnvironment(env),
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  const decoder = new StringDecoder("utf8");
  child.stdout.on("data", (chunk) => {
    let text = decoder.write(chunk);
    if (dropping) {
      const end = text.indexOf("\n");
      if (end < 0) return;
      text = text.slice(end + 1);
      dropping = false;
    }
    stream += text;
    while (stream.includes("\n")) {
      const end = stream.indexOf("\n"),
        line = stream.slice(0, end);
      stream = stream.slice(end + 1);
      if (Buffer.byteLength(line) > maxLineBytes) {
        disabled = true;
        result.observationOverflow = true;
        continue;
      }
      try {
        record(JSON.parse(line));
      } catch {
        /* Non-JSON output cannot become telemetry. */
      }
    }
    if (Buffer.byteLength(stream) > maxLineBytes) {
      stream = "";
      dropping = true;
      disabled = true;
      result.observationOverflow = true;
    }
  });
  child.stderr.on("data", () => {
    result.stderrSeen = true;
  });
  child.on("error", () => {
    spawnError = true;
  });
  let killTimer;
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      if (!killTimer)
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
        }, 2000);
    }
  };
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(stop, launch.timeoutMs);
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  const outcome = await new Promise((resolve) => {
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  clearTimeout(timer);
  clearTimeout(killTimer);
  signal?.removeEventListener("abort", stop);
  result.exitCode = spawnError
    ? 127
    : (outcome.exitCode ??
      {
        SIGINT: 130,
        SIGTERM: 143,
        SIGKILL: 137,
        SIGHUP: 129,
        SIGABRT: 134,
        SIGSEGV: 139,
      }[outcome.signal] ??
      1);
  result.signal = outcome.signal;
  if (started && !disabled && !spawnError) {
    const event = ompExitEvent(meta(), outcome);
    result.observedKinds.push(event.kind);
    send(event);
  }
  // Drain only this run's bounded observation queue. Never hold OMP work on an intake outage.
  let flushTimer;
  await Promise.race([
    tail,
    new Promise((resolve) => {
      flushTimer = setTimeout(() => {
        deliveryBroken = true;
        disabled = true;
        result.drainTimedOut = true;
        resolve();
      }, 2000);
      flushTimer.unref();
    }),
  ]);
  clearTimeout(flushTimer);
  if (onOutput) onOutput(lastText);
  return result;
}
