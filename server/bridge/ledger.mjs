import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  assertPrivate,
  ensurePrivateDirectory,
  writePrivateExclusive,
} from "../../platform/private-files.mjs";
import {
  parseBridgeEvent,
  bridgeError,
  bridgeKinds,
  bridgeTools,
  bridgeRoles,
  uuid,
} from "./schema.mjs";
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const only = (v, keys) =>
  object(v) && Object.keys(v).every((k) => keys.includes(k));
const date = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
const statuses = [
  "observed",
  "working",
  "between-tools",
  "turn-ended",
  "process-ended",
  "tool-failed",
];
const unavailable = () => bridgeError(503, "private-bridge-state-unavailable");
export function openProviderBridge({
  directory,
  providers = ["command-code"],
  source = "fixture",
  maxExecutions = 1000,
  maxActors = 100,
  maxDeliveries = 4096,
  maxPending = 256,
  maxPendingPerExecution = 32,
  maxGapMs = 5000,
  now = () => Date.now(),
  delegations = [],
} = {}) {
  if (
    !["fixture", "live"].includes(source) ||
    !providers.length ||
    new Set(providers).size !== providers.length ||
    providers.some((p) => !["claude", "command-code", "omp"].includes(p))
  )
    throw bridgeError(422, "invalid-bridge-configuration");
  if (
    !Array.isArray(delegations) ||
    new Set(delegations.map((d) => d.delegationId)).size !==
      delegations.length ||
    delegations.some(
      (d) =>
        !only(d, [
          "delegationId",
          "logicalTaskId",
          "relayProviderId",
          "executorProviderId",
        ]) ||
        !uuid(d.delegationId) ||
        !uuid(d.logicalTaskId) ||
        !providers.includes(d.relayProviderId) ||
        !providers.includes(d.executorProviderId),
    )
  )
    throw bridgeError(422, "invalid-delegation-configuration");
  ensurePrivateDirectory(directory);
  const file = path.join(directory, "provider-bridge.json");
  let state = {
      version: 3,
      salt: randomBytes(32).toString("hex"),
      installations: Object.fromEntries(
        providers.map((p) => [p, randomUUID()]),
      ),
      revision: 0,
      nextRenderId: 1,
      executions: {},
      sessions: {},
      deliveries: {},
      timeline: [],
    },
    failed = false;
  const validate = (s) => {
    if (
      !only(s, [
        "version",
        "salt",
        "installations",
        "revision",
        "nextRenderId",
        "executions",
        "sessions",
        "deliveries",
        "timeline",
      ]) ||
      ![1, 2, 3].includes(s.version) ||
      !hex(s.salt) ||
      !object(s.installations) ||
      Object.keys(s.installations).sort().join() !==
        [...providers].sort().join() ||
      !Object.values(s.installations).every(uuid) ||
      !Number.isSafeInteger(s.revision) ||
      s.revision < 0 ||
      !Number.isSafeInteger(s.nextRenderId) ||
      s.nextRenderId < 1 ||
      !object(s.executions) ||
      Object.keys(s.executions).length > maxExecutions ||
      !object(s.sessions) ||
      Object.keys(s.sessions).length > maxExecutions ||
      !object(s.deliveries) ||
      Object.keys(s.deliveries).length > maxDeliveries ||
      !Array.isArray(s.timeline) ||
      s.timeline.length > 128
    )
      throw unavailable();
    const safePending = (e) =>
      only(e, [
        "kind",
        "tool",
        "startSource",
        "processOutcome",
        "sequence",
        "receivedAt",
        "occurredAt",
        "toolKey",
        "toolFailed",
        "parentExecution",
      ]) &&
      (e.parentExecution === undefined ||
        (e.kind === "session.start" &&
          object(e.parentExecution) &&
          Object.keys(e.parentExecution).sort().join() ===
            "birth,pid,version" &&
          e.parentExecution.version === 1 &&
          Number.isSafeInteger(e.parentExecution.pid) &&
          e.parentExecution.pid > 1 &&
          typeof e.parentExecution.birth === "string" &&
          e.parentExecution.birth.length >= 1 &&
          e.parentExecution.birth.length <= 80 &&
          /^[A-Za-z0-9 .:+-]+$/.test(e.parentExecution.birth))) &&
      (e.toolFailed === undefined ||
        (e.kind === "tool.end" && typeof e.toolFailed === "boolean")) &&
      bridgeKinds.includes(e.kind) &&
      Number.isSafeInteger(e.sequence) &&
      e.sequence >= 1 &&
      date(e.receivedAt) &&
      date(e.occurredAt) &&
      (e.tool === undefined || bridgeTools.includes(e.tool)) &&
      (e.kind.startsWith("tool.")
        ? bridgeTools.includes(e.tool) && hex(e.toolKey)
        : e.tool === undefined && e.toolKey === undefined) &&
      (e.kind === "session.start"
        ? ["startup", "resume", "clear"].includes(e.startSource)
        : e.startSource === undefined) &&
      (e.kind === "execution.end"
        ? ["exited-zero", "exited-nonzero", "signalled"].includes(
            e.processOutcome,
          )
        : e.processOutcome === undefined) &&
      (e.startSource === undefined ||
        ["startup", "resume", "clear"].includes(e.startSource)) &&
      (e.processOutcome === undefined ||
        ["exited-zero", "exited-nonzero", "signalled"].includes(
          e.processOutcome,
        ));
    for (const [key, e] of Object.entries(s.executions))
      if (
        !hex(key) ||
        !only(e, [
          "sessionKey",
          "providerId",
          "installationInstanceId",
          "logicalTaskId",
          "parentTaskId",
          "delegationId",
          "actorRole",
          "nextSequence",
          "terminal",
          "started",
          "status",
          "tool",
          "lastReceivedAt",
          "lastObservedAt",
          "pending",
          "generation",
          "processOutcome",
          "activeTools",
          "closedTools",
          "modelFamily",
          "modelProvider",
          "toolFailureObserved",
          "parentExecution",
        ]) ||
        !hex(e.sessionKey) ||
        !providers.includes(e.providerId) ||
        e.installationInstanceId !== s.installations[e.providerId] ||
        !uuid(e.logicalTaskId) ||
        !(e.parentTaskId === null || uuid(e.parentTaskId)) ||
        !(e.delegationId === null || uuid(e.delegationId)) ||
        !bridgeRoles.includes(e.actorRole) ||
        !Number.isSafeInteger(e.nextSequence) ||
        e.nextSequence < 1 ||
        typeof e.terminal !== "boolean" ||
        typeof e.started !== "boolean" ||
        !object(e.activeTools) ||
        Object.keys(e.activeTools).length > 64 ||
        !Object.entries(e.activeTools).every(
          ([k, v]) => hex(k) && bridgeTools.includes(v),
        ) ||
        !Array.isArray(e.closedTools) ||
        e.closedTools.length > 1024 ||
        !e.closedTools.every(hex) ||
        new Set(e.closedTools).size !== e.closedTools.length ||
        e.closedTools.some((k) => k in e.activeTools) ||
        (s.version === 1
          ? e.modelFamily !== undefined ||
            e.modelProvider !== undefined ||
            e.toolFailureObserved !== undefined
          : !["deepseek", "other", "unknown"].includes(e.modelFamily) ||
            !["commandcode", "deepseek", "other", "unknown"].includes(
              e.modelProvider,
            ) ||
            typeof e.toolFailureObserved !== "boolean") ||
        (s.version >= 3
          ? !(
              e.parentExecution === null ||
              (object(e.parentExecution) &&
                Object.keys(e.parentExecution).sort().join() ===
                  "birth,pid,version" &&
                e.parentExecution.version === 1 &&
                Number.isSafeInteger(e.parentExecution.pid) &&
                e.parentExecution.pid > 1 &&
                typeof e.parentExecution.birth === "string" &&
                e.parentExecution.birth.length >= 1 &&
                e.parentExecution.birth.length <= 80 &&
                /^[A-Za-z0-9 .:+-]+$/.test(e.parentExecution.birth))
            )
          : e.parentExecution !== undefined) ||
        !statuses.includes(e.status) ||
        !(e.tool === null || bridgeTools.includes(e.tool)) ||
        !date(e.lastReceivedAt) ||
        (e.lastObservedAt !== undefined && !date(e.lastObservedAt)) ||
        !Array.isArray(e.pending) ||
        e.pending.length > maxPendingPerExecution ||
        !e.pending.every(safePending) ||
        new Set(e.pending.map((p) => p.sequence)).size !== e.pending.length ||
        e.pending.some((p) => p.sequence < e.nextSequence) ||
        !(
          e.processOutcome === null ||
          ["exited-zero", "exited-nonzero", "signalled"].includes(
            e.processOutcome,
          )
        ) ||
        !Number.isSafeInteger(e.generation) ||
        e.generation < 0 ||
        e.generation > 64
      )
        throw unavailable();
    const actors = new Set(),
      renders = new Set();
    for (const [key, sess] of Object.entries(s.sessions)) {
      if (
        !hex(key) ||
        !only(sess, [
          "currentExecution",
          "actorId",
          "renderId",
          "palette",
          "generation",
          "actorRole",
        ]) ||
        !hex(sess.currentExecution) ||
        !s.executions[sess.currentExecution] ||
        s.executions[sess.currentExecution].sessionKey !== key ||
        !Number.isSafeInteger(sess.generation) ||
        sess.generation < 1 ||
        sess.generation > 64 ||
        !bridgeRoles.includes(sess.actorRole) ||
        !s.executions[sess.currentExecution].started ||
        s.executions[sess.currentExecution].generation !== sess.generation ||
        s.executions[sess.currentExecution].actorRole !== sess.actorRole
      )
        throw unavailable();
      if (sess.actorRole === "executor") {
        if (
          !uuid(sess.actorId) ||
          actors.has(sess.actorId) ||
          !Number.isSafeInteger(sess.renderId) ||
          sess.renderId < 1 ||
          sess.renderId >= s.nextRenderId ||
          renders.has(sess.renderId) ||
          !Number.isInteger(sess.palette) ||
          sess.palette < 0 ||
          sess.palette > 5
        )
          throw unavailable();
        actors.add(sess.actorId);
        renders.add(sess.renderId);
      } else if (
        sess.actorId !== null ||
        sess.renderId !== null ||
        sess.palette !== null
      )
        throw unavailable();
    }
    for (const [key, d] of Object.entries(s.deliveries))
      if (
        !hex(key) ||
        !only(d, ["digest", "receipt"]) ||
        !hex(d.digest) ||
        !only(d.receipt, [
          "accepted",
          "disposition",
          "nextSequence",
          "revision",
        ]) ||
        d.receipt.accepted !== true ||
        !["committed", "buffered"].includes(d.receipt.disposition) ||
        !Number.isSafeInteger(d.receipt.nextSequence) ||
        d.receipt.nextSequence < 1 ||
        !Number.isSafeInteger(d.receipt.revision) ||
        d.receipt.revision < 1 ||
        d.receipt.revision > s.revision
      )
        throw unavailable();
    for (const t of s.timeline)
      if (
        !only(t, [
          "revision",
          "actorId",
          "providerId",
          "actorRole",
          "generation",
          "kind",
          "tool",
          "sequence",
          "receivedAt",
          "occurredAt",
          "logicalTaskId",
          "delegationId",
          "processOutcome",
        ]) ||
        !Number.isSafeInteger(t.revision) ||
        t.revision < 1 ||
        t.revision > s.revision ||
        !(t.actorId === null || uuid(t.actorId)) ||
        !providers.includes(t.providerId) ||
        !bridgeRoles.includes(t.actorRole) ||
        !Number.isSafeInteger(t.generation) ||
        t.generation < 0 ||
        !bridgeKinds.includes(t.kind) ||
        !(t.tool === null || bridgeTools.includes(t.tool)) ||
        !Number.isSafeInteger(t.sequence) ||
        t.sequence < 1 ||
        !date(t.receivedAt) ||
        (t.occurredAt !== undefined && !date(t.occurredAt)) ||
        !uuid(t.logicalTaskId) ||
        !(t.delegationId === null || uuid(t.delegationId)) ||
        !(
          t.processOutcome === null ||
          ["exited-zero", "exited-nonzero", "signalled"].includes(
            t.processOutcome,
          )
        )
      )
        throw unavailable();
    if (
      Object.values(s.sessions).filter(
        (sess) =>
          sess.actorRole === "executor" &&
          !s.executions[sess.currentExecution].terminal,
      ).length > maxActors
    )
      throw unavailable();
    if (s.revision !== Object.keys(s.deliveries).length) throw unavailable();
    if (
      Object.values(s.executions).reduce((n, e) => n + e.pending.length, 0) >
      maxPending
    )
      throw unavailable();
  };
  const persist = (s) => {
    validate(s);
    if (Buffer.byteLength(JSON.stringify(s)) > 2 * 1024 * 1024)
      throw bridgeError(429, "bridge-state-capacity");
    const temp = path.join(directory, `.bridge-${randomUUID()}.tmp`);
    try {
      writePrivateExclusive(temp, s);
      const fd = fs.openSync(temp, "r+");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, file);
      if (process.platform !== "win32") {
        const fd = fs.openSync(directory, "r");
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch {
      failed = true;
      throw unavailable();
    } finally {
      try {
        fs.unlinkSync(temp);
      } catch {
        /* Only the new private temporary file. */
      }
    }
  };
  if (fs.existsSync(file)) {
    const st = assertPrivate(file);
    if (st.size > 2 * 1024 * 1024) throw unavailable();
    try {
      state = JSON.parse(fs.readFileSync(file, "utf8"));
      validate(state);
      if (state.version === 1) {
        state.version = 2;
        for (const e of Object.values(state.executions)) {
          e.modelFamily = "unknown";
          e.modelProvider = "unknown";
          e.toolFailureObserved = false;
        }
      }
      if (state.version === 2) {
        state.version = 3;
        for (const e of Object.values(state.executions))
          e.parentExecution = null;
      }
    } catch {
      throw unavailable();
    }
  } else persist(state);
  const hash = (value) =>
    createHmac("sha256", state.salt)
      .update(JSON.stringify(value))
      .digest("hex");
  const check = () => {
    if (failed) throw unavailable();
  };
  const relation = (event, principal) => {
    if (event.delegationId) {
      const grant = delegations.find(
        (d) =>
          d.delegationId === event.delegationId &&
          d.logicalTaskId === event.logicalTaskId,
      );
      if (
        !grant ||
        (event.actorRole === "relay" &&
          grant.relayProviderId !== principal.providerId) ||
        (event.actorRole === "executor" &&
          grant.executorProviderId !== principal.providerId) ||
        event.actorRole === "observer"
      )
        throw bridgeError(403, "unregistered-delegation");
    }
    if (event.parentTaskId) {
      const candidates = Object.values(state.executions).filter(
          (e) => e.logicalTaskId === event.parentTaskId && e.started,
        ),
        parent = candidates.find(
          (e) =>
            e.providerId === principal.providerId &&
            e.installationInstanceId === principal.installationInstanceId,
        );
      if (!parent)
        throw bridgeError(
          candidates.length ? 403 : 409,
          candidates.length ? "foreign-parent" : "parent-not-observed",
        );
      const seen = new Set([event.logicalTaskId]);
      let id = event.parentTaskId;
      while (id) {
        if (seen.has(id)) throw bridgeError(422, "cyclic-parent");
        seen.add(id);
        id = Object.values(state.executions).find(
          (e) =>
            e.logicalTaskId === id &&
            e.started &&
            e.providerId === principal.providerId &&
            e.installationInstanceId === principal.installationInstanceId,
        )?.parentTaskId;
      }
    }
    const knownTask = Object.values(state.executions).find(
      (e) =>
        e.logicalTaskId === event.logicalTaskId &&
        e.providerId === principal.providerId &&
        e.installationInstanceId === principal.installationInstanceId,
    );
    if (knownTask && knownTask.parentTaskId !== (event.parentTaskId ?? null))
      throw bridgeError(409, "task-parent-conflict");
  };
  const commit = (s, key, item) => {
    const e = s.executions[key];
    if (e.terminal) throw bridgeError(409, "terminal-execution");
    let sess = s.sessions[e.sessionKey];
    if (item.kind === "session.start") {
      if (e.started) throw bridgeError(409, "duplicate-session-start");
      if (
        e.actorRole === "executor" &&
        Object.values(s.sessions).filter(
          (x) =>
            x.actorRole === "executor" &&
            !s.executions[x.currentExecution].terminal,
        ).length >= maxActors
      )
        throw bridgeError(429, "active-actor-capacity");
      if (sess) {
        const previous = s.executions[sess.currentExecution];
        if (
          !previous.terminal ||
          item.startSource !== "resume" ||
          sess.actorRole !== e.actorRole
        )
          throw bridgeError(409, "ambiguous-session-reuse");
        if (sess.generation >= 64)
          throw bridgeError(429, "generation-capacity");
        sess.generation++;
        sess.currentExecution = key;
      } else {
        const visible = e.actorRole === "executor",
          id = visible ? s.nextRenderId++ : null;
        sess = {
          currentExecution: key,
          actorId: visible ? randomUUID() : null,
          renderId: id,
          palette: visible ? (id - 1) % 6 : null,
          generation: 1,
          actorRole: e.actorRole,
        };
        s.sessions[e.sessionKey] = sess;
      }
      if (item.parentExecution !== undefined)
        e.parentExecution = item.parentExecution;
      e.started = true;
      e.generation = sess.generation;
      e.status = "observed";
    } else if (item.kind === "execution.end") {
      if (e.pending.some((p) => p.sequence > item.sequence))
        throw bridgeError(409, "events-after-terminal-sequence");
      e.terminal = true;
      e.status = "process-ended";
      e.processOutcome = item.processOutcome;
    } else {
      if (!e.started) throw bridgeError(409, "session-start-not-observed");
      if (item.kind === "tool.start") {
        if (
          e.closedTools.includes(item.toolKey) ||
          item.toolKey in e.activeTools
        )
          throw bridgeError(409, "tool-identity-reused");
        if (Object.keys(e.activeTools).length >= 64)
          throw bridgeError(429, "active-tool-capacity");
        e.activeTools[item.toolKey] = item.tool;
        e.status = "working";
        e.tool = item.tool;
      } else if (item.kind === "tool.end") {
        if (
          !(item.toolKey in e.activeTools) ||
          e.activeTools[item.toolKey] !== item.tool
        )
          throw bridgeError(409, "tool-start-not-observed");
        if (e.closedTools.length >= 1024)
          throw bridgeError(429, "closed-tool-capacity");
        delete e.activeTools[item.toolKey];
        e.closedTools.push(item.toolKey);
        const remaining = Object.values(e.activeTools);
        if (item.toolFailed !== undefined)
          e.toolFailureObserved = item.toolFailed;
        e.status = remaining.length
          ? "working"
          : item.toolFailed
            ? "tool-failed"
            : "between-tools";
        if (remaining.length) e.tool = remaining.at(-1);
      } else if (item.kind === "turn.end") e.status = "turn-ended";
    }

    e.nextSequence++;
    e.lastReceivedAt = item.receivedAt;
    e.lastObservedAt = item.occurredAt;
    s.timeline.push({
      revision: s.revision,
      actorId: sess?.actorId ?? null,
      providerId: e.providerId,
      actorRole: e.actorRole,
      generation: e.generation,
      kind: item.kind,
      tool: item.tool ?? null,
      sequence: item.sequence,
      receivedAt: item.receivedAt,
      occurredAt: item.occurredAt,
      logicalTaskId: e.logicalTaskId,
      delegationId: e.delegationId,
      processOutcome:
        item.kind === "execution.end" ? item.processOutcome : null,
    });
    s.timeline = s.timeline.slice(-128);
  };
  return {
    principal(providerId, roles = ["executor"]) {
      check();
      if (
        !providers.includes(providerId) ||
        !roles.every((r) => bridgeRoles.includes(r))
      )
        throw bridgeError(404, "unknown-provider");
      return {
        providerId,
        installationInstanceId: state.installations[providerId],
        roles: [...roles],
      };
    },
    receive(value, principal) {
      check();
      if (
        state.installations[principal.providerId] !==
        principal.installationInstanceId
      )
        throw bridgeError(403, "unregistered-principal");
      const { event, digest } = parseBridgeEvent(value, principal);
      relation(event, principal);
      const deliveryKey = hash([
          principal.providerId,
          principal.installationInstanceId,
          event.eventId,
        ]),
        duplicate = state.deliveries[deliveryKey];
      if (duplicate) {
        if (duplicate.digest !== digest)
          throw bridgeError(409, "event-id-conflict");
        return { ...duplicate.receipt, duplicate: true };
      }
      if (Object.keys(state.deliveries).length >= maxDeliveries)
        throw bridgeError(429, "delivery-capacity");
      const sessionKey = hash([
          event.providerId,
          event.installationInstanceId,
          event.nativeSessionId,
        ]),
        key = hash([
          event.providerId,
          event.installationInstanceId,
          event.nativeSessionId,
          event.executionId,
        ]);
      const previous = state.executions[key];
      if (!previous && Object.keys(state.executions).length >= maxExecutions)
        throw bridgeError(429, "execution-capacity");
      if (previous) {
        for (const field of [
          "logicalTaskId",
          "parentTaskId",
          "delegationId",
          "actorRole",
        ])
          if (previous[field] !== (event[field] ?? null))
            throw bridgeError(409, "execution-metadata-conflict");
        if (previous.terminal) throw bridgeError(409, "terminal-execution");
        if (
          event.sequence < previous.nextSequence ||
          previous.pending.some((p) => p.sequence === event.sequence)
        )
          throw bridgeError(409, "sequence-conflict");
      }
      const next = structuredClone(state);
      next.revision++;
      const receivedAt = new Date(now()).toISOString();
      next.executions[key] ??= {
        sessionKey,
        providerId: event.providerId,
        installationInstanceId: event.installationInstanceId,
        logicalTaskId: event.logicalTaskId,
        parentTaskId: event.parentTaskId ?? null,
        delegationId: event.delegationId ?? null,
        actorRole: event.actorRole,
        nextSequence: 1,
        terminal: false,
        started: false,
        status: "observed",
        tool: null,
        lastReceivedAt: receivedAt,
        pending: [],
        generation: 0,
        processOutcome: null,
        activeTools: {},
        closedTools: [],
        modelFamily: "unknown",
        modelProvider: "unknown",
        toolFailureObserved: false,
        parentExecution: null,
      };
      const execution = next.executions[key];
      if (event.modelFamily !== undefined)
        execution.modelFamily = event.modelFamily;
      if (event.modelProvider !== undefined)
        execution.modelProvider = event.modelProvider;
      if (event.parentExecution !== undefined)
        execution.parentExecution = event.parentExecution;
      const item = {
        kind: event.kind,
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        receivedAt,
      };
      for (const field of [
        "tool",
        "startSource",
        "processOutcome",
        "toolFailed",
        "parentExecution",
      ])
        if (event[field] !== undefined) item[field] = event[field];
      if (event.nativeToolCallId)
        item.toolKey = hash([key, event.nativeToolCallId]);
      let disposition = "committed";
      if (event.sequence > execution.nextSequence) {
        if (
          execution.pending.length >= maxPendingPerExecution ||
          Object.values(next.executions).reduce(
            (n, e) => n + e.pending.length,
            0,
          ) >= maxPending
        )
          throw bridgeError(429, "reorder-capacity");
        execution.pending.push(item);
        disposition = "buffered";
      } else {
        commit(next, key, item);
        while (
          execution.pending.some((p) => p.sequence === execution.nextSequence)
        ) {
          const index = execution.pending.findIndex(
              (p) => p.sequence === execution.nextSequence,
            ),
            [pending] = execution.pending.splice(index, 1);
          commit(next, key, pending);
        }
      }
      const receipt = {
        accepted: true,
        disposition,
        nextSequence: execution.nextSequence,
        revision: next.revision,
      };
      next.deliveries[deliveryKey] = { digest, receipt };
      persist(next);
      state = next;
      return receipt;
    },
    snapshot() {
      check();
      const actors = [];
      for (const s of Object.values(state.sessions)) {
        const e = state.executions[s.currentExecution];
        if (s.actorRole !== "executor" || e.terminal) continue;
        const oldest = e.pending.length
          ? Math.min(...e.pending.map((p) => Date.parse(p.receivedAt)))
          : null;
        const quality =
          oldest === null
            ? e.status === "turn-ended" && Object.keys(e.activeTools).length
              ? "inconsistent-tools"
              : "contiguous"
            : now() - oldest > maxGapMs
              ? "gap-expired"
              : "sequence-gap";
        actors.push({
          actorId: s.actorId,
          renderId: s.renderId,
          palette: s.palette,
          generation: s.generation,
          providerId: e.providerId,
          modelFamily: e.modelFamily,
          modelProvider: e.modelProvider,
          toolFailureObserved: e.toolFailureObserved,
          logicalTaskId: e.logicalTaskId,
          delegationId: e.delegationId,
          parentExecution: e.parentExecution ?? null,
          status: e.status,
          tool: e.tool,
          activeToolCount: Object.keys(e.activeTools).length,
          quality,
          lastReceivedAt: e.lastReceivedAt,
          lastObservedAt: e.lastObservedAt ?? null,
        });
      }
      return {
        ready: true,
        source,
        realEnvironmentVerified: false,
        revision: state.revision,
        actors,
        timeline: structuredClone(state.timeline),
        pendingCount: Object.values(state.executions).reduce(
          (n, e) => n + e.pending.length,
          0,
        ),
        terminalCount: Object.values(state.executions).filter((e) => e.terminal)
          .length,
      };
    },
  };
}
