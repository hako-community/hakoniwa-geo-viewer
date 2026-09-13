import assert from 'node:assert/strict';
import {
  composeRotorMaprayOrientation,
  hakoniwaRpyToMaprayOrientation,
  maprayOrientationToMatrix,
  rotateRosVectorByRpy,
} from '../src/client/src/mapray_drone_pose.mjs';

const near = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
};

const level = hakoniwaRpyToMaprayOrientation([0, 0, 0]);
near(level.heading, 0);
near(level.tilt, 0);
near(level.roll, 0);

const yaw90 = hakoniwaRpyToMaprayOrientation([0, 0, 90]);
near(yaw90.heading, -90);
near(yaw90.tilt, 0);
near(yaw90.roll, 0);
near(Math.abs(hakoniwaRpyToMaprayOrientation([0, 0, 180]).heading), 180);
near(hakoniwaRpyToMaprayOrientation([10, 0, 0]).roll, -10);
near(hakoniwaRpyToMaprayOrientation([0, 10, 0]).tilt, 10);

const west = rotateRosVectorByRpy([1, 0, 0], [0, 0, 90]);
near(west[0], 0);
near(west[1], 1);
near(west[2], 0);

// Local rotor spin must preserve its body-relative vertical axis while tilted.
const body = maprayOrientationToMatrix(hakoniwaRpyToMaprayOrientation([12, 20, 35]));
const rotor = maprayOrientationToMatrix(composeRotorMaprayOrientation([12, 20, 35], 1.25));
for (let row = 0; row < 3; row += 1) near(body[row][2], rotor[row][2]);

console.log('Mapray drone pose tests: PASSED');
