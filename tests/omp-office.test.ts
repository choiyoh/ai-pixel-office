import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { projectOmpOffice } from "../server/bridge/office-projection.mjs";
import { parseSnapshot, applySnapshot, freshness } from "../src/live/store";
import { LiveAnimationScheduler } from "../src/live/animation-scheduler";
function fixture() {
  const actorId = randomUUID(),
    installationInstanceId = randomUUID(),
    at = new Date().toISOString();
  const options = {
    installationInstanceId,
    environment: "darwin/arm64",
    source: "fixture",
    now: Date.parse(at),
  };
  const actor = {
    actorId,
    renderId: 1,
    palette: 0,
    generation: 1,
    providerId: "omp",
    status: "between-tools",
    tool: "read",
    quality: "contiguous",
    lastReceivedAt: at,
    modelFamily: "deepseek",
    modelProvider: "commandcode",
  };
  const timeline = ["session.start", "tool.start", "tool.end"].map(
    (kind, i) => ({
      actorId,
      providerId: "omp",
      actorRole: "executor",
      revision: i + 1,
      generation: 1,
      kind,
      tool: i ? "read" : null,
      receivedAt: at,
    }),
  );
  return {
    raw: {
      ready: true,
      source: "fixture",
      revision: 3,
      actors: [actor],
      timeline,
    },
    options,
  };
}
test("OMP projection drops arbitrary content and rejects unsafe enums and mixed sources", () => {
  const f = fixture(),
    snapshot = parseSnapshot(
      projectOmpOffice(
        { ...f.raw, prompt: "PRIVATE-PROMPT", cwd: "/PRIVATE-PATH" },
        f.options,
      ),
    );
  assert.equal(snapshot.actors[0].name, "OMP · 001");
  assert.equal(snapshot.actors[0].status, "between-tools");
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
  for (const patch of [
    { providerId: "claude" },
    { modelFamily: "PRIVATE" },
    { modelProvider: "PRIVATE" },
    { tool: "/PRIVATE-PATH" },
    { quality: "invented" },
    { renderId: 0 },
    { status: "success" },
  ])
    assert.throws(() =>
      projectOmpOffice(
        { ...f.raw, actors: [{ ...f.raw.actors[0], ...patch }] },
        f.options,
      ),
    );
  assert.throws(() =>
    projectOmpOffice({ ...f.raw, source: "live" }, f.options),
  );
  assert.throws(() =>
    parseSnapshot({
      ...snapshot,
      actors: [{ ...snapshot.actors[0], name: "DeepSeek verified success" }],
    }),
  );
  assert.throws(() =>
    parseSnapshot({
      ...snapshot,
      actors: [
        snapshot.actors[0],
        {
          ...snapshot.actors[0],
          actorId: randomUUID(),
          renderId: 2,
          providerId: "claude",
          name: "Claude · 002",
        },
      ],
    }),
  );
  const relay = {
    ...f.raw.timeline[0],
    actorRole: "relay",
    actorId: null,
    revision: 4,
  };
  assert.equal(
    projectOmpOffice(
      { ...f.raw, revision: 4, timeline: [...f.raw.timeline, relay] },
      f.options,
    ).timeline.length,
    3,
  );
});
test("OMP short tool events reuse 750ms scheduler without changing ended business state", () => {
  const f = fixture(),
    snapshot = parseSnapshot(projectOmpOffice(f.raw, f.options)),
    scheduler = new LiveAnimationScheduler();
  scheduler.baseline({
    ...snapshot,
    revision: 1,
    timeline: snapshot.timeline.filter((e) => e.revision === 1),
  });
  scheduler.observe(snapshot, f.options.now, true);
  assert.equal(
    scheduler.visual(snapshot.actors[0], f.options.now + 100, true),
    "Read",
  );
  assert.equal(snapshot.actors[0].status, "between-tools");
  assert.equal(
    scheduler.visual(snapshot.actors[0], f.options.now + 751, true),
    null,
  );
  const terminal = {
    ...snapshot,
    revision: 4,
    cursor: `${snapshot.epoch}:4`,
    actors: [],
    timeline: [
      ...snapshot.timeline,
      {
        ...snapshot.timeline[0],
        revision: 4,
        kind: "sessionEnd" as const,
        status: "session-ended" as const,
      },
    ],
  };
  scheduler.observe(terminal, f.options.now + 200, true);
  assert.equal(
    scheduler.visual(snapshot.actors[0], f.options.now + 200, true),
    null,
  );
  assert.deepEqual(applySnapshot(terminal, snapshot), terminal);
});
test("OMP sequence quality freezes animation, recovery baselines skip old actions and failure preempts visuals", () => {
  const f = fixture(),
    snapshot = parseSnapshot(projectOmpOffice(f.raw, f.options));
  const scheduler = new LiveAnimationScheduler();
  scheduler.baseline({ ...snapshot, revision: 1 });
  scheduler.observe(snapshot, f.options.now, true);
  const failed = {
    ...snapshot,
    revision: 4,
    actors: [{ ...snapshot.actors[0], status: "tool-failed" as const }],
  };
  scheduler.observe(failed, f.options.now + 100, true);
  assert.equal(
    scheduler.visual(failed.actors[0], f.options.now + 100, true),
    null,
  );
  const failedBatch = new LiveAnimationScheduler();
  failedBatch.baseline({ ...snapshot, revision: 1 });
  failedBatch.observe(failed, f.options.now + 100, true);
  assert.equal(failedBatch.visual(failed.actors[0], f.options.now + 100, true), null);
  const gap = parseSnapshot(
    projectOmpOffice(
      { ...f.raw, actors: [{ ...f.raw.actors[0], quality: "sequence-gap" }] },
      f.options,
    ),
  );
  assert.equal(gap.actors[0].status, "unknown");
  assert.equal(freshness(gap.actors[0], f.options.now), "stale");
  scheduler.suspend();
  scheduler.baseline(snapshot);
  scheduler.observe(snapshot, f.options.now + 200, true);
  assert.equal(
    scheduler.visual(snapshot.actors[0], f.options.now + 200, true),
    null,
  );
});
