const DRIFT_GRACE_MS = 500;
const WAIT_TIMEOUT_MS = 8000;
const MAX_CLOCK_DRIFT_SECONDS = 0.25;

export function createInsvPlayback({ videos, frameRate, onFrame, onState, onError }) {
  if (
    !Array.isArray(videos) ||
    videos.length !== 2 ||
    videos.some((video) => !video || typeof video.requestVideoFrameCallback !== 'function')
  ) {
    throw new Error('Synchronized INSV playback requires two video decoders with frame timestamp support.');
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error('The INSV frame rate is unavailable.');

  const [master, follower] = videos;
  const frameTolerance = 0.5 / frameRate;
  follower.muted = true;
  const listeners = [];
  const callbacks = [null, null];
  const frames = [null, null];
  const pendingSeeks = new Set();
  let destroyed = false;
  let wanted = false;
  let failed = false;
  let revision = 0;
  let waiting = false;
  let seeking = false;
  let seekTarget = null;
  let driftSince = null;
  let recoveryTimes = [];
  let timer = null;

  const clearWait = () => {
    clearTimeout(timer);
    timer = null;
  };
  const cancelSeeks = () => {
    for (const cancel of pendingSeeks) cancel();
  };
  const pauseBoth = () => {
    videos.forEach((video) => video.pause());
    follower.playbackRate = 1;
  };
  const reportFailure = (message) => {
    if (destroyed || failed) return;
    failed = true;
    wanted = false;
    revision += 1;
    clearWait();
    cancelSeeks();
    pauseBoth();
    onState?.({ playing: false, waiting: false });
    onError?.(message);
  };
  const armWait = (message) => {
    clearWait();
    timer = setTimeout(() => reportFailure(message), WAIT_TIMEOUT_MS);
  };

  const start = async (version) => {
    if (destroyed || failed || !wanted || version !== revision) return;
    waiting = false;
    armWait('The INSV pair could not produce synchronized frames. A decoder may be unavailable or too slow.');
    try {
      await Promise.all(videos.map((video) => video.play()));
      if (destroyed || !wanted) {
        pauseBoth();
        return;
      }
      if (version !== revision || waiting) return;
      onState?.({ playing: true, waiting: false });
    } catch (error) {
      if (!destroyed && version === revision && !waiting) {
        reportFailure(`Unable to play both INSV lenses: ${error?.message || 'decoder error'}`);
      }
    }
  };

  const seekOne = (video, time) =>
    new Promise((resolve, reject) => {
      if (Math.abs(video.currentTime - time) < 0.001 && !video.seeking) {
        resolve();
        return;
      }
      let timeout;
      const finish = (error) => {
        clearTimeout(timeout);
        video.removeEventListener('seeked', handleSeeked);
        pendingSeeks.delete(cancel);
        if (error) reject(error);
        else resolve();
      };
      const handleSeeked = () => finish();
      const cancel = () => finish(new Error('Playback cancelled.'));
      pendingSeeks.add(cancel);
      video.addEventListener('seeked', handleSeeked);
      timeout = setTimeout(() => finish(new Error('Seeking an INSV lens timed out.')), WAIT_TIMEOUT_MS);
      try {
        video.currentTime = time;
      } catch (error) {
        finish(error);
      }
    });

  const seek = async (time, resume = wanted) => {
    if (destroyed || failed || !Number.isFinite(time)) return;
    const version = ++revision;
    cancelSeeks();
    clearWait();
    pauseBoth();
    wanted = resume;
    seeking = true;
    waiting = false;
    frames.fill(null);
    driftSince = null;
    onState?.({ playing: false, waiting: true });
    const duration = Math.min(...videos.map((video) => (Number.isFinite(video.duration) ? video.duration : Infinity)));
    const target = Math.max(0, Math.min(time, duration));
    seekTarget = target;
    try {
      await Promise.all(videos.map((video) => seekOne(video, target)));
      if (destroyed || version !== revision) return;
      seeking = false;
      seekTarget = null;
      onState?.({ playing: false, waiting: false });
      if (wanted) await start(version);
      else publishFrames();
    } catch (error) {
      if (!destroyed && version === revision) reportFailure(`Unable to seek both INSV lenses: ${error.message}`);
    }
  };

  const recover = () => {
    const now = Date.now();
    recoveryTimes = recoveryTimes.filter((time) => now - time < 10000);
    if (recoveryTimes.length >= 3) {
      reportFailure('The INSV lenses cannot stay synchronized. The system may be unable to decode both videos.');
      return;
    }
    recoveryTimes.push(now);
    void seek(master.currentTime, true);
  };

  const publishFrames = () => {
    if (waiting || seeking || frames[0] === null || frames[1] === null) return;
    if (wanted) {
      const drift = follower.currentTime - master.currentTime;
      if (Number.isFinite(drift)) {
        follower.playbackRate = Math.max(0.8, Math.min(1.2, 1 - drift * 2));
        if (Math.abs(drift) <= MAX_CLOCK_DRIFT_SECONDS) driftSince = null;
        else if (driftSince === null) driftSince = performance.now();
        else if (performance.now() - driftSince >= DRIFT_GRACE_MS) {
          driftSince = null;
          recover();
          return;
        }
      }
    }
    if (Math.abs(frames[0] - frames[1]) <= frameTolerance) {
      if (wanted) armWait('The INSV pair stopped producing synchronized frames.');
      onFrame?.([...frames]);
    }
  };

  const watchFrames = (index) => {
    callbacks[index] = videos[index].requestVideoFrameCallback((_now, metadata) => {
      if (destroyed || failed) return;
      callbacks[index] = null;
      if (
        !waiting &&
        Number.isFinite(metadata.mediaTime) &&
        (!seeking || Math.abs(metadata.mediaTime - seekTarget) <= frameTolerance)
      ) {
        frames[index] = metadata.mediaTime;
        publishFrames();
      }
      if (!destroyed && !failed) watchFrames(index);
    });
  };

  const listen = (video, event, handler) => {
    video.addEventListener(event, handler);
    listeners.push(() => video.removeEventListener(event, handler));
  };
  videos.forEach((video, index) => {
    listen(video, 'error', () => reportFailure(`INSV lens ${index + 1} could not be loaded or decoded.`));
    for (const event of ['waiting', 'stalled']) {
      listen(video, event, () => {
        if (!wanted || seeking || waiting || destroyed || failed) return;
        waiting = true;
        pauseBoth();
        onState?.({ playing: false, waiting: true });
        armWait('An INSV lens stopped buffering; synchronized playback cannot continue.');
      });
    }
    listen(video, 'canplay', () => {
      if (waiting && wanted && !seeking && videos.every((item) => item.readyState >= 3)) {
        void seek(master.currentTime, true);
      }
    });
    listen(video, 'ended', () => {
      if (!wanted || destroyed || failed) return;
      wanted = false;
      revision += 1;
      clearWait();
      pauseBoth();
      onState?.({ playing: false, waiting: false, ended: true });
    });
    watchFrames(index);
  });

  return {
    async play() {
      if (destroyed || failed || wanted) return;
      wanted = true;
      await seek(master.currentTime, true);
    },
    pause() {
      if (destroyed || failed) return;
      wanted = false;
      revision += 1;
      waiting = false;
      seeking = false;
      seekTarget = null;
      clearWait();
      cancelSeeks();
      pauseBoth();
      onState?.({ playing: false, waiting: false });
    },
    seek,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      wanted = false;
      revision += 1;
      clearWait();
      cancelSeeks();
      pauseBoth();
      listeners.forEach((remove) => remove());
      callbacks.forEach((id, index) => {
        if (id !== null) videos[index].cancelVideoFrameCallback?.(id);
      });
      videos.forEach((video) => {
        video.removeAttribute('src');
        video.load();
      });
    },
  };
}
