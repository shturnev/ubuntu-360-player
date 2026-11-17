import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import VideoControls from './VideoControls.jsx';
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
  uniform float roll;
  uniform bool flatProjection;
  uniform float fieldOfView;
  uniform float aspectRatio;
  varying vec2 screenPosition;

  void main() {
    vec3 direction;
    if (flatProjection) {
      float longitude = (screenPosition.x - 0.5) * 6.28318530718;
      float latitude = (screenPosition.y - 0.5) * 3.14159265359;
      direction = vec3(
        sin(longitude) * cos(latitude),
        sin(latitude),
        -cos(longitude) * cos(latitude)
      );
    } else {
      float scale = tan(fieldOfView * 0.5);
      direction = normalize(vec3(
        (screenPosition.x * 2.0 - 1.0) * scale * aspectRatio,
        (screenPosition.y * 2.0 - 1.0) * scale,
        -1.0
      ));
    }

    float pitchCos = cos(pitch);
    float pitchSin = sin(pitch);
    direction.yz = mat2(pitchCos, -pitchSin, pitchSin, pitchCos) * direction.yz;

    float yawCos = cos(yaw);
    float yawSin = sin(yaw);
    direction.xz = mat2(yawCos, yawSin, -yawSin, yawCos) * direction.xz;

    float rollCos = cos(roll);
    float rollSin = sin(roll);
    direction.xy = mat2(rollCos, -rollSin, rollSin, rollCos) * direction.xy;

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

const DEFAULT_ORIENTATION = { yaw: 0, pitch: 0, roll: 0 };
const degreesToRadians = (degrees) => (degrees * Math.PI) / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
    onCaptureReadyChange,
    orientation = DEFAULT_ORIENTATION,
    flatProjection = false,
    isOrientationEditing = false,
    onOrientationChange,
    showAlignmentGuides = false,
  },
  ref
) {
  const canvasRef = useRef(null);
  const mediaRef = useRef(null);
  const fallbackVideoRef = useRef(null);
  const camera = useRef({ yaw: 0, pitch: 0, fieldOfView: 1.2, drag: null });
  const renderRequest = useRef(() => {});
  const captureFrame = useRef(null);
  const captureReady = useRef(false);
  const playbackGeneration = useRef(0);
  const onVideoPlaybackFailureRef = useRef(onVideoPlaybackFailure);
  const onVideoPlaybackSuccessRef = useRef(onVideoPlaybackSuccess);
  const fallbackVideoFrameTimer = useRef(null);
  const fallbackVideoHasFrame = useRef(false);
  const orientationRef = useRef(orientation);
  const orientationEditingRef = useRef(isOrientationEditing);
  const onOrientationChangeRef = useRef(onOrientationChange);
  const [fallbackMessage, setFallbackMessage] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoProgress, setVideoProgress] = useState({ duration: 0, currentTime: 0, volume: 1 });

  useEffect(() => {
    orientationRef.current = orientation;
    renderRequest.current();
  }, [orientation.pitch, orientation.roll, orientation.yaw]);

  useEffect(() => {
    orientationEditingRef.current = isOrientationEditing;
    onOrientationChangeRef.current = onOrientationChange;
  }, [isOrientationEditing, onOrientationChange]);

  const setCaptureReady = (ready) => {
    if (captureReady.current === ready) return;
    captureReady.current = ready;
    onCaptureReadyChange?.(ready);
  };

  const startOrPauseVideo = () => {
    const video = mediaRef.current || fallbackVideoRef.current;
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

  useImperativeHandle(ref, () => ({
    togglePlayback: startOrPauseVideo,
    pause() {
      const video = [mediaRef.current, fallbackVideoRef.current].find((candidate) => candidate && !candidate.paused);
      if (video) {
        playbackGeneration.current += 1;
        video.pause();
      }
    },
    async captureScreenshot() {
      const canvas = canvasRef.current;
      if (!captureReady.current || !canvas || !captureFrame.current) {
        throw new Error('The 360° view is not ready to save.');
      }

      try {
        captureFrame.current();
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.92);
        });
        if (!blob) throw new Error('Unable to encode the 360° view.');
        return blob;
      } catch (error) {
        throw new Error('Unable to capture the current 360° view.');
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
    setCaptureReady(false);

    return () => {
      playbackGeneration.current += 1;
      captureFrame.current = null;
      setCaptureReady(false);
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

    const gl = canvas.getContext('webgl', { alpha: false, antialias: true, preserveDrawingBuffer: true });
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
      setCaptureReady(false);
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
      gl.uniform1i(gl.getUniformLocation(program, 'flatProjection'), flatProjection ? 1 : 0);

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
            setCaptureReady(true);
            clearTimeout(noFrameTimer);
            setVideoReady(true);
            return;
          }

          if (!media) return;
          if (!hasImageFrame) return;
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
          needsImageUpload.current = false;
          setCaptureReady(true);
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

      const drawFrame = () => {
        if (failed || disposed) return;

        resize();
        const { yaw, pitch, fieldOfView } = camera.current;
        const correction = orientationRef.current;
        const viewYaw = flatProjection ? 0 : yaw;
        const viewPitch = flatProjection ? 0 : pitch;
        gl.uniform1f(gl.getUniformLocation(program, 'yaw'), viewYaw + degreesToRadians(correction.yaw));
        gl.uniform1f(gl.getUniformLocation(program, 'pitch'), viewPitch + degreesToRadians(correction.pitch));
        gl.uniform1f(gl.getUniformLocation(program, 'roll'), degreesToRadians(correction.roll));
        gl.uniform1f(gl.getUniformLocation(program, 'fieldOfView'), fieldOfView);
        gl.uniform1f(gl.getUniformLocation(program, 'aspectRatio'), canvas.width / canvas.height);

        if (type === 'video' && media.readyState >= 2) {
          uploadMedia();
        }
        if (type !== 'video' && needsImageUpload.current) {
          uploadMedia();
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      render = () => {
        drawFrame();
        if (type === 'video' && !failed && !disposed) {
          animationFrame = window.requestAnimationFrame(render);
        }
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
      captureFrame.current = () => {
        drawFrame();
        gl.finish?.();
      };
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
        captureFrame.current = null;
        setCaptureReady(false);
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
        captureFrame.current = null;
        setCaptureReady(false);
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
  }, [flatProjection, source, type]);

  const handlePointerDown = (event) => {
    if (flatProjection && !orientationEditingRef.current) return;

    camera.current.drag = { x: event.clientX, y: event.clientY };
    renderRequest.current();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    const drag = camera.current.drag;
    if (!drag) return;

    const clientX = Number.isFinite(event.clientX) ? event.clientX : drag.x;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : drag.y;
    const horizontalDelta = clientX - drag.x;
    const verticalDelta = clientY - drag.y;
    if (orientationEditingRef.current) {
      const current = orientationRef.current;
      const next = {
        ...current,
        yaw: clamp(current.yaw - horizontalDelta * 0.25, -180, 180),
        pitch: clamp(current.pitch - verticalDelta * 0.25, -90, 90),
      };
      orientationRef.current = next;
      onOrientationChangeRef.current?.(next);
    } else {
      camera.current.yaw -= horizontalDelta * 0.005;
      camera.current.pitch = Math.max(-1.5, Math.min(1.5, camera.current.pitch - verticalDelta * 0.005));
    }
    camera.current.drag = { x: clientX, y: clientY };
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
    <div className={`panorama-viewer${flatProjection ? ' flat-projection' : ''}`}>
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
      {flatProjection && showAlignmentGuides && (
        <div className="panorama-alignment-guides" aria-hidden="true">
          <span className="panorama-alignment-guide horizontal" />
          <span className="panorama-alignment-guide vertical" />
        </div>
      )}
      {type === 'video' && (
        <VideoControls
          isPlaying={isPlaying}
          currentTime={videoProgress.currentTime}
          duration={videoProgress.duration}
          volume={videoProgress.volume}
          onPlayPause={startOrPauseVideo}
          onSeek={handleSeek}
          onVolumeChange={handleVolumeChange}
          onToggleFullscreen={onToggleFullscreen}
          isFullscreen={isFullscreen}
        />
      )}
    </div>
  );
});

export default PanoramaViewer;
