import { uuid } from "./schema.mjs";
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const date = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
const toolMap = new Map([
  ["read", "Read"],
  ["write", "Write"],
  ["edit", "Edit"],
  ["shell", "Bash"],
  ["other", "Other"],
]);
const kindMap = new Map([
  ["session.start", "sessionStart"],
  ["tool.start", "toolStart"],
  ["tool.end", "toolEnd"],
  ["turn.end", "turnEnd"],
  ["execution.end", "sessionEnd"],
]);
const statuses = [
  "observed",
  "working",
  "between-tools",
  "turn-ended",
  "tool-failed",
];
const qualities = [
  "contiguous",
  "inconsistent-tools",
  "sequence-gap",
  "gap-expired",
];
const fail = () => {
  throw Error("Invalid OMP office projection");
};
// An explicit allowlist boundary: never return the original intake object.
export function projectOmpOffice(
  raw,
  { installationInstanceId, environment, source, now = Date.now() } = {},
) {
  if (
    !uuid(installationInstanceId) ||
    !["live", "fixture"].includes(source) ||
    !object(raw) ||
    raw.ready !== true ||
    raw.source !== source ||
    !integer(raw.revision) ||
    !Array.isArray(raw.actors) ||
    raw.actors.length > 100 ||
    !Array.isArray(raw.timeline) ||
    raw.timeline.length > 128 ||
    !Number.isFinite(now) ||
    !/^(linux|darwin|win32)\/(x64|arm64)( · WSL)?$/.test(environment)
  )
    fail();
  const events = raw.timeline
    .filter(
      (e) => object(e) && e.actorRole === "executor" && e.providerId === "omp",
    )
    .map((e) => {
      if (
        !uuid(e.actorId) ||
        !integer(e.revision) ||
        e.revision < 1 ||
        e.revision > raw.revision ||
        !integer(e.generation) ||
        e.generation < 1 ||
        !kindMap.has(e.kind) ||
        !date(e.receivedAt) ||
        (e.tool !== null && !toolMap.has(e.tool))
      )
        fail();
      const kind = kindMap.get(e.kind),
        status =
          kind === "sessionEnd"
            ? "session-ended"
            : kind === "sessionStart"
              ? "observed"
              : kind === "toolStart"
                ? "working"
                : kind === "toolEnd"
                  ? "between-tools"
                  : "turn-ended";
      return {
        revision: e.revision,
        actorId: e.actorId,
        generation: e.generation,
        kind,
        status,
        tool: e.tool === null ? null : toolMap.get(e.tool),
        at: e.receivedAt,
      };
    });
  if (new Set(events.map((e) => e.revision)).size !== events.length) fail();
  const actors = raw.actors.map((a) => {
    if (
      !object(a) ||
      a.providerId !== "omp" ||
      !uuid(a.actorId) ||
      !integer(a.renderId) ||
      a.renderId < 1 ||
      a.renderId > 1000000 ||
      !integer(a.palette) ||
      a.palette > 5 ||
      !integer(a.generation) ||
      a.generation < 1 ||
      !statuses.includes(a.status) ||
      !qualities.includes(a.quality) ||
      !date(a.lastReceivedAt) ||
      (a.tool !== null && !toolMap.has(a.tool)) ||
      !["deepseek", "other", "unknown"].includes(a.modelFamily) ||
      !["commandcode", "deepseek", "other", "unknown"].includes(a.modelProvider)
    )
      fail();
    const history = events
      .filter((e) => e.actorId === a.actorId && e.generation === a.generation)
      .sort((x, y) => x.revision - y.revision);
    return {
      actorId: a.actorId,
      renderId: a.renderId,
      palette: a.palette,
      generation: a.generation,
      providerId: "omp",
      installationInstanceId,
      source,
      environment,
      name: `OMP · ${String(a.renderId).padStart(3, "0")}`,
      status: a.quality === "contiguous" ? a.status : "unknown",
      kind: history.at(-1)?.kind ?? "sessionStart",
      lastTool: a.tool === null ? null : toolMap.get(a.tool),
      observedAt: history[0]?.at ?? a.lastReceivedAt,
      lastEventAt: a.lastReceivedAt,
      restored: false,
      quality: a.quality,
      modelFamily: a.modelFamily,
      modelProvider: a.modelProvider,
    };
  });
  if (
    new Set(actors.map((a) => a.actorId)).size !== actors.length ||
    new Set(actors.map((a) => a.renderId)).size !== actors.length
  )
    fail();
  const timeline = events.sort((a, b) => b.revision - a.revision).slice(0, 100);
  return {
    ready: true,
    providerId: "omp",
    epoch: installationInstanceId,
    revision: raw.revision,
    cursor: `${installationInstanceId}:${raw.revision}`,
    source,
    installationInstanceId,
    receivedAt: new Date(now).toISOString(),
    lastEventAt:
      [...actors.map((a) => a.lastEventAt), ...timeline.map((e) => e.at)]
        .sort()
        .at(-1) ?? null,
    actors,
    timeline,
    tombstones: [],
  };
}
