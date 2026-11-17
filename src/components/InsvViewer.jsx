import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createInsvPlayback } from '../insvPlayback.js';
import { INSV_FRAGMENT_SHADER, INSV_VERTEX_SHADER } from '../insvProjection.js';
import VideoControls from './VideoControls.jsx';
import './PanoramaViewer.scss';

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create INSV shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unable to compile INSV shader.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function closestHorizonRotation(frames, time) {
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].time < time) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(frames[low - 1].time - time) < Math.abs(frames[low].time - time))
    return frames[low - 1].rotation;
  return frames[low].rotation;
}

const InsvViewer = forwardRef(function InsvViewer(
  {
    sources,
    flatProjection = false,
    motionMode = 'gyro',
    motionWarning,
    onToggleFullscreen,
    isFullscreen,
    onCaptureReadyChange,
  },
  ref
) {
  const canvasRef = useRef(null);
  const firstRef = useRef(null);
  const secondRef = useRef(null);
  const playbackRef = useRef(null);
  const drawRef = useRef(() => {});
  const camera = useRef({ yaw: 0, pitch: 0, fov: 1.2, drag: null });
  const flatRef = useRef(flatProjection);
  const horizonRef = useRef([]);
  const correctionReadyRef = useRef(false);
  const captureReadyRef = useRef(false);
  const frameTimeRef = useRef(0);
  const [message, setMessage] = useState('');
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [progress, setProgress] = useState({ time: 0, duration: 0 });
  const [volume, setVolume] = useState(1);
  const [correctionLoading, setCorrectionLoading] = useState(true);
  const firstSource = sources?.[0];
  const secondSource = sources?.[1];

  useEffect(() => {
    flatRef.current = flatProjection;
    drawRef.current();
  }, [flatProjection]);

  useImperativeHandle(ref, () => ({
    pause: () => playbackRef.current?.pause(),
    togglePlayback: () => {
      if (!correctionReadyRef.current) return;
      if (firstRef.current?.paused) void playbackRef.current?.play();
      else playbackRef.current?.pause();
    },
    async captureScreenshot() {
      const canvas = canvasRef.current;
      if (!captureReadyRef.current || !canvas) throw new Error('The 360° view is not ready to save.');
      try {
        drawRef.current();
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (!blob) throw new Error('Unable to encode the 360° view.');
        return blob;
      } catch (error) {
        throw new Error('Unable to capture the current 360° view.');
      }
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const videos = [firstRef.current, secondRef.current];
    if (!canvas || videos.some((video) => !video)) return undefined;
    if (!firstSource || !secondSource) {
      setMessage('Both INSV sources are required for viewing.');
      return undefined;
    }
    let gl;
    try {
      gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true });
    } catch (error) {
      setMessage(`WebGL is unavailable: ${error.message}`);
      return undefined;
    }
    if (!gl) {
      setMessage('WebGL is unavailable; both INSV lenses are required for viewing.');
      return undefined;
    }

    let program;
    let vertex;
    let fragment;
    let buffer;
    const textures = [];
    let playback;
    let disposed = false;
    let failed = false;
    let hasFrame = false;
    let uploaded = [null, null];
    let integrityTimer;
    let checking = false;
    const abortChecks = new AbortController();
    camera.current = { yaw: 0, pitch: 0, fov: 1.2, drag: null };
    setMessage('');
    setPlaying(false);
    setWaiting(false);
    setProgress({ time: 0, duration: 0 });
    horizonRef.current = [];
    correctionReadyRef.current = false;
    captureReadyRef.current = false;
    onCaptureReadyChange?.(false);
    frameTimeRef.current = 0;
    setCorrectionLoading(true);

    const fail = (error) => {
      if (disposed || failed) return;
      failed = true;
      correctionReadyRef.current = false;
      captureReadyRef.current = false;
      onCaptureReadyChange?.(false);
      playback?.pause();
      setMessage(error?.message || String(error));
    };

    const draw = () => {
      if (disposed || failed || !hasFrame) return;
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform1i(gl.getUniformLocation(program, 'flatProjection'), flatRef.current ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, 'yaw'), camera.current.yaw);
      gl.uniform1f(gl.getUniformLocation(program, 'pitch'), camera.current.pitch);
      gl.uniform1f(gl.getUniformLocation(program, 'fieldOfView'), camera.current.fov);
      gl.uniform1f(gl.getUniformLocation(program, 'aspectRatio'), width / height);
      const track = horizonRef.current;
      const rotation = track.length ? closestHorizonRotation(track, frameTimeRef.current) : [0, 0, 0, 1];
      gl.uniform4f(gl.getUniformLocation(program, 'horizonRotation'), ...rotation);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const updateProgress = () => {
      const master = videos[0];
      setProgress({
        time: Number.isFinite(master.currentTime) ? master.currentTime : 0,
        duration: Number.isFinite(master.duration) ? master.duration : 0,
      });
    };
    const handleContextLost = (event) => {
      event.preventDefault();
      fail(new Error('WebGL was lost; synchronized INSV viewing is unavailable.'));
    };

    try {
      vertex = compile(gl, gl.VERTEX_SHADER, INSV_VERTEX_SHADER);
      fragment = compile(gl, gl.FRAGMENT_SHADER, INSV_FRAGMENT_SHADER);
      program = gl.createProgram();
      if (!program) throw new Error('Unable to create INSV renderer.');
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'Unable to link INSV renderer.');
      }
      gl.useProgram(program);
      buffer = gl.createBuffer();
      if (!buffer) throw new Error('Unable to create INSV geometry.');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      for (let index = 0; index < 2; index += 1) {
        const texture = gl.createTexture();
        if (!texture) throw new Error('Unable to create both INSV textures.');
        textures.push(texture);
        gl.activeTexture(gl.TEXTURE0 + index);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(gl.getUniformLocation(program, index ? 'lens10' : 'lens00'), index);
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      drawRef.current = draw;
      const startPlayback = () => {
        playback = createInsvPlayback({
          videos,
          onFrame: (times) => {
            if (failed || disposed || times[0] === uploaded[0] || times[1] === uploaded[1]) return;
            if (videos.some((video) => video.readyState < 2 || !video.videoWidth || !video.videoHeight)) return;
            try {
              const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
              if (videos.some((video) => video.videoWidth > maxTextureSize || video.videoHeight > maxTextureSize)) {
                throw new Error('The INSV video is larger than this GPU supports.');
              }
              videos.forEach((video, index) => {
                gl.activeTexture(gl.TEXTURE0 + index);
                gl.bindTexture(gl.TEXTURE_2D, textures[index]);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
              });
              if (gl.getError() !== gl.NO_ERROR) throw new Error('Unable to upload both INSV video frames.');
              uploaded = times;
              frameTimeRef.current = times[0];
              hasFrame = true;
              draw();
              if (!captureReadyRef.current) {
                captureReadyRef.current = true;
                onCaptureReadyChange?.(true);
              }
            } catch (error) {
              fail(error);
            }
          },
          onState: (state) => {
            if (disposed) return;
            setPlaying(state.playing);
            setWaiting(state.waiting);
            updateProgress();
          },
          onError: (error) => fail(new Error(error)),
        });
        playbackRef.current = playback;
        videos.forEach((video, index) => {
          video.crossOrigin = 'anonymous';
          video.addEventListener('timeupdate', updateProgress);
          video.addEventListener('loadedmetadata', updateProgress);
          video.src = index ? secondSource : firstSource;
        });
        canvas.addEventListener('webglcontextlost', handleContextLost);
        window.addEventListener('resize', draw);
        integrityTimer = setInterval(async () => {
          if (checking || disposed || failed) return;
          checking = true;
          try {
            const response = await fetch(firstSource, {
              method: 'HEAD',
              cache: 'no-store',
              signal: abortChecks.signal,
            });
            if (!response.ok) throw new Error('The INSV sources are no longer available or have changed.');
          } catch (error) {
            if (!disposed) fail(new Error('The INSV sources are no longer available or have changed.'));
          } finally {
            checking = false;
          }
        }, 5000);
      };
      const loadCorrection = async () => {
        try {
          const response = await fetch(new URL('./orientation', firstSource), {
            signal: abortChecks.signal,
            cache: 'no-store',
          });
          if (!response.ok) throw new Error((await response.text()) || 'INSV motion correction is unavailable.');
          const frames = await response.json();
          if (
            !Array.isArray(frames) ||
            (motionMode !== 'none' && !frames.length) ||
            frames.some(
              (frame, index) =>
                !Number.isFinite(frame.time) ||
                (index && frame.time <= frames[index - 1].time) ||
                !Array.isArray(frame.rotation) ||
                frame.rotation.length !== 4 ||
                frame.rotation.some((value) => !Number.isFinite(value)) ||
                Math.abs(Math.hypot(...frame.rotation) - 1) > 0.001
            )
          )
            throw new Error('The INSV motion correction data is invalid.');
          if (disposed) return;
          horizonRef.current = frames;
          startPlayback();
          if (failed) return;
          correctionReadyRef.current = true;
          setCorrectionLoading(false);
        } catch (error) {
          if (!disposed) {
            setCorrectionLoading(false);
            fail(error);
          }
        }
      };
      void loadCorrection();
    } catch (error) {
      fail(error);
    }

    return () => {
      disposed = true;
      correctionReadyRef.current = false;
      captureReadyRef.current = false;
      onCaptureReadyChange?.(false);
      clearInterval(integrityTimer);
      abortChecks.abort();
      if (playbackRef.current === playback) playbackRef.current = null;
      drawRef.current = () => {};
      playback?.destroy();
      videos.forEach((video) => {
        video.removeEventListener('timeupdate', updateProgress);
        video.removeEventListener('loadedmetadata', updateProgress);
      });
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      window.removeEventListener('resize', draw);
      textures.forEach((texture) => gl.deleteTexture(texture));
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    };
  }, [firstSource, secondSource, motionMode, onCaptureReadyChange]);

  const handlePointerMove = (event) => {
    const drag = camera.current.drag;
    if (!drag || flatProjection) return;
    camera.current.yaw -= (event.clientX - drag.x) * 0.005;
    camera.current.pitch = Math.max(-1.5, Math.min(1.5, camera.current.pitch - (event.clientY - drag.y) * 0.005));
    camera.current.drag = { x: event.clientX, y: event.clientY };
    drawRef.current();
  };

  return (
    <div className={`panorama-viewer${flatProjection ? ' flat-projection' : ''}`}>
      <video ref={firstRef} className="panorama-source" playsInline />
      <video ref={secondRef} className="panorama-source" playsInline muted />
      {message && (
        <p className="panorama-message" role="alert">
          {message}
        </p>
      )}
      {!message && (correctionLoading || waiting) && (
        <p className="panorama-message" role="status">
          {correctionLoading ? 'Loading prepared stabilization…' : 'Synchronizing both lenses…'}
        </p>
      )}
      <canvas
        ref={canvasRef}
        className="panorama-canvas"
        aria-label="360° view of INSV video"
        onPointerDown={(event) => {
          if (flatProjection) return;
          camera.current.drag = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={() => {
          camera.current.drag = null;
        }}
        onPointerCancel={() => {
          camera.current.drag = null;
        }}
        onWheel={(event) => {
          camera.current.fov = Math.max(0.45, Math.min(1.9, camera.current.fov + event.deltaY * 0.001));
          drawRef.current();
        }}
      />
      <VideoControls
        isPlaying={playing}
        currentTime={Math.min(progress.time, progress.duration)}
        duration={progress.duration}
        volume={volume}
        disabled={Boolean(message) || correctionLoading}
        onPlayPause={() => (playing ? playbackRef.current?.pause() : void playbackRef.current?.play())}
        onSeek={(event) => void playbackRef.current?.seek(Number(event.target.value))}
        onVolumeChange={(event) => {
          const value = Number(event.target.value);
          setVolume(value);
          if (firstRef.current) firstRef.current.volume = value;
        }}
        onToggleFullscreen={onToggleFullscreen}
        isFullscreen={isFullscreen}
      />
      <p className="insv-notice" role="note">
        {motionWarning && (
          <>
            <strong>{motionWarning}</strong>
            <br />
          </>
        )}
        Approximate stitching and experimental motion correction: seams, parallax and residual motion may be visible.
        Export and deletion are unavailable for INSV pairs.
      </p>
    </div>
  );
});

export default InsvViewer;
