import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import InsvViewer from '../../src/components/InsvViewer.jsx';
import ViewerOverlay from '../../src/components/ViewerOverlay.jsx';
import { createInsvPlayback } from '../../src/insvPlayback.js';

jest.mock('../../src/insvPlayback.js', () => ({ createInsvPlayback: jest.fn() }));

describe('INSV viewer', () => {
  let gl;
  let controller;
  let handlers;

  beforeEach(() => {
    gl = {
      TEXTURE0: 33984,
      NO_ERROR: 0,
      createShader: jest.fn(() => ({})),
      shaderSource: jest.fn(),
      compileShader: jest.fn(),
      getShaderParameter: jest.fn(() => true),
      getShaderInfoLog: jest.fn(),
      deleteShader: jest.fn(),
      createProgram: jest.fn(() => ({})),
      attachShader: jest.fn(),
      linkProgram: jest.fn(),
      getProgramParameter: jest.fn(() => true),
      getProgramInfoLog: jest.fn(),
      deleteProgram: jest.fn(),
      useProgram: jest.fn(),
      createBuffer: jest.fn(() => ({})),
      bindBuffer: jest.fn(),
      bufferData: jest.fn(),
      deleteBuffer: jest.fn(),
      getAttribLocation: jest.fn(() => 0),
      enableVertexAttribArray: jest.fn(),
      vertexAttribPointer: jest.fn(),
      createTexture: jest.fn(() => ({})),
      activeTexture: jest.fn(),
      bindTexture: jest.fn(),
      texParameteri: jest.fn(),
      getUniformLocation: jest.fn((_program, name) => name),
      uniform1i: jest.fn(),
      uniform1f: jest.fn(),
      uniform4f: jest.fn(),
      pixelStorei: jest.fn(),
      getParameter: jest.fn(() => 4096),
      getError: jest.fn(() => 0),
      texImage2D: jest.fn(),
      deleteTexture: jest.fn(),
      viewport: jest.fn(),
      drawArrays: jest.fn(),
    };
    HTMLCanvasElement.prototype.getContext = jest.fn(() => gl);
    controller = { play: jest.fn(), pause: jest.fn(), seek: jest.fn(), destroy: jest.fn() };
    createInsvPlayback.mockImplementation((options) => {
      handlers = options;
      return controller;
    });
  });

  afterEach(() => jest.clearAllMocks());

  test('uploads and renders both frames together and cleans up on unmount', () => {
    const { unmount } = render(<InsvViewer sources={['http://localhost/00', 'http://localhost/10']} />);
    const videos = document.querySelectorAll('video');
    videos.forEach((video) => {
      Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
      Object.defineProperty(video, 'videoWidth', { value: 2880, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 2880, configurable: true });
    });
    act(() => handlers.onFrame([1, 1]));
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    expect(gl.texImage2D.mock.calls.map((call) => call[5])).toEqual([...videos]);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    act(() => handlers.onFrame([1.03, 1]));
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    unmount();
    expect(controller.destroy).toHaveBeenCalled();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalled();
  });

  test('controls both streams through the playback controller', () => {
    render(<InsvViewer sources={['http://localhost/00', 'http://localhost/10']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(controller.play).toHaveBeenCalled();
    act(() => handlers.onState({ playing: true, waiting: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause video' }));
    expect(controller.pause).toHaveBeenCalled();
    act(() => handlers.onError('One lens failed.'));
    expect(screen.getByRole('alert')).toHaveTextContent('One lens failed.');
    expect(screen.getByRole('button', { name: 'Pause video' })).toBeDisabled();
  });

  test('enables and disables frame-specific horizon leveling', async () => {
    const originalFetch = global.fetch;
    const frames = [
      { time: 0, rotation: [0, 0, 0, 1] },
      { time: 1, rotation: [0, 0, 1, 0] },
    ];
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => frames });
    try {
      render(<InsvViewer sources={['http://localhost/insv/token/0', 'http://localhost/insv/token/1']} />);
      document.querySelectorAll('video').forEach((video) => {
        Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
        Object.defineProperty(video, 'videoWidth', { value: 2880, configurable: true });
        Object.defineProperty(video, 'videoHeight', { value: 2880, configurable: true });
      });
      act(() => handlers.onFrame([1, 1]));
      expect(gl.uniform4f).toHaveBeenLastCalledWith('horizonRotation', 0, 0, 0, 1);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Level horizon' })));
      expect(global.fetch.mock.calls[0][0].toString()).toBe('http://localhost/insv/token/orientation');
      expect(gl.uniform4f).toHaveBeenLastCalledWith('horizonRotation', 0, 0, 1, 0);
      fireEvent.click(screen.getByRole('button', { name: 'Level horizon' }));
      expect(gl.uniform4f).toHaveBeenLastCalledWith('horizonRotation', 0, 0, 0, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('reports unsupported horizon data without interrupting playback', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => 'Frame timestamps are unavailable.' });
    try {
      render(<InsvViewer sources={['http://localhost/insv/token/0', 'http://localhost/insv/token/1']} />);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Level horizon' })));
      expect(screen.getByRole('alert')).toHaveTextContent('Frame timestamps are unavailable.');
      expect(controller.pause).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('switches between horizon and gyro tracks without combining them', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url) => ({
      ok: true,
      json: async () => [{ time: 0, rotation: url.toString().includes('gyro') ? [0, 1, 0, 0] : [1, 0, 0, 0] }],
    }));
    try {
      render(<InsvViewer sources={['http://localhost/insv/token/0', 'http://localhost/insv/token/1']} />);
      document.querySelectorAll('video').forEach((video) => {
        Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
        Object.defineProperty(video, 'videoWidth', { value: 2880, configurable: true });
        Object.defineProperty(video, 'videoHeight', { value: 2880, configurable: true });
      });

      act(() => handlers.onFrame([0, 0]));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Level horizon' })));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stabilize motion' })));
      expect(gl.uniform4f).toHaveBeenLastCalledWith('horizonRotation', 0, 1, 0, 0);
      expect(screen.getByRole('button', { name: 'Level horizon' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Stabilize motion' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Level horizon' }));
      expect(gl.uniform4f).toHaveBeenLastCalledWith('horizonRotation', 1, 0, 0, 0);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('keeps horizon leveling active when gyro data is unavailable', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockImplementation(async (url) =>
        url.toString().includes('gyro')
          ? { ok: false, text: async () => 'Gyro timing is unavailable.' }
          : { ok: true, json: async () => [{ time: 0, rotation: [0, 0, 0, 1] }] }
      );
    try {
      render(<InsvViewer sources={['http://localhost/insv/token/0', 'http://localhost/insv/token/1']} />);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Level horizon' })));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stabilize motion' })));
      expect(screen.getByRole('alert')).toHaveTextContent('Gyro timing is unavailable.');
      expect(screen.getByRole('button', { name: 'Level horizon' })).toHaveAttribute('aria-pressed', 'true');
      expect(controller.pause).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('reports missing WebGL instead of showing one lens', () => {
    HTMLCanvasElement.prototype.getContext = jest.fn(() => null);
    render(<InsvViewer sources={['http://localhost/00', 'http://localhost/10']} />);
    expect(screen.getByRole('alert')).toHaveTextContent('WebGL is unavailable');
    expect(createInsvPlayback).not.toHaveBeenCalled();
  });

  test('stops playback when either original is no longer available', async () => {
    const originalFetch = global.fetch;
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    try {
      render(<InsvViewer sources={['http://localhost/00', 'http://localhost/10']} />);
      await act(async () => {
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
      });
      expect(screen.getByRole('alert')).toHaveTextContent('no longer available or have changed');
      expect(controller.pause).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      jest.useRealTimers();
    }
  });

  test('fails if the GPU cannot upload the pair', () => {
    gl.getError.mockReturnValue(1285);
    render(<InsvViewer sources={['http://localhost/00', 'http://localhost/10']} />);
    document.querySelectorAll('video').forEach((video) => {
      Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
      Object.defineProperty(video, 'videoWidth', { value: 2880, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 2880, configurable: true });
    });
    act(() => handlers.onFrame([1, 1]));
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to upload both');
    expect(gl.drawArrays).not.toHaveBeenCalled();
    expect(controller.pause).toHaveBeenCalled();
  });

  test('overlay uses both lenses even in flat mode and blocks unsupported pair actions', () => {
    const item = { type: 'video', insv: true, bigName: 'pair', origPath: '/video/00.insv' };
    const onDelete = jest.fn();
    const onOpenMetadata = jest.fn();
    render(
      <ViewerOverlay
        showingItem={item}
        items={[item]}
        insvSources={['http://localhost/00', 'http://localhost/10']}
        flatView
        onDelete={onDelete}
        onOpenMetadata={onOpenMetadata}
      />
    );
    expect(document.querySelectorAll('video')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Info' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Adjust panorama orientation' })).toBeDisabled();
    fireEvent.keyDown(document, { key: ' ' });
    expect(controller.play).toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'i' });
    expect(onDelete).not.toHaveBeenCalled();
    expect(onOpenMetadata).not.toHaveBeenCalled();
  });
});
