import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PanoramaViewer from '../../src/components/PanoramaViewer.jsx';
import ViewerOverlay from '../../src/components/ViewerOverlay.jsx';

describe('PanoramaViewer', () => {
  const makeWebGL = () => {
    const gl = {
      createShader: jest.fn(() => ({})),
      shaderSource: jest.fn(),
      compileShader: jest.fn(),
      getShaderParameter: jest.fn(() => true),
      deleteShader: jest.fn(),
      createProgram: jest.fn(() => ({})),
      attachShader: jest.fn(),
      linkProgram: jest.fn(),
      getProgramParameter: jest.fn(() => true),
      deleteProgram: jest.fn(),
      getAttribLocation: jest.fn(() => 0),
      createBuffer: jest.fn(() => ({})),
      bindBuffer: jest.fn(),
      bufferData: jest.fn(),
      deleteBuffer: jest.fn(),
      enableVertexAttribArray: jest.fn(),
      vertexAttribPointer: jest.fn(),
      activeTexture: jest.fn(),
      bindTexture: jest.fn(),
      texParameteri: jest.fn(),
      pixelStorei: jest.fn(),
      texImage2D: jest.fn(),
      deleteTexture: jest.fn(),
      uniform1i: jest.fn(),
      getUniformLocation: jest.fn(
        (program, name) => ({ panorama: 1, yaw: 2, pitch: 3, fieldOfView: 4, aspectRatio: 5 })[name] ?? 1
      ),
      uniform1f: jest.fn(),
      viewport: jest.fn(),
      drawArrays: jest.fn(),
      createTexture: jest.fn(() => ({})),
      useProgram: jest.fn(),
      getShaderInfoLog: jest.fn(() => ''),
      getProgramInfoLog: jest.fn(() => ''),
    };

    HTMLCanvasElement.prototype.getContext = jest.fn(() => gl);
    window.requestAnimationFrame = jest.fn(() => 1);
    window.cancelAnimationFrame = jest.fn();

    return gl;
  };

  beforeEach(() => {
    makeWebGL();
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      value: jest.fn(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('uploads an image texture once the image finishes loading', () => {
    const gl = makeWebGL();
    const source = 'http://localhost:3000/big/photo-1000.jpg';
    const queuedRaf = [];
    window.requestAnimationFrame = jest.fn((callback) => {
      queuedRaf.push(callback);
      return queuedRaf.length;
    });

    render(<PanoramaViewer source={source} type="image" alt="photo-1000.jpg" />);

    const image = document.querySelector('.panorama-source');
    expect(image.crossOrigin).toBe('anonymous');
    expect(image).toHaveAttribute('src', source);
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    queuedRaf.splice(0).forEach((callback) => callback());
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);

    fireEvent.load(image);
    queuedRaf.splice(0).forEach((callback) => callback());

    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('reuses the still-image texture until interaction or resize forces a redraw', () => {
    const gl = makeWebGL();
    const queuedRaf = [];
    window.requestAnimationFrame = jest.fn((callback) => {
      queuedRaf.push(callback);
      return queuedRaf.length;
    });

    render(<PanoramaViewer source="http://localhost:3000/big/photo-1000.jpg" type="image" alt="photo-1000.jpg" />);

    const image = document.querySelector('.panorama-source');
    const canvas = document.querySelector('.panorama-canvas');
    fireEvent.load(image);
    queuedRaf.splice(0).forEach((callback) => callback());

    const initialTextureUploads = gl.texImage2D.mock.calls.length;
    expect(initialTextureUploads).toBeGreaterThan(1);

    act(() => {
      fireEvent.pointerDown(canvas, { clientX: 10, clientY: 12, pointerId: 1 });
      fireEvent.pointerMove(canvas, { clientX: 54, clientY: 32, pointerId: 1 });
      fireEvent.wheel(canvas, { deltaY: 30 });
      queuedRaf.splice(0).forEach((callback) => callback());
    });

    expect(gl.texImage2D).toHaveBeenCalledTimes(initialTextureUploads);
    expect(gl.drawArrays).toHaveBeenCalled();

    gl.drawArrays.mockClear();
    Object.defineProperty(canvas, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 700, configurable: true });
    fireEvent(window, new Event('resize'));
    queuedRaf.splice(0).forEach((callback) => callback());

    expect(gl.drawArrays).toHaveBeenCalled();
  });

  test('starts and pauses the panorama video after it is ready', async () => {
    const gl = makeWebGL();
    const source = 'http://localhost:3000/big/clip-1000.mp4';
    const onVideoPlaybackSuccess = jest.fn();

    render(
      <PanoramaViewer
        source={source}
        type="video"
        alt="clip-1000.mp4"
        onVideoPlaybackSuccess={onVideoPlaybackSuccess}
      />
    );

    const video = document.querySelector('.panorama-source');
    expect(video.crossOrigin).toBe('anonymous');
    Object.defineProperty(video, 'readyState', { value: 2, writable: true, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 960, configurable: true });
    Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true });
    video.play = jest.fn(() => Promise.resolve());
    video.pause = jest.fn();

    fireEvent(video, new Event('loadeddata'));
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
      await Promise.resolve();
    });

    expect(video.play).toHaveBeenCalledTimes(1);
    expect(onVideoPlaybackSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Pause video' })).toBeInTheDocument();
    expect(screen.queryByText('Press Play video to start 360° playback.')).not.toBeInTheDocument();
  });

  test('toggles flat video playback with Space without interfering with text inputs', async () => {
    render(
      <ViewerOverlay
        showingItem={{ type: 'video', bigName: 'clip.mp4' }}
        items={[{ type: 'video', bigName: 'clip.mp4' }]}
        viewerSrc="http://localhost:3000/big/clip.mp4"
        flatView
        conversionProgress={{ active: false }}
        hasConvertedVideo={false}
        hasPlaybackFailure={false}
      />
    );

    const video = document.querySelector('.viewer-panel video');
    Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true });
    video.play = jest.fn(() => Promise.resolve());
    video.pause = jest.fn();

    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: ' ' });
    expect(video.play).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(document, { key: ' ' });
      await Promise.resolve();
    });
    expect(video.play).toHaveBeenCalledTimes(1);

    Object.defineProperty(video, 'paused', { value: false, writable: true, configurable: true });
    fireEvent.keyDown(document, { key: ' ' });
    expect(video.pause).toHaveBeenCalledTimes(1);
    input.remove();
  });

  test('toggles 360° video playback with Space', async () => {
    render(
      <ViewerOverlay
        showingItem={{ type: 'video', bigName: 'clip.mp4' }}
        items={[{ type: 'video', bigName: 'clip.mp4' }]}
        viewerSrc="http://localhost:3000/big/clip.mp4"
        flatView={false}
        conversionProgress={{ active: false }}
        hasConvertedVideo={false}
        hasPlaybackFailure={false}
      />
    );

    const video = document.querySelector('.panorama-source');
    Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true });
    video.play = jest.fn(() => Promise.resolve());
    video.pause = jest.fn();

    await act(async () => {
      fireEvent.keyDown(document, { key: ' ' });
      await Promise.resolve();
    });
    expect(video.play).toHaveBeenCalledTimes(1);

    Object.defineProperty(video, 'paused', { value: false, writable: true, configurable: true });
    fireEvent.keyDown(document, { key: ' ' });
    expect(video.pause).toHaveBeenCalledTimes(1);
  });

  test('does not upload a video texture before a video frame is available', () => {
    const gl = makeWebGL();
    render(<PanoramaViewer source="http://localhost:3000/big/audio-only.mp4" type="video" alt="audio-only.mp4" />);

    const video = document.querySelector('.panorama-source');
    Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 0, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 0, configurable: true });

    fireEvent(video, new Event('loadeddata'));

    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
  });

  test('reports rejected play requests to the parent and shows the video fallback', async () => {
    const onVideoPlaybackFailure = jest.fn();
    render(
      <PanoramaViewer
        source="http://localhost:3000/big/broken-video.mp4"
        type="video"
        alt="broken-video.mp4"
        onVideoPlaybackFailure={onVideoPlaybackFailure}
      />
    );

    const video = document.querySelector('.panorama-source');
    Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true });
    video.play = jest.fn(() => Promise.reject(new Error('decode failed')));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
      await Promise.resolve();
    });

    expect(onVideoPlaybackFailure).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Unable to play this video');
  });

  test('ignores a pending play rejection after an intentional imperative pause', async () => {
    const ref = { current: null };
    const onVideoPlaybackFailure = jest.fn();
    let rejectPlay;
    render(
      <PanoramaViewer
        ref={ref}
        source="http://localhost:3000/big/clip.mp4"
        type="video"
        alt="clip.mp4"
        onVideoPlaybackFailure={onVideoPlaybackFailure}
      />
    );

    const video = document.querySelector('.panorama-source');
    Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true });
    video.play = jest.fn(
      () =>
        new Promise((resolve, reject) => {
          rejectPlay = reject;
        })
    );
    video.pause = jest.fn();

    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    Object.defineProperty(video, 'paused', { value: false, writable: true, configurable: true });
    ref.current.pause();

    await act(async () => {
      rejectPlay(new DOMException('Playback cancelled', 'AbortError'));
      await Promise.resolve();
    });

    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(onVideoPlaybackFailure).not.toHaveBeenCalled();
  });

  test('shows seeking and volume controls for 360° video playback', () => {
    const gl = makeWebGL();
    render(<PanoramaViewer source="http://localhost:3000/big/clip-1000.mp4" type="video" alt="clip-1000.mp4" />);

    const video = document.querySelector('.panorama-source');
    Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 960, configurable: true });
    Object.defineProperty(video, 'duration', { value: 123.5, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 12.75, writable: true, configurable: true });
    Object.defineProperty(video, 'volume', { value: 0.45, writable: true, configurable: true });
    Object.defineProperty(video, 'paused', { value: false, writable: true, configurable: true });
    fireEvent(video, new Event('loadedmetadata'));

    const seekControl = screen.getByLabelText('Seek video playback');
    const volumeControl = screen.getByLabelText('Adjust video volume');
    expect(seekControl).toHaveAttribute('max', '123.5');
    expect(volumeControl).toHaveValue('0.45');
    expect(screen.getByText('0:12 / 2:03')).toBeInTheDocument();

    fireEvent.change(seekControl, { target: { value: '75.5' } });
    expect(video.currentTime).toBe(75.5);

    fireEvent.change(volumeControl, { target: { value: '0' } });
    expect(video.volume).toBe(0);
    expect(video.muted).toBe(true);
  });

  test('toggles full screen mode from the video and viewer controls', async () => {
    const requestFullscreen = jest.fn();
    const exitFullscreen = jest.fn();
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { value: requestFullscreen, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreen, configurable: true });

    render(
      <ViewerOverlay
        showingItem={{ type: 'video', bigName: 'clip-1000.mp4', index: 0 }}
        items={[{ type: 'video', bigName: 'clip-1000.mp4', index: 0 }]}
        viewerSrc="http://localhost:3000/big/clip-1000.mp4"
        flatView={false}
        conversionProgress={{ active: false, percent: 0, elapsedMs: 0, etaMs: null, status: 'idle', message: '' }}
        hasConvertedVideo={false}
        hasPlaybackFailure={false}
        onConvertVideo={jest.fn()}
        onClose={jest.fn()}
        onToggleFlatView={jest.fn()}
        onDelete={jest.fn()}
        onPrevious={jest.fn()}
        onNext={jest.fn()}
        onOpenExternal={jest.fn()}
      />
    );

    const videoFullscreenButton = document.querySelector('.panorama-fullscreen');
    fireEvent.click(videoFullscreenButton);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    const panel = document.querySelector('.viewer-panel');
    Object.defineProperty(document, 'fullscreenElement', { value: panel, configurable: true, writable: true });
    fireEvent(document, new Event('fullscreenchange'));
    expect(videoFullscreenButton).toHaveAttribute('aria-label', 'Exit full screen');

    fireEvent.click(document.querySelector('.viewer-controls .fullscreen-button'));
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  test('reports a missing video frame even when playback starts', async () => {
    jest.useFakeTimers();
    render(
      <PanoramaViewer source="http://localhost:3000/big/audio-only-video.mp4" type="video" alt="audio-only-video.mp4" />
    );

    const video = document.querySelector('.panorama-source');
    Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 0, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 0, configurable: true });
    Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true });
    video.play = jest.fn(() => Promise.resolve());
    video.pause = jest.fn();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
      await Promise.resolve();
    });
    fireEvent(video, new Event('playing'));

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Video playback started but no video frame was decoded');
    expect(screen.getByRole('status')).toHaveTextContent('ffprobe -v error');
    expect(screen.getByRole('status')).toHaveTextContent('ubuntu-restricted-extras');
    expect(screen.queryByRole('button', { name: 'Convert / fix video' })).not.toBeInTheDocument();
  });

  test('reports native video errors to the parent after the video is opened', () => {
    const onVideoPlaybackFailure = jest.fn();
    render(
      <PanoramaViewer
        source="http://localhost:3000/big/missing-video.mp4"
        type="video"
        alt="missing-video.mp4"
        onVideoPlaybackFailure={onVideoPlaybackFailure}
      />
    );

    const video = document.querySelector('.panorama-source');
    Object.defineProperty(video, 'error', {
      value: { code: 2, message: 'MEDIA_ERR_NETWORK' },
      configurable: true,
    });
    fireEvent.error(video);

    expect(screen.getByRole('status')).toHaveTextContent('local media server');
    expect(onVideoPlaybackFailure).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Convert / fix video' })).not.toBeInTheDocument();
  });

  test('reports errors from the native fallback video to the parent', () => {
    const onVideoPlaybackFailure = jest.fn();
    render(
      <PanoramaViewer
        source="http://localhost:3000/big/missing-video.mp4"
        type="video"
        alt="missing-video.mp4"
        onVideoPlaybackFailure={onVideoPlaybackFailure}
      />
    );

    const sourceVideo = document.querySelector('.panorama-source');
    Object.defineProperty(sourceVideo, 'error', {
      value: { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' },
      configurable: true,
    });
    fireEvent.error(sourceVideo);
    onVideoPlaybackFailure.mockClear();

    fireEvent.error(document.querySelector('.panorama-fallback video'));

    expect(onVideoPlaybackFailure).toHaveBeenCalledTimes(1);
  });

  test('reports a fallback video that starts without producing a frame', () => {
    jest.useFakeTimers();
    const onVideoPlaybackFailure = jest.fn();
    render(
      <PanoramaViewer
        source="http://localhost:3000/big/audio-only.mp4"
        type="video"
        alt="audio-only.mp4"
        onVideoPlaybackFailure={onVideoPlaybackFailure}
      />
    );

    const sourceVideo = document.querySelector('.panorama-source');
    Object.defineProperty(sourceVideo, 'error', {
      value: { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' },
      configurable: true,
    });
    fireEvent.error(sourceVideo);
    onVideoPlaybackFailure.mockClear();

    fireEvent.playing(document.querySelector('.panorama-fallback video'));
    act(() => jest.advanceTimersByTime(4000));

    expect(onVideoPlaybackFailure).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('no video frame was decoded');
  });

  test('shows a single conversion progress summary during transcoding', () => {
    render(
      <ViewerOverlay
        showingItem={{ type: 'video', bigName: 'hevc-video.mp4', origPath: '/tmp/hevc-video.mp4', index: 0 }}
        items={[{ type: 'video', bigName: 'hevc-video.mp4', origPath: '/tmp/hevc-video.mp4', index: 0 }]}
        viewerSrc="http://localhost:3000/big/hevc-video.mp4"
        flatView={false}
        conversionProgress={{
          active: true,
          percent: 42,
          elapsedMs: 1234,
          etaMs: 567,
          status: 'running',
          message: 'Converting video…',
        }}
        hasConvertedVideo={false}
        hasPlaybackFailure
        onConvertVideo={jest.fn()}
        onClose={jest.fn()}
        onToggleFlatView={jest.fn()}
        onDelete={jest.fn()}
        onPrevious={jest.fn()}
        onNext={jest.fn()}
        onOpenExternal={jest.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Convert / fix video' })).not.toBeInTheDocument();
    const conversionStatus = screen
      .getAllByRole('status')
      .find((node) => node.textContent.includes('Converting video…'));
    expect(conversionStatus).toHaveTextContent('Converting video…');
    expect(conversionStatus).toHaveTextContent('42%');
    expect(conversionStatus).toHaveTextContent('elapsed');
    expect(conversionStatus).toHaveTextContent('ETA');
  });

  test('explains unsupported video codecs and offers the FFmpeg help page', () => {
    const onOpenExternal = jest.fn();
    render(
      <PanoramaViewer
        source="http://localhost:3000/big/unsupported-1000.mp4"
        type="video"
        alt="unsupported-1000.mp4"
        onOpenExternal={onOpenExternal}
      />
    );

    const video = document.querySelector('.panorama-source');
    video.pause = jest.fn();
    Object.defineProperty(video, 'error', {
      value: { code: 4, message: 'DEMUXER_ERROR_NO_SUPPORTED_STREAMS' },
      configurable: true,
    });
    fireEvent.error(video);

    expect(screen.getByRole('status')).toHaveTextContent("does not support one of this MP4's codecs");
    expect(screen.getByRole('status')).toHaveTextContent('ubuntu-restricted-extras');
    expect(screen.getByRole('status')).toHaveTextContent('-c:v libx264');
    fireEvent.click(screen.getByRole('button', { name: 'FFmpeg downloads and documentation' }));
    expect(onOpenExternal).toHaveBeenCalledWith('https://ffmpeg.org/download.html');
  });

  test('falls back to a flat preview when the 360° media fails to decode', () => {
    const source = 'http://localhost:3000/big/broken-1000.jpg';

    render(<PanoramaViewer source={source} type="image" alt="broken-1000.jpg" />);

    const image = document.querySelector('.panorama-source');
    fireEvent.error(image);

    expect(screen.getByRole('status')).toHaveTextContent('Unable to load this image; showing it flat.');
    expect(screen.getByRole('img', { name: 'broken-1000.jpg' })).toHaveAttribute('src', source);
  });

  test('captures only the active 360° canvas as a JPEG through its ref', async () => {
    const ref = { current: null };
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    window.requestAnimationFrame = jest.fn((callback) => {
      callback();
      return 1;
    });
    HTMLCanvasElement.prototype.toBlob = jest.fn((callback, type, quality) => callback(blob));

    render(
      <PanoramaViewer ref={ref} source="http://localhost:3000/big/photo-1000.jpg" type="image" alt="photo-1000.jpg" />
    );
    fireEvent.load(document.querySelector('.panorama-source'));

    await expect(ref.current.captureScreenshot()).resolves.toBe(blob);

    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
  });

  test('captures a decoded video frame without pausing playback', async () => {
    const ref = { current: null };
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    HTMLCanvasElement.prototype.toBlob = jest.fn((callback) => callback(blob));

    render(
      <PanoramaViewer ref={ref} source="http://localhost:3000/big/clip-1000.mp4" type="video" alt="clip-1000.mp4" />
    );
    const video = document.querySelector('.panorama-source');
    Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 960, configurable: true });
    video.pause = jest.fn();
    await act(async () => {
      fireEvent.loadedData(video);
      await expect(ref.current.captureScreenshot()).resolves.toBe(blob);
    });

    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
    expect(video.pause).not.toHaveBeenCalled();
  });

  test('does not expose screenshot capture when the panorama falls back', () => {
    const onCaptureReadyChange = jest.fn();
    render(
      <PanoramaViewer
        source="http://localhost:3000/big/broken-1000.jpg"
        type="image"
        alt="broken-1000.jpg"
        onCaptureReadyChange={onCaptureReadyChange}
      />
    );

    fireEvent.error(document.querySelector('.panorama-source'));

    expect(onCaptureReadyChange).not.toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: 'Save screenshot' })).not.toBeInTheDocument();
  });
});
