const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function multiply3(a, b) {
  return Array.from({ length: 3 }, (_, row) => Array.from(
    { length: 3 },
    (_, column) => a[row][0] * b[0][column]
      + a[row][1] * b[1][column]
      + a[row][2] * b[2][column],
  ));
}

function rotationX(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

function rotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

function rotationZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

function normalizeDegrees(value) {
  const wrapped = finiteNumber(value) % 360;
  if (wrapped > 180) return wrapped - 360;
  if (wrapped <= -180) return wrapped + 360;
  return wrapped;
}

export function rosRpyToRotationMatrix(rpyDeg = [0, 0, 0]) {
  const roll = finiteNumber(rpyDeg[0]) * DEG_TO_RAD;
  const pitch = finiteNumber(rpyDeg[1]) * DEG_TO_RAD;
  const yaw = finiteNumber(rpyDeg[2]) * DEG_TO_RAD;
  return multiply3(multiply3(rotationZ(yaw), rotationY(pitch)), rotationX(roll));
}

// ROS [Forward, Left, Up] -> Mapray local [East, North, Up].
const ROS_TO_MAPRAY = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
const MAPRAY_TO_ROS = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]];

export function rosRotationToMaprayMatrix(rosRotation) {
  return multiply3(multiply3(ROS_TO_MAPRAY, rosRotation), MAPRAY_TO_ROS);
}

export function maprayOrientationToMatrix(orientation = {}) {
  const heading = finiteNumber(orientation.heading) * DEG_TO_RAD;
  const tilt = finiteNumber(orientation.tilt) * DEG_TO_RAD;
  const roll = finiteNumber(orientation.roll) * DEG_TO_RAD;
  return multiply3(
    multiply3(rotationZ(-heading), rotationX(-tilt)),
    rotationY(-roll),
  );
}

export function maprayMatrixToOrientation(matrix) {
  const sinTilt = Math.max(-1, Math.min(1, -matrix[2][1]));
  const tilt = Math.asin(sinTilt);
  const cosTilt = Math.cos(tilt);
  let heading;
  let roll;
  if (Math.abs(cosTilt) > 1e-9) {
    heading = Math.atan2(matrix[0][1], matrix[1][1]);
    roll = Math.atan2(matrix[2][0], matrix[2][2]);
  } else {
    heading = Math.atan2(-matrix[1][0], matrix[0][0]);
    roll = 0;
  }
  return {
    heading: normalizeDegrees(heading * RAD_TO_DEG),
    tilt: normalizeDegrees(tilt * RAD_TO_DEG),
    roll: normalizeDegrees(roll * RAD_TO_DEG),
  };
}

export function hakoniwaRpyToMaprayOrientation(rpyDeg, orientationOffsetDeg = {}) {
  const body = rosRotationToMaprayMatrix(rosRpyToRotationMatrix(rpyDeg));
  const offset = maprayOrientationToMatrix(orientationOffsetDeg);
  return maprayMatrixToOrientation(multiply3(body, offset));
}

export function composeRotorMaprayOrientation(
  rpyDeg,
  phaseRad,
  orientationOffsetDeg = {},
) {
  const bodyWithLocalSpin = multiply3(
    rosRpyToRotationMatrix(rpyDeg),
    rotationZ(finiteNumber(phaseRad)),
  );
  const maprayRotation = rosRotationToMaprayMatrix(bodyWithLocalSpin);
  return maprayMatrixToOrientation(multiply3(
    maprayRotation,
    maprayOrientationToMatrix(orientationOffsetDeg),
  ));
}

export function rotateRosVectorByRpy(vector, rpyDeg) {
  const rotation = rosRpyToRotationMatrix(rpyDeg);
  const source = [0, 1, 2].map((index) => finiteNumber(vector?.[index]));
  return rotation.map((row) => row[0] * source[0] + row[1] * source[1] + row[2] * source[2]);
}
