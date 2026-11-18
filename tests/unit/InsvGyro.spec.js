const { makeGyroTrack, parseCameraTiming } = require('../../src/models/insvGyro');

function sampleData() {
  const imu = Array.from({ length: 201 }, (_, index) => {
    const time = index / 100;
    return {
      time: 10 + time,
      acceleration: [0, 0, 1],
      angularVelocity: [0, 0, Math.sin(time * Math.PI * 4)],
    };
  });
  const playback = Array.from({ length: 41 }, (_, index) => index / 20);
  return {
    telemetry: {
      model: 'Insta360 One2',
      imu,
      captureTimes: [],
      exposureTimes: playback.map((time) => 10 + time),
    },
    playback,
    timing: { firstFrame: 10, gyroOffset: 0 },
  };
}

describe('INSV experimental gyro stabilization', () => {
  test('reads first-frame and gyro timestamps and rejects unsupported camera modes', () => {
    const offset = Buffer.alloc(8);
    offset.writeDoubleLE(-6);
    const metadata = Buffer.concat([
      Buffer.from([0xc0, 0x01, 0xd4, 0xe6, 0x02, 0xe1, 0x01]),
      offset,
      Buffer.from([0xe8, 0x01, 1]),
    ]);
    expect(parseCameraTiming(metadata)).toEqual({ firstFrame: 45.908, gyroOffset: -0.006 });
    expect(() => parseCameraTiming(Buffer.concat([metadata, Buffer.from([0xf0, 0x01, 2])]))).toThrow(/non-timelapse/);
    expect(() => parseCameraTiming(Buffer.concat([metadata, Buffer.from([0xf0, 0x03, 1])]))).toThrow(/non-timelapse/);
    expect(() => parseCameraTiming(metadata.subarray(0, 8))).toThrow(/metadata/);
  });

  test('stabilizes changing yaw while retaining the gravity-aligned horizon', () => {
    const { telemetry, playback, timing } = sampleData();
    const frames = makeGyroTrack(telemetry, playback, timing);
    expect(frames).toHaveLength(playback.length);
    expect(frames.some((frame) => Math.abs(frame.rotation[1]) > 0.01)).toBe(true);
    frames.forEach(({ rotation }) => {
      expect(Math.hypot(...rotation)).toBeCloseTo(1);
      expect(rotation[0]).toBeCloseTo(0);
      expect(rotation[2]).toBeCloseTo(0);
    });
  });

  test('rejects missing sensor data, unreliable synchronization and unsupported recordings', () => {
    const { telemetry, playback, timing } = sampleData();
    expect(() => makeGyroTrack({ ...telemetry, model: 'other' }, playback, timing)).toThrow(/not calibrated/);
    expect(() => makeGyroTrack({ ...telemetry, captureTimes: [10] }, playback, timing)).toThrow(/normal-video/);
    expect(() => makeGyroTrack({ ...telemetry, exposureTimes: [10] }, playback, timing)).toThrow(/exposure/);
    const imu = telemetry.imu.filter((_, i) => i !== 50 && i !== 51);
    expect(() => makeGyroTrack({ ...telemetry, imu }, playback, timing)).toThrow(/timing gaps/);
    expect(() => makeGyroTrack(telemetry, playback, { ...timing, firstFrame: 20 })).toThrow(/incomplete/);
  });

  test('limits transient accelerometer tilt using the gyro', () => {
    const { telemetry, playback, timing } = sampleData();
    telemetry.imu.forEach((sample) => {
      sample.angularVelocity = [0, 0, 0];
      if (sample.time >= 11) sample.acceleration = [0.3, 0, 1];
    });
    const frames = makeGyroTrack(telemetry, playback, timing);
    expect(Math.abs(frames[22].rotation[2])).toBeLessThan(0.03);
  });
});
