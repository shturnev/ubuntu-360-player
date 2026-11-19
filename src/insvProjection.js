import geometry from './insvGeometry.json';

export const INSV_VERTEX_SHADER = `
  attribute vec2 position;
  varying vec2 screenPosition;

  void main() {
    screenPosition = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

// Approximate dual-fisheye projection; the camera's factory calibration is not applied.
export const INSV_FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D lens00;
  uniform sampler2D lens10;
  uniform bool flatProjection;
  uniform float yaw;
  uniform float pitch;
  uniform float fieldOfView;
  uniform float lensFieldOfView;
  uniform float aspectRatio;
  uniform vec4 horizonRotation;
  varying vec2 screenPosition;
  const float PI = 3.14159265359;

  vec2 lensCoordinates(vec3 direction, float facing) {
    float angle = acos(clamp(direction.z * facing, -1.0, 1.0));
    float radius = angle / (lensFieldOfView * PI / 360.0) * ${geometry.radius.toFixed(3)};
    vec2 axis = vec2(direction.x * facing, direction.y);
    float axisLength = length(axis);
    return vec2(0.5) + (axisLength > 0.00001 ? axis / axisLength * radius : vec2(0.0));
  }

  void main() {
    vec3 direction;
    if (flatProjection) {
      float longitude = (screenPosition.x - 0.5) * 2.0 * PI;
      float latitude = (screenPosition.y - 0.5) * PI;
      direction = vec3(sin(longitude) * cos(latitude), sin(latitude), -cos(longitude) * cos(latitude));
    } else {
      float scale = tan(fieldOfView * 0.5);
      direction = normalize(vec3(
        (screenPosition.x * 2.0 - 1.0) * scale * aspectRatio,
        (screenPosition.y * 2.0 - 1.0) * scale,
        -1.0
      ));
      float pitchCos = cos(pitch);
      float pitchSin = sin(pitch);
      direction.yz = mat2(pitchCos, -pitchSin, pitchSin, pitchCos) * direction.yz;
      float yawCos = cos(yaw);
      float yawSin = sin(yaw);
      direction.xz = mat2(yawCos, yawSin, -yawSin, yawCos) * direction.xz;
    }

    // Convert to camera coordinates before applying gyro correction.
    direction.y = -direction.y;
    vec3 correction = 2.0 * cross(horizonRotation.xyz, direction);
    direction += horizonRotation.w * correction + cross(horizonRotation.xyz, correction);
    vec4 first = texture2D(lens00, lensCoordinates(direction, 1.0));
    vec4 second = texture2D(lens10, lensCoordinates(direction, -1.0));
    gl_FragColor = mix(second, first, smoothstep(-${geometry.blend.toFixed(2)}, ${geometry.blend.toFixed(2)}, direction.z));
  }
`;
