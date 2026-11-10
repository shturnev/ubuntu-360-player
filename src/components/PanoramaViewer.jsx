import { useEffect, useRef, useState } from 'react';
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

function PanoramaViewer({ source, type, alt }) {
  const canvasRef = useRef(null);
  const mediaRef = useRef(null);
  const camera = useRef({ yaw: 0, pitch: 0, fieldOfView: 1.2, drag: null });
  const [fallbackMessage, setFallbackMessage] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);

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
    let animationFrame;
    let failed = false;

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
        try {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
        } catch (error) {
          failed = true;
          setFallbackMessage(`360° viewing failed: ${error.message}`);
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

      const render = () => {
        if (failed) return;
        resize();
        const { yaw, pitch, fieldOfView } = camera.current;
        gl.uniform1f(gl.getUniformLocation(program, 'yaw'), yaw);
        gl.uniform1f(gl.getUniformLocation(program, 'pitch'), pitch);
        gl.uniform1f(gl.getUniformLocation(program, 'fieldOfView'), fieldOfView);
        gl.uniform1f(gl.getUniformLocation(program, 'aspectRatio'), canvas.width / canvas.height);

        if (type !== 'video' || media.readyState >= 2) uploadMedia();
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        animationFrame = window.requestAnimationFrame(render);
      };

      if (type === 'video') {
        media.addEventListener('loadeddata', uploadMedia);
      } else {
        media.onload = uploadMedia;
        media.onerror = () => setFallbackMessage('Unable to load this image; showing it flat.');
        media.src = source;
      }

      animationFrame = window.requestAnimationFrame(render);

      return () => {
        window.cancelAnimationFrame(animationFrame);
        if (type === 'video') media.pause();
        media.removeEventListener('loadeddata', uploadMedia);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        if (texture) gl.deleteTexture(texture);
      };
    } catch (error) {
      setFallbackMessage(`360° viewing failed: ${error.message}`);
      return () => {
        if (type === 'video') media.pause();
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
      video.play()
        .then(() => setIsPlaying(true))
        .catch((error) => setFallbackMessage(`Unable to play this video in 360°: ${error.message}`));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handlePointerDown = (event) => {
    camera.current.drag = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    const drag = camera.current.drag;
    if (!drag) return;

    camera.current.yaw -= (event.clientX - drag.x) * 0.005;
    camera.current.pitch = Math.max(-1.5, Math.min(1.5, camera.current.pitch + (event.clientY - drag.y) * 0.005));
    camera.current.drag = { x: event.clientX, y: event.clientY };
  };

  const handleWheel = (event) => {
    camera.current.fieldOfView = Math.max(0.45, Math.min(1.9, camera.current.fieldOfView + event.deltaY * 0.001));
  };

  if (fallbackMessage) {
    return (
      <div className="panorama-fallback">
        <p role="status">{fallbackMessage}</p>
        {type === 'video'
          ? <video controls autoPlay src={source} />
          : <img src={source} alt={alt} />}
      </div>
    );
  }

  return (
    <div className="panorama-viewer">
      {type === 'video' && (
        <video ref={mediaRef} className="panorama-source" src={source} playsInline />
      )}
      {type !== 'video' && <img ref={mediaRef} className="panorama-source" alt="" />}
      <canvas
        ref={canvasRef}
        aria-label={`360° view of ${alt}`}
        className="panorama-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => { camera.current.drag = null; }}
        onPointerCancel={() => { camera.current.drag = null; }}
        onWheel={handleWheel}
      />
      {type === 'video' && (
        <button type="button" className="panorama-play" onClick={startOrPauseVideo}>
          {isPlaying ? 'Pause video' : 'Play video'}
        </button>
      )}
    </div>
  );
}

export default PanoramaViewer;
