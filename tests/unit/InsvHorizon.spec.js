const { parseTelemetry, makeHorizonTrack } = require('../../src/models/insvHorizon');

const telemetry = `
[Insta360]      Model : Insta360 One2
[Doc1:Insta360] TimeCode : 10.000
[Doc2:Insta360] TimeCode : 11.000
[Doc1:Insta360] Accelerometer : -1 0 0
[Doc2:Insta360] Accelerometer : 0 1 0
[Doc3:Insta360] VideoTimeStamp : 10.000
[Doc4:Insta360] VideoTimeStamp : 11.000
`;

function rotate(q, vector) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = vector;
  const t = [2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)];
  return [
    vx + w * t[0] + y * t[2] - z * t[1],
    vy + w * t[1] + z * t[0] - x * t[2],
    vz + w * t[2] + x * t[1] - y * t[0],
  ];
}

describe('INSV experimental horizon track', () => {
  test('matches grouped sensor records to capture times and maps gravity into the viewer', () => {
    const data = parseTelemetry(telemetry);
    const track = makeHorizonTrack(data, [0, 1]);
    expect(track).toHaveLength(2);
    expect(track.map((frame) => frame.time)).toEqual([0, 1]);
    const first = rotate(track[0].rotation, [0, 1, 0]);
    expect(first[0]).toBeCloseTo(-1);
    expect(first[1]).toBeCloseTo(0);
    expect(first[2]).toBeCloseTo(0);
    const second = rotate(track[1].rotation, [0, 1, 0]);
    expect(second[0]).toBeCloseTo(0);
    expect(second[1]).toBeCloseTo(0);
    expect(second[2]).toBeCloseTo(-1);
  });

  test('rejects unsupported cameras and missing or unsynchronized capture timestamps', () => {
    const data = parseTelemetry(telemetry);
    expect(() => makeHorizonTrack({ ...data, model: 'unknown' }, [0, 1])).toThrow(/not calibrated/);
    expect(() => makeHorizonTrack({ ...data, captureTimes: [] }, [0, 1])).toThrow(/timestamps/);
    expect(() => makeHorizonTrack({ ...data, captureTimes: [10, 10] }, [0, 1])).toThrow(/timestamps/);
    expect(() => makeHorizonTrack(data, [0])).toThrow(/timestamps/);
    expect(() => makeHorizonTrack(data, [0, 0])).toThrow(/timestamps/);
    expect(() => makeHorizonTrack({ ...data, captureTimes: [10, 12] }, [0, 1])).toThrow(/nearby motion/);
  });

  test('rejects accelerometer samples that cannot reliably determine gravity', () => {
    const data = parseTelemetry(telemetry);
    data.imu[0].acceleration = [8, 0, 0];
    expect(() => makeHorizonTrack(data, [0, 1])).toThrow(/cannot reliably determine/);
  });
});
