import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { openProviderBridge } from "../server/bridge/ledger.mjs";
import { ompStreamEvent } from "../server/bridge/omp.mjs";
import { projectOmpOffice } from "../server/bridge/office-projection.mjs";
import { openLiveProjection } from "../server/live-projection.mjs";
import { ensurePrivateDirectory } from "../platform/private-files.mjs";

const PROOF = { version: 1, pid: 424242, birth: "Thu Jan  1 00:00:00 2026" };
const AT = "2026-10-18T00:00:00Z";

function bridgeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-correlate-"));
  const bridge = openProviderBridge({
    directory: path.join(root, "ledger"),
    providers: ["omp"],
    source: "fixture",
  });
  const p = bridge.principal("omp");
  let sequence = 0;
  const ctx = (extra = {}) => ({
    ...p,
    executionId: randomUUID(),
    logicalTaskId: randomUUID(),
    nativeSessionId: randomUUID(),
    startSource: "startup",
    modelFamily: "deepseek",
    modelProvider: "commandcode",
    eventId: randomUUID(),
    sequence: ++sequence,
    occurredAt: AT,
    ...extra,
  });
  return {
    root,
    bridge,
    p,
    ctx,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("the bridge keeps a relay ancestry proof on the executor actor and refuses it anywhere else", () => {
  const f = bridgeFixture();
  try {
    const c = f.ctx({ parentExecution: PROOF });
    const start = ompStreamEvent({ type: "session" }, c);
    assert.deepEqual(start.parentExecution, PROOF);
    f.bridge.receive(start, f.p);
    const actor = f.bridge.snapshot().actors[0];
    assert.deepEqual(actor.parentExecution, PROOF);
    // The proof is a session-start fact: later events on the same execution
    // cannot restate or replace it. The observer never emits it there, so the
    // bridge must refuse it even when a producer forges the field.
    const tool = {
      ...ompStreamEvent(
        { type: "tool_execution_start", toolName: "read", toolCallId: "call|1" },
        f.ctx({
          executionId: c.executionId,
          logicalTaskId: c.logicalTaskId,
          nativeSessionId: c.nativeSessionId,
        }),
      ),
      parentExecution: PROOF,
    };
    assert.throws(
      () => f.bridge.receive(tool, f.p),
      (error) => error.statusCode === 422,
    );
    // Malformed proofs never reach the ledger.
    for (const bad of [
      { version: 1, pid: 1, birth: PROOF.birth },
      { version: 2, pid: PROOF.pid, birth: PROOF.birth },
      { version: 1, pid: PROOF.pid, birth: "bad\nbirth" },
      { version: 1, pid: PROOF.pid },
      { version: 1, pid: PROOF.pid, birth: PROOF.birth, extra: true },
      "proof",
    ]) {
      const event = ompStreamEvent(
        { type: "session" },
        f.ctx({ parentExecution: bad }),
      );
      assert.throws(
        () => f.bridge.receive(event, f.p),
        (error) => error.statusCode === 422,
      );
    }
    // An execution without a proof keeps the field null rather than guessing.
    f.bridge.receive(
      ompStreamEvent({ type: "session" }, f.ctx({ sequence: 1 })),
      f.p,
    );
    assert.equal(f.bridge.snapshot().actors[1].parentExecution, null);
  } finally {
    f.cleanup();
  }
});

test("the office projection resolves a verified relay label and never exposes the raw proof", () => {
  const actorId = randomUUID(),
    logicalTaskId = randomUUID();
  const actor = {
    actorId,
    renderId: 1,
    palette: 0,
    generation: 1,
    providerId: "omp",
    modelFamily: "deepseek",
    modelProvider: "commandcode",
    toolFailureObserved: false,
    logicalTaskId,
    delegationId: null,
    parentExecution: PROOF,
    status: "working",
    tool: "read",
    activeToolCount: 1,
    quality: "contiguous",
    lastReceivedAt: AT,
    lastObservedAt: AT,
  };
  const timeline = ["session.start", "tool.start"].map((kind, i) => ({
    actorId,
    providerId: "omp",
    actorRole: "executor",
    revision: i + 1,
    generation: 1,
    kind,
    tool: i ? "read" : null,
    receivedAt: AT,
  }));
  const raw = {
    ready: true,
    source: "fixture",
    revision: 2,
    actors: [actor],
    timeline,
  };
  const options = {
    installationInstanceId: randomUUID(),
    environment: `${process.platform}/${process.arch}`,
    source: "fixture",
  };
  const verified = projectOmpOffice(raw, {
    ...options,
    resolveDelegation: (proof) =>
      proof.pid === PROOF.pid && proof.birth === PROOF.birth
        ? { name: "Claude · 001" }
        : null,
  });
  assert.deepEqual(verified.actors[0].delegatedBy, { name: "Claude · 001" });
  assert.equal("parentExecution" in verified.actors[0], false);
  // Without a verifier, or without a verified match, nothing is claimed.
  assert.equal(
    projectOmpOffice(raw, options).actors[0].delegatedBy,
    null,
  );
  assert.equal(
    projectOmpOffice(raw, { ...options, resolveDelegation: () => null }).actors[0]
      .delegatedBy,
    null,
  );
  // A verifier that returns an unexpected label is not projected.
  for (const name of ["<script>alert(1)</script>", "Claude · 1", "OMP · 001", ""]) {
    assert.equal(
      projectOmpOffice(raw, {
        ...options,
        resolveDelegation: () => ({ name }),
      }).actors[0].delegatedBy,
      null,
    );
  }
  // A malformed proof fails closed instead of projecting a guess.
  assert.throws(() =>
    projectOmpOffice(
      { ...raw, actors: [{ ...actor, parentExecution: { version: 1, pid: 0, birth: AT } }] },
      options,
    ),
  );
});

test("the live projection matches a relay proof only through its own execution HMAC", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-relay-match-"));
  try {
    const directory = path.join(root, "live");
    ensurePrivateDirectory(directory);
    const projection = openLiveProjection({
      directory,
      source: "fixture",
      environment: `${process.platform}/${process.arch}`,
    });
    const pid = 5150,
      birth = "Thu Jan  1 00:00:00 2026",
      proof = { version: 1, pid, birth };
    assert.equal(projection.matchExecution(proof), null);
    const executionId = JSON.stringify([process.platform, pid, birth]);
    projection.apply({
      sessionId: "relay-session",
      kind: "sessionStart",
      executionId,
      executionStartedAt: Date.parse("2026-01-01T00:00:00Z"),
    });
    assert.equal(projection.snapshot().actors[0].name, "Claude · 001");
    const matched = projection.matchExecution(proof);
    assert.equal(matched.name, "Claude · 001");
    assert.match(matched.recordKey, /^[a-f0-9]{64}$/);
    // Another process, another birth marker, another platform: no match.
    assert.equal(projection.matchExecution({ ...proof, pid: pid + 1 }), null);
    assert.equal(
      projection.matchExecution({ ...proof, birth: "Thu Jan  1 00:00:01 2026" }),
      null,
    );
    for (const bad of [
      null,
      {},
      "proof",
      { version: 2, pid, birth },
      { version: 1, pid: 1, birth },
      { version: 1, pid, birth: "" },
      { version: 1, pid, birth: "x".repeat(81) },
    ])
      assert.equal(projection.matchExecution(bad), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
