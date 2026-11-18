import { createInsvPlayback } from '../../src/insvPlayback';

class FakeVideo extends EventTarget {
  constructor() {
    super();
    this.muted = false;
    this.paused = true;
    this.readyState = 4;
    this.duration = 30;
    this.seeking = false;
    this.playbackRate = 1;
    this.time = 0;
    this.nextId = 0;
    this.callbacks = new Map();
    this.play = jest.fn(async () => {
      this.paused = false;
    });
    this.pause = jest.fn(() => {
      this.paused = true;
    });
    this.removeAttribute = jest.fn();
    this.load = jest.fn();
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(time) {
    this.time = time;
    this.seeking = true;
    Promise.resolve().then(() => {
      this.seeking = false;
      this.dispatchEvent(new Event('seeked'));
    });
  }

  requestVideoFrameCallback(callback) {
    const id = ++this.nextId;
    this.callbacks.set(id, callback);
    return id;
  }

  cancelVideoFrameCallback(id) {
    this.callbacks.delete(id);
  }

  frame(mediaTime) {
    const [id, callback] = this.callbacks.entries().next().value;
    this.callbacks.delete(id);
    callback(performance.now(), { mediaTime });
  }
}

describe('INSV paired playback', () => {
  let videos;
  let onFrame;
  let onState;
  let onError;
  let playback;

  beforeEach(() => {
    jest.useFakeTimers();
    videos = [new FakeVideo(), new FakeVideo()];
    onFrame = jest.fn();
    onState = jest.fn();
    onError = jest.fn();
    playback = createInsvPlayback({ videos, frameRate: 30, onFrame, onState, onError });
  });

  afterEach(() => {
    playback.destroy();
    jest.useRealTimers();
  });

  test('plays and pauses both lenses, keeping audio only on the master', async () => {
    await playback.play();
    expect(videos.map((video) => video.paused)).toEqual([false, false]);
    expect(videos.map((video) => video.muted)).toEqual([false, true]);
    playback.pause();
    expect(videos.map((video) => video.paused)).toEqual([true, true]);
  });

  test('delivers only frames whose actual presentation timestamps agree', async () => {
    await playback.play();
    videos[0].frame(1);
    videos[1].frame(1.2);
    expect(onFrame).not.toHaveBeenCalled();
    videos[1].frame(1.03);
    expect(onFrame).not.toHaveBeenCalled();
    videos[0].frame(1.03);
    expect(onFrame).toHaveBeenCalledWith([1.03, 1.03]);
  });

  test('adjusts only the follower clock and restores its rate after pause', async () => {
    await playback.play();
    videos[0].time = 1;
    videos[1].time = 1.06;
    videos[0].frame(1);
    videos[1].frame(1.06);
    expect(videos[1].playbackRate).toBeCloseTo(0.88);
    expect(onFrame).not.toHaveBeenCalled();
    videos[1].time = 1;
    videos[1].frame(1);
    expect(videos[1].playbackRate).toBe(1);
    expect(onFrame).toHaveBeenCalledWith([1, 1]);
    videos[1].time = 0.95;
    videos[1].frame(1.033);
    expect(videos[1].playbackRate).toBeCloseTo(1.1);
    playback.pause();
    expect(videos[1].playbackRate).toBe(1);
  });

  test('uses the source frame rate to reject a one-frame mismatch at 60 fps', async () => {
    playback.destroy();
    playback = createInsvPlayback({ videos, frameRate: 60, onFrame, onState, onError });
    await playback.play();
    videos[0].frame(1);
    videos[1].frame(1 + 1 / 60);
    expect(onFrame).not.toHaveBeenCalled();
    videos[0].frame(1 + 1 / 60);
    expect(onFrame).toHaveBeenCalledWith([1 + 1 / 60, 1 + 1 / 60]);
  });

  test('seeks both lenses and resumes them together', async () => {
    await playback.play();
    await playback.seek(12);
    expect(videos.map((video) => video.currentTime)).toEqual([12, 12]);
    expect(videos.map((video) => video.paused)).toEqual([false, false]);
    playback.pause();
    await playback.seek(3);
    expect(videos.map((video) => video.currentTime)).toEqual([3, 3]);
    expect(videos.map((video) => video.paused)).toEqual([true, true]);
  });

  test('recovers persistent timestamp drift by seeking both streams to the master clock', async () => {
    await playback.play();
    videos[0].time = 5;
    videos[1].time = 4;
    videos[0].frame(5);
    videos[1].frame(4);
    jest.advanceTimersByTime(600);
    videos[0].frame(5.1);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(videos.map((video) => video.currentTime)).toEqual([5, 5]);
    expect(onFrame).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test('publishes the matching frames after a seek while paused', async () => {
    await playback.seek(12);
    videos[0].frame(12);
    videos[1].frame(12);
    expect(onFrame).toHaveBeenLastCalledWith([12, 12]);
    expect(videos.every((video) => video.paused)).toBe(true);
  });

  test('pause during an in-flight seek prevents a stale resume', async () => {
    await playback.play();
    const seek = playback.seek(12);
    playback.pause();
    await seek;
    expect(videos.every((video) => video.paused)).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  test('pauses both on buffering and resumes only when both can play', async () => {
    await playback.play();
    videos[1].readyState = 2;
    videos[1].dispatchEvent(new Event('waiting'));
    expect(videos.map((video) => video.paused)).toEqual([true, true]);
    videos[0].dispatchEvent(new Event('canplay'));
    expect(videos[0].play).toHaveBeenCalledTimes(1);
    videos[1].readyState = 4;
    videos[1].dispatchEvent(new Event('canplay'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(videos.map((video) => video.paused)).toEqual([false, false]);
  });

  test('stops both on a lens error or decoder timeout', async () => {
    await playback.play();
    videos[1].dispatchEvent(new Event('error'));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('lens 2'));
    expect(videos.map((video) => video.paused)).toEqual([true, true]);
    jest.advanceTimersByTime(9000);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test('fails if synchronized frames never arrive', async () => {
    await playback.play();
    jest.advanceTimersByTime(8000);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('synchronized frames'));
    expect(videos.every((video) => video.paused)).toBe(true);
  });

  test('removes callbacks and event handlers when destroyed', async () => {
    await playback.play();
    playback.destroy();
    expect(videos.every((video) => video.paused && video.callbacks.size === 0)).toBe(true);
    expect(
      videos.every((video) => video.removeAttribute.mock.calls.length === 1 && video.load.mock.calls.length === 1)
    ).toBe(true);
    videos[1].dispatchEvent(new Event('error'));
    jest.advanceTimersByTime(9000);
    expect(onError).not.toHaveBeenCalled();
  });

  test('rejects environments without timestamped video frames', () => {
    expect(() => createInsvPlayback({ videos: [{}, {}] })).toThrow(/timestamp/);
  });

  test('rejects missing or invalid source frame rates', () => {
    expect(() => createInsvPlayback({ videos })).toThrow(/frame rate/);
    expect(() => createInsvPlayback({ videos, frameRate: Infinity })).toThrow(/frame rate/);
  });
});
