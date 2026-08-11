import assert from "node:assert/strict";
import {
  CollisionEventTracker,
  classifyCollisionSurface,
  collisionNormalTip,
} from "../src/client/src/collision_events.mjs";

assert.equal(
  classifyCollisionSurface({ positionRos: [0, 0, 0.4], normalRos: [0, 0, 1] }),
  "ground",
);
assert.equal(
  classifyCollisionSurface({ positionRos: [0, 0, 18], normalRos: [0, 0, 1] }),
  "roof",
);
assert.equal(
  classifyCollisionSurface({ positionRos: [0, 0, 18], normalRos: [1, 0, 0] }),
  "wall",
);
assert.equal(
  classifyCollisionSurface({
    positionRos: [0, 0, 15.35],
    normalRos: [0, 0, 1],
    terrainHeightM: 15.2,
  }),
  "ground",
);

const tracker = new CollisionEventTracker({ dedupMilliseconds: 750 });
assert.equal(tracker.update({
  droneId: "Drone",
  positionRos: [0, 0, 10],
  collidedCounts: 4,
  timestampMilliseconds: 1000,
}), null, "first counter sample establishes the baseline");

const wall = tracker.update({
  droneId: "Drone",
  positionRos: [1, 0, 10],
  collidedCounts: 5,
  timestampMilliseconds: 1100,
});
assert.equal(wall.id, "Drone:status:5");
assert.equal(wall.surfaceType, "wall");
assert.equal(wall.estimated, true);
assert.ok(Math.abs(wall.impactSpeedMps - 10) < 1e-6);
assert.equal(collisionNormalTip(wall, 5)[0], -4);

assert.equal(tracker.update({
  droneId: "Drone",
  positionRos: [1.05, 0, 10],
  collidedCounts: 6,
  timestampMilliseconds: 1200,
}), null, "nearby contact increments inside the debounce window are deduplicated");

tracker.update({
  droneId: "Drone",
  positionRos: [1.05, 0, 10],
  collidedCounts: 6,
  impulseCollision: { collision: false, normalRos: [0, 0, 0] },
  timestampMilliseconds: 2000,
});
const detailed = tracker.update({
  droneId: "Drone",
  positionRos: [1.05, 0, 10],
  collidedCounts: 6,
  impulseCollision: { collision: true, normalRos: [0, 0, 1] },
  timestampMilliseconds: 2100,
});
assert.equal(detailed.source, "impulse_collision");
assert.equal(detailed.surfaceType, "roof");
assert.equal(detailed.estimated, false);

console.log("OK: collision event tracker tests passed");
