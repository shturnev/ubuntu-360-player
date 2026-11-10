import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PanoramaViewer from '../../src/components/PanoramaViewer.jsx';

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
      getUniformLocation: jest.fn(() => 1),
      uniform1f: jest.fn(),
      viewport: jest.fn(),
      drawArrays: jest.fn(),
      createTexture: jest.fn(() => ({})),
      useProgram: jest.fn(),
      getShaderInfoLog: jest.fn(() => ''),
      getProgramInfoLog: jest.fn(() => '')
    };

    HTMLCanvasElement.prototype.getContext = jest.fn(() => gl);
    window.requestAnimationFrame = jest.fn(() => 1);
    window.cancelAnimationFrame = jest.fn();

    return gl;
  };

  beforeEach(() => {
    makeWebGL();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('uploads an image texture once the image finishes loading', () => {
    const gl = makeWebGL();
    const source = 'http://localhost:3000/big/photo-1000.jpg';

    render(<PanoramaViewer source={source} type="image" alt="photo-1000.jpg" />);

    const image = document.querySelector('.panorama-source');
    expect(image.crossOrigin).toBe('anonymous');
    expect(image).toHaveAttribute('src', source);

    fireEvent.load(image);

    expect(gl.texImage2D).toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('starts and pauses the panorama video after it is ready', async () => {
    const gl = makeWebGL();
    const source = 'http://localhost:3000/big/clip-1000.mp4';

    render(<PanoramaViewer source={source} type="video" alt="clip-1000.mp4" />);

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
    expect(screen.getByRole('button', { name: 'Pause video' })).toBeInTheDocument();
    expect(screen.queryByText('Press Play video to start 360° playback.')).not.toBeInTheDocument();
  });

  test('reports a missing video frame even when playback starts', async () => {
    jest.useFakeTimers();
    render(<PanoramaViewer source="http://localhost:3000/big/audio-only-video.mp4" type="video" alt="audio-only-video.mp4" />);

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
      configurable: true
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
});
