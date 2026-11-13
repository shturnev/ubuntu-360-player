import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import './PanoramaViewer.scss';

const vertexShaderSource = `
  attribute vec2 position;
  varying vec2 screenPosition;

  void main() {
    screenPosition = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  uniform sampler2D panorama;
  uniform float yaw;
  uniform float pitch;
  uniform float fieldOfView;
  uniform float aspectRatio;
  varying vec2 screenPosition;

  void main() {
    float scale = tan(fieldOfView * 0.5);
    vec3 direction = normalize(vec3(
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

    vec2 coordinates = vec2(
      0.5 + atan(direction.x, -direction.z) / 6.28318530718,
      0.5 + asin(clamp(direction.y, -1.0, 1.0)) / 3.14159265359
    );
    gl_FragColor = texture2D(panorama, coordinates);
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create panorama shader');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unable to compile panorama shader';
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createProgram(gl) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create panorama renderer');

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unable to link panorama renderer';
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

const VIDEO_CODEC_GUIDANCE =
  'Check the file codecs with: ffprobe -v error -show_entries stream=codec_type,codec_name -of default=noprint_wrappers=1 input.mp4. On Ubuntu, try sudo apt install ubuntu-restricted-extras and restart the app. Electron may use its own codecs; if it still fails, convert to H.264/AVC + AAC: ffmpeg -i input.mp4 -c:v libx264 -pix_fmt yuv420p -c:a aac output.mp4.';

function PlayIcon({ isPlaying }) {
  return isPlaying ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4v16l13-8z" />
    </svg>
  );
}

function VolumeIcon({ volume }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 9v6h4l5 4V5L7 9H3zm12.5 3a3.5 3.5 0 0 0-2-3.16v6.31a3.5 3.5 0 0 0 2-3.15z" />
      {volume > 0 && <path d="M14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z" />}
      {volume === 0 && (
        <path d="m16 9-1.41-1.41L12 10.17l-2.59-2.58L8 9l2.59 3L8 15l1.41 1.41L12 13.83l2.59 2.58L16 15l-2.59-3z" />
      )}
    </svg>
  );
}

function getVideoFailureMessage(video, playbackError, noVideoFrame = false) {
  const mediaError = video.error;
  const mediaCode = mediaError && mediaError.code;
  const detail = (mediaError && mediaError.message) || (playbackError && playbackError.message);

  if (noVideoFrame) {
    return `Video playback started but no video frame was decoded. Audio may work even when the video codec is unsupported.\n\n${VIDEO_CODEC_GUIDANCE}${detail ? `\n\nBrowser detail: ${detail}` : ''}`;
  }

  if (mediaCode === 3 || mediaCode === 4 || (playbackError && playbackError.name === 'NotSupportedError')) {
    const reason =
      mediaCode === 3
        ? 'The video decoder could not decode this file.'
        : "This Electron/Chromium build does not support one of this MP4's codecs.";
    return `${reason} ${VIDEO_CODEC_GUIDANCE}${detail ? ` Browser detail: ${detail}` : ''}`;
  }

  if (mediaCode === 2) {
    return `The video could not be loaded from the local media server. Check that the file is still available.${detail ? ` Browser detail: ${detail}` : ''}`;
  }

  if (playbackError && playbackError.name === 'NotAllowedError') {
    return 'Playback was blocked by the browser. Press Play video to try again.';
  }

  return `Unable to play this video.${detail ? ` Browser detail: ${detail}` : ''}`;
}

function formatTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0:00';
  }

  const total = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const PanoramaViewer = forwardRef(function PanoramaViewer(
  {
    source,
    type,
    alt,
    onOpenExternal,
    showConvertVideo,
    onConvertVideo,
    onVideoPlaybackFailure,
    onVideoPlaybackSuccess,
    onToggleFullscreen,
    isFullscreen,
  },
  ref
) {
  const canvasRef = useRef(null);
  const mediaRef = useRef(null);
  const fallbackVideoRef = useRef(null);
  const camera = useRef({ yaw: 0, pitch: 0, fieldOfView: 1.2, drag: null });
  const renderRequest = useRef(() => {});
  const playbackGeneration = useRef(0);
  const onVideoPlaybackFailureRef = useRef(onVideoPlaybackFailure);
  const onVideoPlaybackSuccessRef = useRef(onVideoPlaybackSuccess);
  const fallbackVideoFrameTimer = useRef(null);
  const fallbackVideoHasFrame = useRef(false);
  const [fallbackMessage, setFallbackMessage] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoProgress, setVideoProgress] = useState({ duration: 0, currentTime: 0, volume: 1 });

  useImperativeHandle(ref, () => ({
    pause() {
      const video = [mediaRef.current, fallbackVideoRef.current].find((candidate) => candidate && !candidate.paused);
      if (video) {
        playbackGeneration.current += 1;
        video.pause();
      }
    },
  }));

  useEffect(() => {
    playbackGeneration.current += 1;
    setFallbackMessage('');
    setIsPlaying(false);
    setVideoReady(false);
    setVideoProgress({ duration: 0, currentTime: 0, volume: 1 });
    camera.current = { yaw: 0, pitch: 0, fieldOfView: 1.2, drag: null };

    return () => {
      playbackGeneration.current += 1;
    };
  }, [source, type]);

  onVideoPlaybackFailureRef.current = onVideoPlaybackFailure;
  onVideoPlaybackSuccessRef.current = onVideoPlaybackSuccess;

  useEffect(() => {
    fallbackVideoHasFrame.current = false;
    clearTimeout(fallbackVideoFrameTimer.current);
    fallbackVideoFrameTimer.current = null;

    return () => {
      clearTimeout(fallbackVideoFrameTimer.current);
      fallbackVideoFrameTimer.current = null;
    };
  }, [source, type]);

  useEffect(() => {
    const video = mediaRef.current;
    if (!video || type !== 'video') return undefined;

    const syncVideoState = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const volume = Number.isFinite(video.volume) ? video.volume : 1;
      setVideoProgress((current) =>
        current.duration === duration && current.currentTime === currentTime && current.volume === volume
          ? current
          : { duration, currentTime, volume }
      );
    };

    video.addEventListener('loadedmetadata', syncVideoState);
    video.addEventListener('timeupdate', syncVideoState);
    video.addEventListener('volumechange', syncVideoState);
    syncVideoState();

    return () => {
      video.removeEventListener('loadedmetadata', syncVideoState);
      video.removeEventListener('timeupdate', syncVideoState);
      video.removeEventListener('volumechange', syncVideoState);
    };
  }, [source, type]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const media = mediaRef.current;
    if (!canvas || !media) return undefined;

    const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
    if (!gl) {
      setFallbackMessage('360° viewing is unavailable; showing the media flat.');
      return undefined;
    }

    let program;
    let texture;
    let buffer;
    let animationFrame = null;
    let renderQueued = false;
    let failed = false;
    let disposed = false;
    let hasVideoFrame = false;
    let hasImageFrame = false;
    let render = () => {};
    let noFrameTimer;
    let resizeObserver;
    let handleResize;
    const needsImageUpload = { current: true };

    const setFailed = (message) => {
      if (disposed) return;
      failed = true;
      setFallbackMessage(message);
    };

    const requestRender = () => {
      if (failed || disposed) return;

      if (type === 'video') {
        if (animationFrame === null) {
          animationFrame = window.requestAnimationFrame(render);
        }
        return;
      }

      if (renderQueued) return;
      renderQueued = true;
      animationFrame = window.requestAnimationFrame(() => {
        renderQueued = false;
        render();
      });
    };

    const scheduleImageUpload = () => {
      needsImageUpload.current = true;
      requestRender();
    };

    const handleImageLoad = () => {
      hasImageFrame = true;
      scheduleImageUpload();
    };

    try {
      program = createProgram(gl);
      texture = gl.createTexture();
      if (!texture) throw new Error('Unable to create panorama texture');

      gl.useProgram(program);
      const position = gl.getAttribLocation(program, 'position');
      buffer = gl.createBuffer();
      if (!buffer) throw new Error('Unable to create panorama geometry');

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gl.uniform1i(gl.getUniformLocation(program, 'panorama'), 0);

      const uploadMedia = () => {
        if (failed) return;

        try {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          if (type === 'video') {
            if (media.readyState < 2 || media.videoWidth <= 0 || media.videoHeight <= 0) {
              return;
            }
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
            hasVideoFrame = true;
            clearTimeout(noFrameTimer);
            setVideoReady(true);
            return;
          }

          if (!media) return;
          if (!hasImageFrame) return;
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
          needsImageUpload.current = false;
        } catch (error) {
          setFailed(
            `360° viewing failed: ${error && error.message ? error.message : 'Unable to upload the media texture'}`
          );
        }
      };

      const resize = () => {
        const pixelRatio = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
        const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
      };

      render = () => {
        if (failed || disposed) return;

        resize();
        const { yaw, pitch, fieldOfView } = camera.current;
        gl.uniform1f(gl.getUniformLocation(program, 'yaw'), yaw);
        gl.uniform1f(gl.getUniformLocation(program, 'pitch'), pitch);
        gl.uniform1f(gl.getUniformLocation(program, 'fieldOfView'), fieldOfView);
        gl.uniform1f(gl.getUniformLocation(program, 'aspectRatio'), canvas.width / canvas.height);

        if (type === 'video') {
          if (media.readyState >= 2) {
            uploadMedia();
          }
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          animationFrame = window.requestAnimationFrame(render);
          return;
        }

        if (needsImageUpload.current) {
          uploadMedia();
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };

      const handleMediaError = () => {
        if (type === 'video') {
          onVideoPlaybackFailureRef.current?.();
          setFailed(`${getVideoFailureMessage(media)} Showing the flat video instead.`);
          return;
        }
        setFailed('Unable to load this image; showing it flat.');
      };

      const handlePause = () => {
        setIsPlaying(false);
        clearTimeout(noFrameTimer);
      };

      const handlePlaying = () => {
        setIsPlaying(true);
        if (type === 'video' && !hasVideoFrame && !noFrameTimer) {
          noFrameTimer = setTimeout(() => {
            onVideoPlaybackFailureRef.current?.();
            setFailed(`${getVideoFailureMessage(media, null, true)} Showing the flat video instead.`);
          }, 4000);
        }
      };

      if (type === 'video') {
        media.addEventListener('loadeddata', uploadMedia);
        media.addEventListener('canplay', uploadMedia);
        media.addEventListener('error', handleMediaError);
        media.addEventListener('playing', handlePlaying);
        media.addEventListener('pause', handlePause);
        media.addEventListener('ended', handlePause);
      } else {
        media.addEventListener('load', handleImageLoad);
        media.addEventListener('error', handleMediaError);
      }

      media.crossOrigin = 'anonymous';
      media.src = source;
      renderRequest.current = requestRender;
      if (type === 'video') {
        animationFrame = window.requestAnimationFrame(render);
      } else {
        scheduleImageUpload();
      }

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          requestRender();
        });
        resizeObserver.observe(canvas);
      }
      handleResize = () => requestRender();
      window.addEventListener('resize', handleResize);

      return () => {
        disposed = true;
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
        }
        if (type === 'video') {
          try {
            media.pause();
          } catch (error) {
            // Some environments do not implement native media pause behavior.
          }
          media.removeAttribute('src');
        }
        media.removeEventListener('load', handleImageLoad);
        media.removeEventListener('error', handleMediaError);
        media.removeEventListener('loadeddata', uploadMedia);
        media.removeEventListener('canplay', uploadMedia);
        media.removeEventListener('playing', handlePlaying);
        media.removeEventListener('pause', handlePause);
        media.removeEventListener('ended', handlePause);
        clearTimeout(noFrameTimer);
        if (resizeObserver) resizeObserver.disconnect();
        if (handleResize) window.removeEventListener('resize', handleResize);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        if (texture) gl.deleteTexture(texture);
      };
    } catch (error) {
      setFailed(
        `360° viewing failed: ${error && error.message ? error.message : 'Unable to initialize the 360° viewer'}`
      );
      return () => {
        disposed = true;
        if (type === 'video') {
          try {
            media.pause();
          } catch (error) {
            // Some environments do not implement native media pause behavior.
          }
          media.removeAttribute('src');
        }
        if (resizeObserver) resizeObserver.disconnect();
        if (handleResize) window.removeEventListener('resize', handleResize);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        if (texture) gl.deleteTexture(texture);
      };
    }
  }, [source, type]);

  const startOrPauseVideo = () => {
    const video = mediaRef.current;
    if (!video) return;

    if (video.paused) {
      const generation = playbackGeneration.current;
      video
        .play()
        .then(() => {
          if (generation !== playbackGeneration.current) return;
          setIsPlaying(true);
          onVideoPlaybackSuccessRef.current?.();
        })
        .catch((error) => {
          if (generation !== playbackGeneration.current) return;
          onVideoPlaybackFailureRef.current?.();
          setFallbackMessage(`${getVideoFailureMessage(video, error)} Showing the flat video instead.`);
        });
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handlePointerDown = (event) => {
    camera.current.drag = { x: event.clientX, y: event.clientY };
    renderRequest.current();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    const drag = camera.current.drag;
    if (!drag) return;

    camera.current.yaw -= (event.clientX - drag.x) * 0.005;
    camera.current.pitch = Math.max(-1.5, Math.min(1.5, camera.current.pitch - (event.clientY - drag.y) * 0.005));
    camera.current.drag = { x: event.clientX, y: event.clientY };
    renderRequest.current();
  };

  const handleSeek = (event) => {
    const video = mediaRef.current;
    if (!video) return;

    const nextTime = Number(event.target.value) || 0;
    video.currentTime = nextTime;
    setVideoProgress((current) => ({ ...current, currentTime: nextTime }));
  };

  const handleVolumeChange = (event) => {
    const video = mediaRef.current;
    if (!video) return;

    const nextVolume = Number(event.target.value) || 0;
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
    setVideoProgress((current) => ({ ...current, volume: nextVolume }));
  };

  const handleFallbackVideoLoadedData = () => {
    fallbackVideoHasFrame.current = true;
    clearTimeout(fallbackVideoFrameTimer.current);
  };

  const handleFallbackVideoPlaying = (event) => {
    if (fallbackVideoHasFrame.current || fallbackVideoFrameTimer.current) return;

    const video = event.currentTarget;
    fallbackVideoFrameTimer.current = setTimeout(() => {
      fallbackVideoFrameTimer.current = null;
      if (fallbackVideoHasFrame.current) return;

      onVideoPlaybackFailureRef.current?.();
      setFallbackMessage(`${getVideoFailureMessage(video, null, true)} Showing the flat video instead.`);
    }, 4000);
  };

  const handleFallbackVideoPause = () => {
    clearTimeout(fallbackVideoFrameTimer.current);
    fallbackVideoFrameTimer.current = null;
  };

  const handleWheel = (event) => {
    camera.current.fieldOfView = Math.max(0.45, Math.min(1.9, camera.current.fieldOfView + event.deltaY * 0.001));
    renderRequest.current();
  };

  if (fallbackMessage) {
    return (
      <div className="panorama-fallback">
        <div className="error-block">
          <p role="status">{fallbackMessage}</p>
          {type === 'video' && (
            <div className="error-block-actions">
              {showConvertVideo && (
                <button type="button" className="primary-button" onClick={onConvertVideo}>
                  Convert / fix video
                </button>
              )}
              {onOpenExternal && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onOpenExternal('https://ffmpeg.org/download.html')}
                >
                  FFmpeg downloads and documentation
                </button>
              )}
            </div>
          )}
        </div>
        {type === 'video' ? (
          <video
            ref={fallbackVideoRef}
            controls
            autoPlay
            crossOrigin="anonymous"
            src={source}
            onLoadedData={handleFallbackVideoLoadedData}
            onPlaying={handleFallbackVideoPlaying}
            onPause={handleFallbackVideoPause}
            onEnded={handleFallbackVideoPause}
            onError={() => {
              handleFallbackVideoPause();
              onVideoPlaybackFailureRef.current?.();
            }}
          />
        ) : (
          <img src={source} alt={alt} />
        )}
      </div>
    );
  }

  return (
    <div className="panorama-viewer">
      {type === 'video' && <video ref={mediaRef} className="panorama-source" playsInline />}
      {type !== 'video' && <img ref={mediaRef} className="panorama-source" alt="" />}
      {type === 'video' && !videoReady && (
        <p className="panorama-message" role="status">
          {isPlaying ? 'Starting video; waiting for its first frame…' : 'Press Play video to start 360° playback.'}
        </p>
      )}
      <canvas
        ref={canvasRef}
        aria-label={`360° view of ${alt}`}
        className="panorama-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => {
          camera.current.drag = null;
        }}
        onPointerCancel={() => {
          camera.current.drag = null;
        }}
        onWheel={handleWheel}
      />
      {type === 'video' && (
        <div className="panorama-video-controls">
          <div className="panorama-video-toolbar">
            <button
              type="button"
              className="panorama-play"
              onClick={startOrPauseVideo}
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              <PlayIcon isPlaying={isPlaying} />
            </button>
            <span className="panorama-video-time" aria-live="polite">
              {formatTime(videoProgress.currentTime)} / {formatTime(videoProgress.duration)}
            </span>
            <span className="panorama-video-spacer" />
            <VolumeIcon volume={videoProgress.volume} />
            <input
              className="panorama-video-volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={videoProgress.volume}
              onChange={handleVolumeChange}
              aria-label="Adjust video volume"
            />
            <button
              type="button"
              className="panorama-fullscreen"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {isFullscreen ? (
                  <path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z" />
                ) : (
                  <path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v6h6v-2H6v-4zm10 4h4v-4h2v6h-6z" />
                )}
              </svg>
            </button>
          </div>
          <input
            className="panorama-video-seek"
            type="range"
            min="0"
            max={videoProgress.duration || 0}
            step="0.01"
            value={videoProgress.currentTime}
            onChange={handleSeek}
            aria-label="Seek video playback"
            style={{
              '--progress': `${videoProgress.duration ? (videoProgress.currentTime / videoProgress.duration) * 100 : 0}%`,
            }}
          />
        </div>
      )}
    </div>
  );
});

export default PanoramaViewer;
