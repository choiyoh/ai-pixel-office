import { test } from "node:test";
import assert from "node:assert/strict";
import { projectScene } from "../server/scene-projection.mjs";

const AT = "2026-10-18T00:00:00Z";
const CLAUDE_INSTALL = "3c1f6a2e-1a5e-4a60-9d2c-6a1a4b7c1111";
const OMP_INSTALL = "8b2d4c11-9f3a-4e77-b6d1-7c5e9a0f2222";

const claudeSnapshot = () => ({
  ready: true,
  epoch: "claude-epoch",
  revision: 7,
  source: "fixture",
  installationInstanceId: CLAUDE_INSTALL,
  receivedAt: AT,
  actors: [
    {
      actorId: "claude-actor",
      renderId: 1,
      palette: 0,
      generation: 1,
      status: "working",
      kind: "tool.start",
      lastTool: "Read",
      observedAt: AT,
      lastEventAt: AT,
      name: "Claude · 001",
      restored: false,
    },
  ],
  timeline: [
    {
      revision: 7,
      actorId: "claude-actor",
      generation: 1,
      tool: "Read",
      kind: "tool.start",
      status: "working",
      at: AT,
    },
  ],
});

const ompSnapshot = () => ({
  ready: true,
  epoch: "omp-epoch",
  revision: 3,
  source: "fixture",
  installationInstanceId: OMP_INSTALL,
  actors: [
    {
      actorId: "omp-actor",
      renderId: 1,
      palette: 2,
      generation: 1,
      providerId: "omp",
      name: "OMP · 001",
      status: "working",
      kind: "tool.start",
      tool: "Read",
      quality: "contiguous",
      modelFamily: "deepseek",
      modelProvider: "commandcode",
      observedAt: AT,
      lastReceivedAt: AT,
      restored: false,
      // A raw proof is never part of this payload: the projection only carries
      // the resolved label the verifier produced.
      delegatedBy: { name: "Claude · 001", renderId: 1 },
    },
  ],
  timeline: [
    {
      actorId: "omp-actor",
      providerId: "omp",
      actorRole: "executor",
      revision: 3,
      generation: 1,
      kind: "tool.start",
      tool: "Read",
      receivedAt: AT,
    },
  ],
});

test("the scene namespaces two independent render id spaces", () => {
  const scene = projectScene({ claude: claudeSnapshot(), omp: ompSnapshot() });
  assert.equal(scene.ready, true);
  assert.match(scene.receivedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.equal(scene.actors.length, 2);
  const claude = scene.actors.find((a) => a.providerId === "claude");
  const omp = scene.actors.find((a) => a.providerId === "omp");
  // Both channels announced render id 1; the scene keys must not collide.
  assert.equal(claude.providerRenderId, 1);
  assert.equal(omp.providerRenderId, 1);
  assert.equal(claude.sceneId, 1);
  assert.equal(omp.sceneId, 1000001);
  assert.notEqual(claude.sceneId, omp.sceneId);
  assert.equal(new Set(scene.actors.map((a) => a.sceneId)).size, 2);
  // Palettes stay untouched: the character art only covers 0..5.
  assert.equal(claude.palette, 0);
  assert.equal(omp.palette, 2);
});

test("a verified delegation becomes a scene link and never carries the raw proof", () => {
  const scene = projectScene({ claude: claudeSnapshot(), omp: ompSnapshot() });
  const omp = scene.actors.find((a) => a.providerId === "omp");
  const claude = scene.actors.find((a) => a.providerId === "claude");
  assert.deepEqual(omp.delegatedBy, { name: "Claude · 001", sceneId: 1 });
  assert.equal(omp.delegatedBy.sceneId, claude.sceneId);
  assert.equal(claude.delegatedBy, null);
  const serialized = JSON.stringify(scene);
  for (const forbidden of ["pid", "birth", "parentExecution", "recordKey"])
    assert.equal(serialized.includes(forbidden), false, forbidden);
  // An unresolved relation (verifier returned no render id) shows a label only.
  const unresolved = projectScene({
    claude: claudeSnapshot(),
    omp: {
      ...ompSnapshot(),
      actors: [{ ...ompSnapshot().actors[0], delegatedBy: { name: "Claude · 001" } }],
    },
  });
  assert.deepEqual(
    unresolved.actors.find((a) => a.providerId === "omp").delegatedBy,
    { name: "Claude · 001", sceneId: null },
  );
});

test("one unavailable channel leaves the other channel visible", () => {
  const scene = projectScene({
    claude: claudeSnapshot(),
    omp: { ready: false, error: "omp-unavailable" },
  });
  assert.equal(scene.ready, true);
  assert.equal(scene.providers.claude.ready, true);
  assert.equal(scene.providers.omp.ready, false);
  assert.equal(scene.actors.length, 1);
  assert.equal(scene.actors[0].providerId, "claude");
  assert.deepEqual(scene.notices, [
    { providerId: "omp", reason: "omp-unavailable" },
  ]);
  const inverse = projectScene({
    claude: { ready: false, error: "receiver-not-prepared" },
    omp: ompSnapshot(),
  });
  assert.equal(inverse.actors.length, 1);
  assert.equal(inverse.actors[0].providerId, "omp");
  assert.deepEqual(inverse.notices, [
    { providerId: "claude", reason: "receiver-not-prepared" },
  ]);
});

test("an actor that never reported receivedAt omits the field instead of nulling it", () => {
  const claude = claudeSnapshot();
  delete claude.actors[0].receivedAt;
  const scene = projectScene({
    claude,
    omp: { ready: false, error: "omp-unavailable" },
  });
  assert.equal("receivedAt" in scene.actors[0], false);
  assert.equal(scene.actors[0].lastEventAt, claude.actors[0].observedAt);
});

test("the merged timeline is ordered newest first and capped", () => {
  const early = "2026-10-18T00:00:00Z";
  const late = "2026-10-18T00:05:00Z";
  const claude = {
    ...claudeSnapshot(),
    timeline: [
      { revision: 9, actorId: "claude-actor", kind: "tool.end", status: "between-tools", tool: "Read", at: early },
    ],
  };
  const omp = {
    ...ompSnapshot(),
    timeline: [
      { actorId: "omp-actor", providerId: "omp", revision: 4, kind: "tool.start", tool: "Read", receivedAt: late },
    ],
  };
  const scene = projectScene({ claude, omp });
  assert.equal(scene.timeline.length, 2);
  assert.equal(scene.timeline[0].providerId, "omp");
  assert.equal(scene.timeline[0].at, late);
  const many = projectScene({
    claude: {
      ...claudeSnapshot(),
      timeline: Array.from({ length: 80 }, (_, i) => ({
        revision: i + 1,
        actorId: "claude-actor",
        kind: "tool.start",
        status: "working",
        tool: "Read",
        at: early,
      })),
    },
    omp: { ready: false, error: "omp-unavailable" },
  });
  assert.equal(many.timeline.length, 60);
});

test("several actors per channel keep distinct scene keys and all reach the merged timeline", () => {
  const claude = claudeSnapshot(),
    omp = ompSnapshot();
  claude.actors = [
    claude.actors[0],
    {
      ...claude.actors[0],
      actorId: "claude-actor-2",
      renderId: 2,
      palette: 1,
      name: "Claude · 002",
    },
  ];
  claude.timeline = [
    claude.timeline[0],
    {
      ...claude.timeline[0],
      actorId: "claude-actor-2",
      revision: 8,
      at: "2026-10-18T00:01:00Z",
    },
  ];
  omp.actors = [
    omp.actors[0],
    {
      ...omp.actors[0],
      actorId: "omp-actor-2",
      renderId: 2,
      palette: 3,
      name: "OMP · 002",
    },
  ];
  omp.timeline = [
    omp.timeline[0],
    {
      ...omp.timeline[0],
      actorId: "omp-actor-2",
      revision: 4,
      // OMP rows carry receivedAt; the projection maps it into the merged at.
      receivedAt: "2026-10-18T00:02:00Z",
    },
  ];
  // Four sessions at once — two per channel — must each get their own seat and
  // their own scene key, and the merged timeline must keep every one of them.
  const scene = projectScene({ claude, omp });
  assert.equal(scene.actors.length, 4);
  const ids = scene.actors.map((a) => a.sceneId).sort((x, y) => x - y);
  assert.deepEqual(ids, [1, 2, 1000001, 1000002]);
  assert.equal(scene.timeline.length, 4);
  assert.equal(scene.timeline[0].at, "2026-10-18T00:02:00Z");
});
