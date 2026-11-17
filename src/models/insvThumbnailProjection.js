const geometry = require('../insvGeometry.json');

function sample(image, size, u, v) {
  const x = Math.max(0, Math.min(size - 1, u * size - 0.5));
  const y = Math.max(0, Math.min(size - 1, (1 - v) * size - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;
  const indices = [(y0 * size + x0) * 4, (y0 * size + x1) * 4, (y1 * size + x0) * 4, (y1 * size + x1) * 4];
  return [0, 1, 2].map((channel) => {
    const top = image[indices[0] + channel] * (1 - dx) + image[indices[1] + channel] * dx;
    const bottom = image[indices[2] + channel] * (1 - dx) + image[indices[3] + channel] * dx;
    return top * (1 - dy) + bottom * dy;
  });
}

function projectInsvThumbnail(images, sourceSize, width, height, rotation = [0, 0, 0, 1]) {
  if (
    !Array.isArray(images) ||
    images.length !== 2 ||
    images.some((image) => !Buffer.isBuffer(image) || image.length !== sourceSize * sourceSize * 4) ||
    !Number.isSafeInteger(sourceSize) ||
    sourceSize <= 0 ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    !Array.isArray(rotation) ||
    rotation.length !== 4 ||
    rotation.some((value) => !Number.isFinite(value)) ||
    Math.abs(Math.hypot(...rotation) - 1) > 0.001
  ) {
    throw new Error('Invalid INSV thumbnail frames.');
  }
  const output = Buffer.alloc(width * height * 4);
  const halfFov = (geometry.fieldOfViewDegrees * Math.PI) / 360;
  const [qx, qy, qz, qw] = rotation;
  for (let y = 0; y < height; y += 1) {
    const latitude = (0.5 - (y + 0.5) / height) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    for (let x = 0; x < width; x += 1) {
      const longitude = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
      let dx = -Math.sin(longitude) * cosLatitude;
      let dy = -Math.sin(latitude);
      let dz = -Math.cos(longitude) * cosLatitude;
      const tx = 2 * (qy * dz - qz * dy);
      const ty = 2 * (qz * dx - qx * dz);
      const tz = 2 * (qx * dy - qy * dx);
      dx += qw * tx + qy * tz - qz * ty;
      dy += qw * ty + qz * tx - qx * tz;
      dz += qw * tz + qx * ty - qy * tx;
      const axisLength = Math.hypot(dx, dy);
      const colors = [1, -1].map((facing, index) => {
        const angle = Math.acos(Math.max(-1, Math.min(1, dz * facing)));
        const radius = (angle / halfFov) * geometry.radius;
        const u = 0.5 + (axisLength > 0.00001 ? ((dx * facing) / axisLength) * radius : 0);
        const v = 0.5 + (axisLength > 0.00001 ? (dy / axisLength) * radius : 0);
        return sample(images[index], sourceSize, u, v);
      });
      const t = Math.max(0, Math.min(1, (dz + geometry.blend) / (2 * geometry.blend)));
      const weight = t * t * (3 - 2 * t);
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output[offset + channel] = Math.round(colors[1][channel] * (1 - weight) + colors[0][channel] * weight);
      }
      output[offset + 3] = 255;
    }
  }
  return output;
}

module.exports = { projectInsvThumbnail };
