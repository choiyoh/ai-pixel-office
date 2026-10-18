// Concurrent provider scene: a read-only merge of the Claude and OMP live views.
//
// The two channels allocate their render ids independently, so the engine key
// space is namespaced here only. Everything else is passed through untouched:
// display names stay `Claude · 00N` / `OMP · 00N`, palettes stay in the 0..5
// range the character art actually covers, and the raw relay proof never
// appears. One channel being unavailable leaves the other channel visible.
const OMP_RENDER_OFFSET = 1_000_000;
const MAX_SCENE_TIMELINE = 60;

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (v) => Number.isSafeInteger(v);
const text = (v) => (typeof v === "string" && v.length > 0 ? v : null);

function latest(left, right) {
  if (!text(left)) return text(right);
  if (!text(right)) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function claudeActor(a, installation, source, environment) {
  if (!object(a) || !integer(a.renderId) || a.renderId < 1) return null;
  const observedAt = text(a.observedAt);
  return {
    actorId: a.actorId,
    sceneId: a.renderId,
    renderId: a.renderId,
    providerId: "claude",
    providerRenderId: a.renderId,
    installationInstanceId: installation,
    source,
    environment,
    name: text(a.name) ?? `Claude · ${String(a.renderId).padStart(3, "0")}`,
    palette: integer(a.palette) && a.palette >= 0 && a.palette < 6 ? a.palette : 0,
    generation: integer(a.generation) && a.generation > 0 ? a.generation : 1,
    status: text(a.status) ?? "observed",
    kind: text(a.kind) ?? "sessionStart",
    lastTool: text(a.lastTool),
    observedAt,
    lastEventAt: text(a.lastEventAt) ?? observedAt,
    // Omitted (not null) when the channel never reported it: an explicit null
    // fails the client's optional-field validation.
    ...(text(a.receivedAt) ? { receivedAt: text(a.receivedAt) } : {}),
    restored: a.restored === true,
    delegatedBy: null,
  };
}

function ompActor(a, installation, source, environment) {
  if (!object(a) || !integer(a.renderId) || a.renderId < 1) return null;
  const labelled = object(a.delegatedBy) && text(a.delegatedBy.name);
  const delegatedBy = labelled
    ? {
        name: a.delegatedBy.name,
        // Resolved target when the verifier recognized the relay. `sceneId` is
        // the Claude actor's engine key; null means the relation has no link in
        // this snapshot because the target is not present.
        sceneId:
          integer(a.delegatedBy.renderId) && a.delegatedBy.renderId > 0
            ? a.delegatedBy.renderId
            : null,
      }
    : null;
  const observedAt = text(a.observedAt);
  return {
    actorId: a.actorId,
    sceneId: OMP_RENDER_OFFSET + a.renderId,
    renderId: OMP_RENDER_OFFSET + a.renderId,
    providerId: "omp",
    providerRenderId: a.renderId,
    installationInstanceId: installation,
    source,
    environment,
    name: text(a.name) ?? `OMP · ${String(a.renderId).padStart(3, "0")}`,
    palette: integer(a.palette) && a.palette >= 0 && a.palette < 6 ? a.palette : 0,
    generation: integer(a.generation) && a.generation > 0 ? a.generation : 1,
    status: text(a.status) ?? "observed",
    kind: text(a.kind) ?? "sessionStart",
    lastTool: text(a.lastTool),
    observedAt,
    lastEventAt: text(a.lastEventAt) ?? observedAt,
    ...(text(a.receivedAt) ? { receivedAt: text(a.receivedAt) } : {}),
    restored: a.restored === true,
    quality: text(a.quality) ?? "contiguous",
    modelFamily: text(a.modelFamily) ?? "unknown",
    modelProvider: text(a.modelProvider) ?? "unknown",
    delegatedBy,
  };
}

function claudeEvent(e) {
  if (!object(e)) return null;
  return {
    providerId: "claude",
    actorId: e.actorId,
    kind: text(e.kind) ?? "unknown",
    status: text(e.status),
    tool: text(e.tool),
    at: text(e.at),
    order: integer(e.revision) ? e.revision : 0,
  };
}

function ompEvent(e) {
  if (!object(e)) return null;
  return {
    providerId: "omp",
    actorId: e.actorId,
    kind: text(e.kind) ?? "unknown",
    status: text(e.status),
    tool: text(e.tool),
    at: text(e.receivedAt) ?? text(e.at),
    order: integer(e.revision) ? e.revision : 0,
  };
}

export function projectScene({
  claude = null,
  omp = null,
  source = "live",
  environment = null,
  now = Date.now,
} = {}) {
  const notices = [];
  const actors = [];
  const events = [];
  const providers = {};
  let installation = null;
  let lastEventAt = null;

  if (object(claude) && claude.ready === true && Array.isArray(claude.actors)) {
    const channel = text(claude.installationInstanceId);
    providers.claude = {
      ready: true,
      epoch: text(claude.epoch),
      revision: integer(claude.revision) ? claude.revision : 0,
    };
    if (installation === null) installation = channel;
    lastEventAt = latest(lastEventAt, claude.lastEventAt);
    for (const a of claude.actors) {
      const actor = claudeActor(a, channel, source, environment);
      if (actor) actors.push(actor);
    }
    for (const e of claude.timeline ?? []) {
      const event = claudeEvent(e);
      if (event) events.push(event);
    }
  } else {
    providers.claude = { ready: false, epoch: null, revision: 0 };
    notices.push({
      providerId: "claude",
      reason: object(claude) ? text(claude.error) ?? "unavailable" : "unavailable",
    });
  }

  if (object(omp) && omp.ready === true && Array.isArray(omp.actors)) {
    const channel = text(omp.installationInstanceId);
    providers.omp = {
      ready: true,
      epoch: text(omp.epoch),
      revision: integer(omp.revision) ? omp.revision : 0,
    };
    if (installation === null) installation = channel;
    lastEventAt = latest(lastEventAt, omp.lastEventAt ?? omp.receivedAt);
    for (const a of omp.actors) {
      const actor = ompActor(a, channel, source, environment);
      if (actor) actors.push(actor);
    }
    for (const e of omp.timeline ?? []) {
      const event = ompEvent(e);
      if (event) events.push(event);
    }
  } else {
    providers.omp = { ready: false, epoch: null, revision: 0 };
    notices.push({
      providerId: "omp",
      reason: object(omp) ? text(omp.error) ?? "unavailable" : "unavailable",
    });
  }

  // Neither channel is readable: report the scene itself as unavailable rather
  // than inventing a namespace with no installation behind it.
  if (!providers.claude.ready && !providers.omp.ready)
    return {
      ready: false,
      error: "scene-unavailable",
      source,
      environment,
      providers,
      notices,
      actors: [],
      timeline: [],
      receivedAt: new Date(now()).toISOString(),
    };

  const seen = new Set();
  for (const actor of actors) {
    if (seen.has(actor.sceneId)) throw new Error("scene actor id collision");
    seen.add(actor.sceneId);
  }

  const timeline = events
    .sort((a, b) => {
      const left = a.at ? Date.parse(a.at) : 0;
      const right = b.at ? Date.parse(b.at) : 0;
      if (right !== left) return right - left;
      return b.order - a.order;
    })
    .slice(0, MAX_SCENE_TIMELINE);

  return {
    ready: true,
    epoch: `${providers.claude.epoch ?? "none"}|${providers.omp.epoch ?? "none"}`,
    revision: `c${providers.claude.revision}.o${providers.omp.revision}`,
    cursor: `c${providers.claude.revision}.o${providers.omp.revision}`,
    source,
    environment,
    installationInstanceId: installation,
    providers,
    actors,
    timeline,
    notices,
    lastEventAt,
    receivedAt: new Date(now()).toISOString(),
  };
}
