jest.mock('../../src/models/insvGyro', () => ({ createInsvGyroTrack: jest.fn() }));
jest.mock('../../src/models/insvHorizon', () => ({ createInsvHorizonTrack: jest.fn() }));
jest.mock('../../src/models/insvPair', () => ({ assertCurrentPair: jest.fn() }));

const { createInsvGyroTrack } = require('../../src/models/insvGyro');
const { createInsvHorizonTrack } = require('../../src/models/insvHorizon');
const { assertCurrentPair } = require('../../src/models/insvPair');
const { prepareInsvMotion, closestInsvRotation } = require('../../src/models/insvMotion');

describe('INSV import motion preparation', () => {
  const pair = { paths: ['00.insv', '10.insv'], sampleTime: 1 };
  const track = [
    { time: 0, rotation: [0, 0, 0, 1] },
    { time: 2, rotation: [0, 1, 0, 0] },
  ];

  beforeEach(() => {
    jest.resetAllMocks();
    assertCurrentPair.mockResolvedValue();
  });

  test('prefers gyro and selects the nearest sample for the thumbnail', async () => {
    createInsvGyroTrack.mockResolvedValue(track);
    const result = await prepareInsvMotion(pair);
    expect(result).toEqual({ mode: 'gyro', frames: track, warning: '' });
    expect(createInsvHorizonTrack).not.toHaveBeenCalled();
    expect(closestInsvRotation(track, 1.1)).toEqual(track[1].rotation);
    expect(closestInsvRotation(track, -1)).toEqual(track[0].rotation);
    expect(closestInsvRotation(track, 5)).toEqual(track[1].rotation);
  });

  test('warns and uses horizon when gyro is unsupported', async () => {
    createInsvGyroTrack.mockRejectedValue(new Error('Gyro timestamps unavailable.'));
    createInsvHorizonTrack.mockResolvedValue(track);
    const result = await prepareInsvMotion(pair);
    expect(result).toMatchObject({ mode: 'horizon', frames: track });
    expect(result.warning).toMatch(/horizon leveling only.*Gyro timestamps unavailable/i);
  });

  test('marks a fallback as transient when the gyro tool cannot be started', async () => {
    createInsvGyroTrack.mockRejectedValue(Object.assign(new Error('ffprobe missing'), { code: 'ENOENT' }));
    createInsvHorizonTrack.mockResolvedValue(track);
    const onTransientFailure = jest.fn();
    expect(await prepareInsvMotion(pair, { onTransientFailure })).toMatchObject({ mode: 'horizon', frames: track });
    expect(onTransientFailure).toHaveBeenCalledTimes(1);
  });

  test('warns and uses identity when neither correction is available', async () => {
    createInsvGyroTrack.mockRejectedValue(new Error('Gyro unavailable.'));
    createInsvHorizonTrack.mockRejectedValue(new Error('Horizon unavailable.'));
    const result = await prepareInsvMotion(pair);
    expect(result).toMatchObject({ mode: 'none', frames: [] });
    expect(result.warning).toMatch(/Gyro unavailable.*Horizon unavailable/);
    expect(closestInsvRotation(result.frames, 1)).toEqual([0, 0, 0, 1]);
  });

  test('does not mask changed sources as a fallback', async () => {
    createInsvGyroTrack.mockRejectedValue(new Error('Gyro unavailable.'));
    assertCurrentPair.mockRejectedValue(new Error('Source changed.'));
    await expect(prepareInsvMotion(pair)).rejects.toThrow('Source changed.');
    expect(createInsvHorizonTrack).not.toHaveBeenCalled();
  });
});
