import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InsvViewer from '../../src/components/InsvViewer.jsx';
import ViewerOverlay from '../../src/components/ViewerOverlay.jsx';
import { createInsvPlayback } from '../../src/insvPlayback.js';

jest.mock('../../src/insvPlayback.js', () => ({ createInsvPlayback: jest.fn() }));

describe('INSV viewer', () => {
  const originalFetch = global.fetch;
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
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ time: 0, rotation: [0, 0, 0, 1] }],
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('uploads and renders both frames together and cleans up on unmount', async () => {
    const sources = ['http://localhost/00', 'http://localhost/10'];
    const { unmount, rerender } = render(<InsvViewer sources={sources} frameRate={30} />);
    await waitFor(() => expect(createInsvPlayback).toHaveBeenCalled());
    expect(createInsvPlayback).toHaveBeenCalledWith(expect.objectContaining({ frameRate: 30 }));
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
    expect(gl.uniform1i).toHaveBeenCalledWith('flatProjection', 0);
    rerender(<InsvViewer sources={sources} frameRate={30} flatProjection />);
    expect(gl.uniform1i).toHaveBeenLastCalledWith('flatProjection', 1);
    rerender(<InsvViewer sources={sources} frameRate={30} />);
    expect(gl.uniform1i).toHaveBeenLastCalledWith('flatProjection', 0);
    act(() => handlers.onFrame([1.03, 1]));
    expect(gl.texImage2D).toHaveBeenCalledTimes(4);
    act(() => handlers.onFrame([1.03, 1.03]));
    expect(gl.texImage2D).toHaveBeenCalledTimes(6);
    act(() => handlers.onFrame([1.03, 1.03]));
    expect(gl.texImage2D).toHaveBeenCalledTimes(6);
    unmount();
    expect(controller.destroy).toHaveBeenCalled();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalled();
  });

  test('controls both streams through the playback controller', async () => {
    render(<InsvViewer sources={['http://localhost/00', 'http://localhost/10']} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play video' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(controller.play).toHaveBeenCalled();
    act(() => handlers.onState({ playing: true, waiting: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause video' }));
    expect(controller.pause).toHaveBeenCalled();
    act(() => handlers.onError('One lens failed.'));
    expect(screen.getByRole('alert')).toHaveTextContent('One lens failed.');
    expect(screen.getByRole('button', { name: 'Pause video' })).toBeDisabled();
  });

  test('loads and applies the prepared correction before rendering or enabling playback', async () => {
    const frames = [
      { time: 0, rotation: [0, 0, 0, 1] },
      { time: 1, rotation: [0, 0, 1, 0] },
    ];
    let resolve;
    global.fetch = jest.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    render(<InsvViewer sources={['http://localhost/insv/token/0', 'http://localhost/insv/token/1']} />);
    expect(screen.getByRole('button', { name: 'Play video' })).toBeDisabled();
    expect(createInsvPlayback).not.toHaveBeenCalled();
    await act(async () => resolve({ ok: true, json: async () => frames }));
    document.querySelectorAll('video').forEach((video) => {
      Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
      Object.defineProperty(video, 'videoWidth', { value: 2880, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 2880, configurable: true });
    });
    act(() => handlers.onFrame([1, 1]));
    expect(global.fetch.mock.calls[0][0].toString()).toBe('http://localhost/insv/token/orientation');
    expect(gl.uniform4f).toHaveBeenLastCalledWith('horizonRotation', 0, 0, 1, 0);
    expect(screen.queryByRole('button', { name: 'Level horizon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stabilize motion' })).not.toBeInTheDocument();
  });

  test('reports a prepared-track failure and prevents playback', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => 'Frame timestamps are unavailable.' });
    render(<InsvViewer sources={['http://localhost/insv/token/0', 'http://localhost/insv/token/1']} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Frame timestamps are unavailable.');
    expect(screen.getByRole('button', { name: 'Play video' })).toBeDisabled();
    expect(createInsvPlayback).not.toHaveBeenCalled();
  });

  test('accepts an explicitly uncorrected import and shows its warning', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => [] });
    render(
      <InsvViewer
        sources={['http://localhost/00', 'http://localhost/10']}
        motionMode="none"
        motionWarning="Not stabilized."
      />
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play video' })).toBeEnabled());
    expect(screen.getByRole('note')).toHaveTextContent('Not stabilized.');
  });

  test('aborts pending correction requests on unmount', () => {
    global.fetch.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<InsvViewer sources={['http://localhost/00', 'http://localhost/10']} />);
    const signal = global.fetch.mock.calls[0][1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  test('reports missing WebGL instead of showing one lens', () => {
    HTMLCanvasElement.prototype.getContext = jest.fn(() => null);
    render(<InsvViewer sources={['http://localhost/00', 'http://localhost/10']} />);
    expect(screen.getByRole('alert')).toHaveTextContent('WebGL is unavailable');
    expect(createInsvPlayback).not.toHaveBeenCalled();
  });

  test('stops playback when either original is no longer available', async () => {
    jest.useFakeTimers();
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => [{ time: 0, rotation: [0, 0, 0, 1] }] })
      .mockResolvedValue({ ok: false });
    try {
      render(<InsvViewer sources={['http://localhost/00', 'http://localhost/10']} />);
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
      });
      expect(screen.getByRole('alert')).toHaveTextContent('no longer available or have changed');
      expect(controller.pause).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('fails if the GPU cannot upload the pair', async () => {
    gl.getError.mockReturnValue(1285);
    render(<InsvViewer sources={['http://localhost/00', 'http://localhost/10']} />);
    await waitFor(() => expect(createInsvPlayback).toHaveBeenCalled());
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

  test('overlay uses both lenses in flat mode and blocks unsupported pair actions', async () => {
    const item = { type: 'video', insv: true, bigName: 'pair', origPath: '/video/00.insv', frameRate: 30 };
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
    expect(screen.getByRole('button', { name: 'Info' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Adjust panorama orientation' })).not.toBeInTheDocument();
    await waitFor(() => expect(createInsvPlayback).toHaveBeenCalled());
    expect(createInsvPlayback).toHaveBeenCalledWith(expect.objectContaining({ frameRate: 30 }));
    fireEvent.keyDown(document, { key: ' ' });
    expect(controller.play).toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'i' });
    expect(onDelete).not.toHaveBeenCalled();
    expect(onOpenMetadata).toHaveBeenCalledTimes(1);
    expect(controller.pause).toHaveBeenCalled();
  });

  test.each([false, true])(
    'saves a corrected INSV screenshot in flat view=%s after a frame is ready',
    async (flatView) => {
      const item = { type: 'video', insv: true, bigName: 'pair', origPath: '/video/00.insv' };
      const bytes = new Uint8Array([1, 2, 3]).buffer;
      const encode = jest
        .spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation((callback) => callback({ arrayBuffer: async () => bytes }));
      const onSaveScreenshot = jest.fn().mockResolvedValue({ success: true });
      try {
        render(
          <ViewerOverlay
            showingItem={item}
            items={[item]}
            insvSources={['http://localhost/00', 'http://localhost/10']}
            flatView={flatView}
            onSaveScreenshot={onSaveScreenshot}
          />
        );
        await waitFor(() => expect(createInsvPlayback).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: 'Save screenshot' })).not.toBeInTheDocument();
        document.querySelectorAll('video').forEach((video) => {
          Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
          Object.defineProperty(video, 'videoWidth', { value: 2880, configurable: true });
          Object.defineProperty(video, 'videoHeight', { value: 2880, configurable: true });
        });
        act(() => handlers.onFrame([1, 1]));
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save screenshot' })));
        expect(encode).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
        expect(onSaveScreenshot).toHaveBeenCalledWith(bytes);
        act(() => handlers.onError('Source changed.'));
        expect(screen.queryByRole('button', { name: 'Save screenshot' })).not.toBeInTheDocument();
      } finally {
        encode.mockRestore();
      }
    }
  );
});
