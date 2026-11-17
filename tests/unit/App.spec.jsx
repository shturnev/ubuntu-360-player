import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from '../../src/App.jsx';

let mockPanoramaPause;
let mockCaptureReady;

jest.mock('../../src/PanoramaViewer.jsx', () => {
  const React = require('react');
  return React.forwardRef(function PanoramaViewer(
    {
      source,
      type,
      showConvertVideo,
      onConvertVideo,
      onVideoPlaybackFailure,
      onVideoPlaybackSuccess,
      onCaptureReadyChange,
    },
    ref
  ) {
    const pauseRef = React.useRef();
    if (!pauseRef.current) {
      pauseRef.current = jest.fn();
    }
    mockPanoramaPause = pauseRef.current;
    React.useImperativeHandle(ref, () => ({
      pause: pauseRef.current,
      captureScreenshot: jest.fn(async () => ({
        arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
      })),
    }));
    React.useEffect(() => onCaptureReadyChange?.(mockCaptureReady), [onCaptureReadyChange]);
    return (
      <div data-testid="panorama-viewer" data-source={source} data-type={type}>
        {type === 'video' && (
          <>
            <button type="button" onClick={onVideoPlaybackFailure}>
              Simulate playback failure
            </button>
            <button type="button" onClick={onVideoPlaybackSuccess}>
              Simulate playback success
            </button>
            {showConvertVideo && (
              <button type="button" onClick={onConvertVideo}>
                Convert / fix video
              </button>
            )}
          </>
        )}
      </div>
    );
  });
});

describe('App', () => {
  let container;
  let root;
  let api;
  let listeners;
  let media;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mockCaptureReady = true;
    listeners = {};
    api = {
      send: jest.fn(),
      on: jest.fn((channel, listener) => {
        listeners[channel] = listener;
        return () => {
          if (listeners[channel] === listener) delete listeners[channel];
        };
      }),
      removeListener: jest.fn(),
      openExternal: jest.fn().mockResolvedValue(undefined),
      savePanoramaScreenshot: jest.fn().mockResolvedValue({ success: true }),
      saveCurrentMedia: jest.fn().mockResolvedValue({ success: true }),
      saveSelectedMedia: jest.fn().mockResolvedValue({ success: true, saved: 1, errors: [] }),
      saveOrientationCorrection: jest.fn().mockResolvedValue({ success: true }),
    };
    window.shtVR = api;
    media = { type: 'image', thumpName: 'photo.jpg', bigName: 'photo-1000.jpg', origPath: '/media/photo.jpg' };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.shtVR;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    jest.restoreAllMocks();
  });

  const renderApp = () => {
    act(() => root.render(<App />));
  };

  const click = (element) => {
    act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };

  const button = (name) =>
    [...container.querySelectorAll('button')].find(
      (element) => element.textContent.trim() === name || element.getAttribute('aria-label') === name
    );

  const loadMedia = () => {
    act(() => {
      listeners['start-file-server']({}, 'http://localhost:3000/');
      listeners['read-media-file']({}, media);
    });
  };

  const keydown = (key, options = {}, target = document) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    act(() => target.dispatchEvent(event));
    return event;
  };

  test('shows shortcut hints only in the empty library and keeps them in Settings', () => {
    renderApp();
    const emptyState = container.querySelector('.empty-state');
    const hints = container.querySelector('.home-shortcuts');
    expect(hints.parentElement).toBe(emptyState);
    const actions = hints.previousElementSibling;
    expect(actions.querySelectorAll('button')).toHaveLength(2);
    expect(actions.textContent).toContain('OR');
    expect(actions.contains(button('Import media folder'))).toBe(true);
    expect(actions.contains(button('Import media files'))).toBe(true);
    expect(hints.querySelectorAll('dl > div')).toHaveLength(9);
    expect(hints.textContent).toContain('Ctrl+Shift+O');

    loadMedia();
    expect(container.querySelector('.empty-state')).toBeNull();
    expect(container.querySelector('.home-shortcuts')).toBeNull();
    click(button('Open settings'));
    expect(container.querySelector('.shortcuts-box').textContent).toContain('Toggle orientation correction');
    click(button('Close settings'));
    act(() => listeners['delete-cache-finish']());
    expect(container.querySelector('.empty-state .home-shortcuts')).not.toBeNull();
  });

  test('hides empty-library shortcut hints while importing', () => {
    renderApp();
    act(() => listeners['start-read-dir']({}, 2));
    expect(container.querySelector('.home-shortcuts')).toBeNull();
  });

  test('opens the file picker from the empty state and re-enables both choices after cancellation', () => {
    renderApp();
    click(button('Import media files'));
    expect(api.send).toHaveBeenCalledWith('add-files', undefined);
    expect(button('Import media folder').disabled).toBe(true);
    expect(button('Import media files').disabled).toBe(true);
    act(() => listeners['add-files']({}, false));
    expect(button('Import media folder').disabled).toBe(false);
    expect(button('Import media files').disabled).toBe(false);
  });

  test('adds files without losing the existing viewer and selection, and unlocks after cancel or completion', () => {
    renderApp();
    loadMedia();
    click(button('Toggle selection'));
    click(container.querySelector('.media-card'));
    expect(container.querySelector('.media-card.selected')).not.toBeNull();
    click(button('Toggle selection'));
    click(container.querySelector('.media-card'));
    expect(container.querySelector('[data-testid="panorama-viewer"]')).not.toBeNull();
    click(button('Import files'));
    expect(api.send).toHaveBeenCalledWith('add-files', undefined);
    expect(button('Import folder').disabled).toBe(true);
    act(() => listeners['add-files']({}, false));
    expect(button('Import files').disabled).toBe(false);
    click(button('Import files'));
    act(() => {
      listeners['start-read-files']({}, 1);
      listeners['read-media-file'](
        {},
        { ...media, origPath: '/other/new.png', bigName: 'new.png', thumpName: 'new.png' }
      );
      listeners['import-finished']();
    });
    expect(container.querySelectorAll('.media-card')).toHaveLength(2);
    expect(container.querySelectorAll('.media-card.selected')).toHaveLength(1);
    expect(container.querySelector('[data-testid="panorama-viewer"]')).not.toBeNull();
    expect(container.textContent).toContain('Media files');
    expect(button('Import files').disabled).toBe(false);
  });

  test('handles folder and Settings shortcuts once and respects import and modal state', () => {
    renderApp();
    keydown('O', { ctrlKey: true });
    keydown('o', { ctrlKey: true });
    expect(api.send.mock.calls.filter(([channel]) => channel === 'open-dir')).toHaveLength(1);
    act(() => listeners['open-dir']({}, false));
    keydown('o', { ctrlKey: true });
    expect(api.send.mock.calls.filter(([channel]) => channel === 'open-dir')).toHaveLength(2);
    keydown('F1');
    expect(container.querySelector('[aria-label="Settings"]')).not.toBeNull();
    keydown('F1');
    expect(container.querySelectorAll('[aria-label="Settings"]')).toHaveLength(1);
    keydown('o', { ctrlKey: true });
    expect(api.send.mock.calls.filter(([channel]) => channel === 'open-dir')).toHaveLength(2);
    expect(container.textContent).toContain('Keyboard shortcuts');
  });

  test('Ctrl+Shift+O adds files once and respects busy, editable and modal states', () => {
    renderApp();
    expect(button('Import files').title).toBe('Import files (Ctrl+Shift+O)');
    const input = document.createElement('input');
    container.appendChild(input);
    expect(keydown('O', { ctrlKey: true, shiftKey: true }, input).defaultPrevented).toBe(true);
    keydown('O', { ctrlKey: true, shiftKey: true, repeat: true });
    keydown('O', { ctrlKey: true, shiftKey: true, isComposing: true });
    keydown('O', { ctrlKey: true, shiftKey: true, altKey: true });
    keydown('O', { ctrlKey: true, shiftKey: true, metaKey: true });
    expect(api.send.mock.calls.filter(([channel]) => channel === 'add-files')).toHaveLength(0);
    input.remove();

    expect(keydown('Щ', { code: 'KeyO', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    keydown('O', { ctrlKey: true, shiftKey: true });
    expect(api.send.mock.calls.filter(([channel]) => channel === 'add-files')).toHaveLength(1);
    expect(api.send.mock.calls.filter(([channel]) => channel === 'open-dir')).toHaveLength(0);
    act(() => listeners['add-files']({}, false));

    click(button('Open settings'));
    expect(keydown('O', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(api.send.mock.calls.filter(([channel]) => channel === 'add-files')).toHaveLength(1);
    expect(container.querySelector('.shortcuts-box').textContent).toContain('Ctrl+Shift+O');
    click(button('Close settings'));
    keydown('O', { ctrlKey: true, shiftKey: true });
    expect(api.send.mock.calls.filter(([channel]) => channel === 'add-files')).toHaveLength(2);
  });

  test('saves current media and ready panorama and follows navigation and modal state', async () => {
    renderApp();
    loadMedia();
    const second = { type: 'image', thumpName: 'second.jpg', bigName: 'second.jpg', origPath: '/media/second.jpg' };
    act(() => listeners['read-media-file']({}, second));
    click(container.querySelector('.media-card'));
    await act(async () => {
      keydown('p', { ctrlKey: true });
      await Promise.resolve();
    });
    expect(api.savePanoramaScreenshot).toHaveBeenCalledTimes(1);
    await act(async () => {
      keydown('s', { ctrlKey: true });
      await Promise.resolve();
    });
    expect(api.saveCurrentMedia).toHaveBeenLastCalledWith({ origPath: media.origPath });
    click(button('Next media'));
    await act(async () => {
      keydown('s', { ctrlKey: true });
      await Promise.resolve();
    });
    expect(api.saveCurrentMedia).toHaveBeenLastCalledWith({ origPath: second.origPath });
    click(button('Flat view'));
    keydown('p', { ctrlKey: true });
    expect(api.savePanoramaScreenshot).toHaveBeenCalledTimes(1);
    click(button('Info'));
    keydown('s', { ctrlKey: true });
    keydown('F1');
    expect(api.saveCurrentMedia).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="Settings"]')).toBeNull();
    click(button('Close media information'));
    click(button('Adjust panorama orientation'));
    keydown('s', { ctrlKey: true });
    keydown('F1');
    expect(api.saveCurrentMedia).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="Settings"]')).toBeNull();
  });

  test('ignores shortcuts in editable contexts, repeats, composition and extra modifiers', () => {
    renderApp();
    const input = document.createElement('input');
    container.appendChild(input);
    keydown('o', { ctrlKey: true }, input);
    keydown('o', { ctrlKey: true, repeat: true });
    keydown('o', { ctrlKey: true, isComposing: true });
    keydown('o', { ctrlKey: true, altKey: true });
    keydown('o', { ctrlKey: true, shiftKey: true });
    keydown('o', { ctrlKey: true, metaKey: true });
    expect(api.send.mock.calls.filter(([channel]) => channel === 'open-dir')).toHaveLength(0);
    input.remove();
  });

  test('suppresses browser defaults for reserved shortcuts in editable and modal contexts', () => {
    renderApp();
    const input = document.createElement('input');
    container.appendChild(input);
    for (const [key, options] of [
      ['o', { ctrlKey: true }],
      ['p', { ctrlKey: true }],
      ['s', { ctrlKey: true }],
      ['F1', {}],
    ]) {
      expect(keydown(key, options, input).defaultPrevented).toBe(true);
    }
    input.remove();
    click(button('Open settings'));
    expect(keydown('p', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(keydown('s', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(api.send.mock.calls.filter(([channel]) => channel === 'open-dir')).toHaveLength(0);
    expect(api.saveCurrentMedia).not.toHaveBeenCalled();
    expect(api.savePanoramaScreenshot).not.toHaveBeenCalled();
  });

  test('shows media export errors and prevents parallel requests', async () => {
    let resolve;
    api.saveCurrentMedia.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));
    keydown('s', { ctrlKey: true });
    keydown('s', { ctrlKey: true });
    expect(api.saveCurrentMedia).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ success: false, message: 'Disk full' }));
    expect(container.textContent).toContain('Disk full');
  });

  test('saves only the selection, keeps it on cancellation and reports partial failures', async () => {
    renderApp();
    loadMedia();
    const second = { type: 'image', thumpName: 'second.jpg', bigName: 'second.jpg', origPath: '/media/second.jpg' };
    act(() => listeners['read-media-file']({}, second));
    click(button('Toggle selection'));
    expect(button('Export').disabled).toBe(true);
    click(container.querySelector('.media-card'));
    expect(button('Export').disabled).toBe(false);
    api.saveSelectedMedia.mockResolvedValueOnce({ cancelled: true });
    await act(async () => click(button('Export')));
    expect(api.saveSelectedMedia).toHaveBeenLastCalledWith([media.origPath], 1);
    expect(container.querySelectorAll('.media-card.selected')).toHaveLength(1);
    expect(container.querySelector('.error')).toBeNull();
    click(container.querySelectorAll('.media-card')[1]);
    api.saveSelectedMedia.mockResolvedValueOnce({
      success: false,
      saved: 1,
      errors: [{ origPath: second.origPath, message: 'Disk full' }],
    });
    await act(async () => click(button('Export')));
    expect(api.saveSelectedMedia).toHaveBeenLastCalledWith([media.origPath, second.origPath], 2);
    expect(container.textContent).toContain('Saved 1 file(s)');
    expect(container.textContent).toContain('/media/second.jpg: Disk full');
    expect(container.querySelectorAll('.media-card.selected')).toHaveLength(2);
  });

  test('blocks exporting or deleting a selection containing an INSV pair', () => {
    renderApp();
    loadMedia();
    const pair = { type: 'video', insv: true, thumpName: 'pair.jpg', bigName: 'pair', origPath: '/media/00.insv' };
    act(() => listeners['read-media-file']({}, pair));
    click(button('Toggle selection'));
    click(container.querySelectorAll('.media-card')[0]);
    click(container.querySelectorAll('.media-card')[1]);
    click(button('Export'));
    expect(container.textContent).toContain('Exporting INSV pairs is not available.');
    expect(api.saveSelectedMedia).not.toHaveBeenCalled();
    click(button('Delete'));
    expect(container.textContent).toContain('Deleting INSV pairs is not available.');
    expect(api.send.mock.calls.some(([channel]) => channel === 'delete-selected')).toBe(false);
    expect(container.querySelectorAll('.media-card.selected')).toHaveLength(2);
  });

  test('removes selected media from the library without requesting file deletion', () => {
    renderApp();
    loadMedia();
    click(button('Toggle selection'));
    expect(button('Remove selected from library').disabled).toBe(true);
    click(container.querySelector('.media-card'));
    expect(button('Remove selected from library').disabled).toBe(false);
    click(button('Remove selected from library'));
    expect(api.send).toHaveBeenCalledWith('remove-from-library', [
      expect.objectContaining({ origPath: media.origPath }),
    ]);
    expect(api.send).not.toHaveBeenCalledWith('delete-selected', expect.anything());
    expect(container.querySelector('.media-card')).toBeNull();
  });

  test('shares the export lock with Ctrl+S without changing viewer shortcut behavior', async () => {
    let resolve;
    api.saveCurrentMedia.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));
    click(button('Toggle selection'));
    click(container.querySelector('.media-card'));
    keydown('s', { ctrlKey: true });
    expect(api.saveCurrentMedia).toHaveBeenCalledWith({ origPath: media.origPath });
    expect(button('Export').disabled).toBe(true);
    await act(async () => resolve({ cancelled: true }));
    expect(button('Export').disabled).toBe(false);
    api.saveSelectedMedia.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    click(button('Export'));
    expect(button('Export').disabled).toBe(true);
    keydown('s', { ctrlKey: true });
    expect(api.saveCurrentMedia).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ success: false, message: 'Export failed' }));
    expect(container.textContent).toContain('Export failed');
    expect(button('Export').disabled).toBe(false);
    expect(container.querySelector('.media-card.selected')).not.toBeNull();
    expect(container.querySelector('[data-testid="panorama-viewer"]')).not.toBeNull();
  });

  test('shows export progress independently of import and ignores stale events', async () => {
    let resolve;
    api.saveSelectedMedia.mockImplementation(() => new Promise((done) => (resolve = done)));
    renderApp();
    loadMedia();
    const second = { type: 'image', thumpName: 'second.jpg', bigName: 'second.jpg', origPath: '/media/second.jpg' };
    act(() => listeners['read-media-file']({}, second));
    click(button('Toggle selection'));
    click(button('Toggle all'));
    click(button('Export'));
    expect(container.querySelector('[aria-label="Exporting"]')).toBeNull();
    act(() => {
      listeners['start-read-files']({}, 3);
      listeners['export-progress']({}, { requestId: 1, complete: 0, total: 2 });
    });
    expect(container.textContent).toContain('Loading... 0 / 3');
    expect(container.textContent).toContain('Exporting... 0 / 2');
    act(() => listeners['export-progress']({}, { requestId: 1, complete: 1, total: 2 }));
    const bar = container.querySelector('[aria-label="Exporting"]');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.querySelector('span').style.width).toBe('50%');
    act(() => {
      listeners['export-progress']({}, { requestId: 1, complete: 3, total: 2 });
      listeners['export-progress']({}, { requestId: 0, complete: 2, total: 2 });
    });
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    act(() => listeners['export-progress']({}, { requestId: 1, complete: 2, total: 2 }));
    expect(container.textContent).toContain('Processed 2 / 2');
    await act(async () =>
      resolve({ success: false, saved: 1, errors: [{ origPath: second.origPath, message: 'Disk full' }] })
    );
    expect(container.querySelector('[aria-label="Exporting"]')).toBeNull();
    expect(container.textContent).toContain('Loading... 0 / 3');
    expect(container.textContent).toContain('/media/second.jpg: Disk full');
    expect(container.querySelectorAll('.media-card.selected')).toHaveLength(2);
    click(button('Export'));
    act(() => listeners['export-progress']({}, { requestId: 1, complete: 2, total: 2 }));
    expect(container.querySelector('[aria-label="Exporting"]')).toBeNull();
    act(() => listeners['export-progress']({}, { requestId: 2, complete: 0, total: 2 }));
    expect(container.textContent).toContain('Exporting... 0 / 2');
    await act(async () => resolve({ cancelled: true }));
    expect(container.querySelector('[aria-label="Exporting"]')).toBeNull();
    act(() => listeners['export-progress']({}, { requestId: 2, complete: 1, total: 2 }));
    expect(container.querySelector('[aria-label="Exporting"]')).toBeNull();
  });

  test('does not save without media or when the panorama is not ready', async () => {
    mockCaptureReady = false;
    renderApp();
    keydown('p', { ctrlKey: true });
    keydown('s', { ctrlKey: true });
    loadMedia();
    click(container.querySelector('.media-card'));
    await act(async () => {
      keydown('p', { ctrlKey: true });
      await Promise.resolve();
    });
    expect(api.saveCurrentMedia).not.toHaveBeenCalled();
    expect(api.savePanoramaScreenshot).not.toHaveBeenCalled();
  });

  test('removes shortcut listeners on unmount', () => {
    renderApp();
    act(() => root.unmount());
    keydown('o', { ctrlKey: true });
    expect(api.send.mock.calls.filter(([channel]) => channel === 'open-dir')).toHaveLength(0);
  });

  test('I opens the current media information and pauses video like the Info button', () => {
    media = { type: 'video', thumpName: 'video.jpg', bigName: 'video.mp4', origPath: '/media/video.mp4' };
    renderApp();
    keydown('i');
    expect(api.send).not.toHaveBeenCalledWith('get-media-metadata', expect.anything());
    loadMedia();
    click(container.querySelector('.media-card'));
    keydown('I');
    expect(mockPanoramaPause).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenCalledWith('get-media-metadata', {
      origPath: media.origPath,
      type: 'video',
      requestId: 1,
    });
    expect(container.querySelector('.metadata-dialog')).not.toBeNull();
    keydown('i');
    expect(mockPanoramaPause).toHaveBeenCalledTimes(1);
    keydown('Escape');
    expect(container.querySelector('.metadata-dialog')).toBeNull();
  });

  test('I ignores editable targets, composition, modifiers, repeats and modal states', () => {
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));
    for (const tag of ['input', 'textarea', 'select']) {
      const element = document.createElement(tag);
      container.appendChild(element);
      expect(keydown('i', {}, element).defaultPrevented).toBe(false);
      element.remove();
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    container.appendChild(editable);
    expect(keydown('i', {}, editable).defaultPrevented).toBe(false);
    editable.remove();
    for (const option of [
      { repeat: true },
      { isComposing: true },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
      { metaKey: true },
    ]) {
      keydown('i', option);
    }
    click(button('Adjust panorama orientation'));
    keydown('i');
    expect(container.querySelector('.metadata-dialog')).toBeNull();
    click(button('Close orientation correction'));
    click(button('Open settings'));
    keydown('i');
    expect(container.querySelector('.metadata-dialog')).toBeNull();
    expect(api.send.mock.calls.filter(([channel]) => channel === 'get-media-metadata')).toHaveLength(0);
    expect(container.querySelector('.shortcuts-box').textContent).toContain('Show media information');
  });

  test('uses physical shortcut keys regardless of keyboard layout', async () => {
    renderApp();
    keydown('щ', { code: 'KeyO', ctrlKey: true });
    expect(api.send.mock.calls.filter(([channel]) => channel === 'open-dir')).toHaveLength(1);
    act(() => listeners['open-dir']({}, false));
    loadMedia();
    click(container.querySelector('.media-card'));
    await act(async () => {
      keydown('з', { code: 'KeyP', ctrlKey: true });
      keydown('і', { code: 'KeyS', ctrlKey: true });
      await Promise.resolve();
    });
    expect(api.savePanoramaScreenshot).toHaveBeenCalledTimes(1);
    expect(api.saveCurrentMedia).toHaveBeenCalledWith({ origPath: media.origPath });
    keydown('ш', { code: 'KeyI' });
    expect(container.querySelector('.metadata-dialog')).not.toBeNull();
    click(button('Close media information'));
    keydown('щ', { code: 'KeyO' });
    expect(container.querySelector('.orientation-correction')).not.toBeNull();
    keydown('щ', { code: 'KeyO' });
    expect(container.querySelector('.orientation-correction')).toBeNull();
    expect(container.querySelector('.home-shortcuts')).toBeNull();
  });

  test('O ignores editable and modal contexts, repeats and modifiers', () => {
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));
    const input = document.createElement('input');
    container.appendChild(input);
    keydown('щ', { code: 'KeyO' }, input);
    input.remove();
    keydown('щ', { code: 'KeyO', repeat: true });
    keydown('щ', { code: 'KeyO', isComposing: true });
    keydown('щ', { code: 'KeyO', altKey: true });
    keydown('i', { code: 'KeyA' });
    expect(container.querySelector('.orientation-correction')).toBeNull();
    click(button('Info'));
    keydown('щ', { code: 'KeyO' });
    expect(container.querySelector('.orientation-correction')).toBeNull();
    click(button('Close media information'));
    click(button('Open settings'));
    keydown('щ', { code: 'KeyO' });
    expect(container.querySelector('.orientation-correction')).toBeNull();
  });

  test.each([undefined, true])('opens the project website through the bridge resolving to %s', async (result) => {
    api.openExternal.mockResolvedValue(result);
    const windowOpen = jest.spyOn(window, 'open').mockImplementation(() => null);
    renderApp();
    loadMedia();
    act(() => listeners['config-data']({}, { checkUpdates: true }));
    click(container.querySelector('.media-card'));
    const panorama = container.querySelector('[data-testid="panorama-viewer"]');
    click(button('Open settings'));

    const settings = container.querySelector('[role="dialog"][aria-label="Settings"]');
    expect(settings.textContent).toContain('Project website');
    expect(settings.textContent).toContain('viewer360.app');
    expect(button('Visit website').type).toBe('button');

    await act(async () => {
      click(button('Visit website'));
    });

    expect(api.openExternal).toHaveBeenCalledTimes(1);
    expect(api.openExternal).toHaveBeenCalledWith('https://viewer360.app/');
    expect(windowOpen).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"][aria-label="Settings"]')).toBe(settings);
    expect(container.querySelector('[data-testid="panorama-viewer"]')).toBe(panorama);
    expect(settings.querySelector('input[type="checkbox"]').checked).toBe(true);
    expect(container.querySelector('.notice.error')).toBeNull();

    click(button('Close settings'));
    expect(container.querySelector('[role="dialog"][aria-label="Settings"]')).toBeNull();
  });

  test('shows an error when the external-link bridge resolves to false', async () => {
    api.openExternal.mockResolvedValue(false);
    renderApp();
    click(button('Open settings'));

    await act(async () => {
      click(button('Visit website'));
    });

    expect(container.querySelector('.notice.error').textContent).toContain('Unable to open external link');
    expect(button('Visit website')).toBeDefined();
  });

  test('shows an error when the external-link bridge rejects', async () => {
    api.openExternal.mockRejectedValue(new Error('Browser launch failed'));
    renderApp();
    click(button('Open settings'));

    await act(async () => {
      click(button('Visit website'));
    });

    expect(container.querySelector('.notice.error').textContent).toContain('Browser launch failed');
    expect(button('Visit website')).toBeDefined();
  });

  test('opens the project website with the browser-preview fallback when no bridge is available', async () => {
    delete window.shtVR;
    const windowOpen = jest.spyOn(window, 'open').mockImplementation(() => null);
    renderApp();
    click(button('Open settings'));

    await act(async () => {
      click(button('Visit website'));
    });

    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen).toHaveBeenCalledWith('https://viewer360.app/', '_blank', 'noopener,noreferrer');
    expect(button('Visit website')).toBeDefined();
  });

  test.each([
    ['Donate', 'https://www.privat24.ua/send/krdrh'],
    ['View changelog', 'https://github.com/shturnev/ubuntu-360-player/releases'],
  ])('preserves the %s external link in Settings', async (label, url) => {
    renderApp();
    click(button('Open settings'));

    await act(async () => {
      click(button(label));
    });

    expect(api.openExternal).toHaveBeenCalledTimes(1);
    expect(api.openExternal).toHaveBeenCalledWith(url);
    expect(button('Visit website')).toBeDefined();
  });

  test('opens images in 360° mode and allows switching to a flat view', () => {
    renderApp();
    loadMedia();

    click(container.querySelector('.media-card'));

    const panorama = container.querySelector('[data-testid="panorama-viewer"]');
    expect(panorama.getAttribute('data-source')).toBe('http://localhost:3000/big/photo-1000.jpg');
    expect(panorama.getAttribute('data-type')).toBe('image');
    click(button('Flat view'));
    expect(container.querySelector('.viewer-panel img')).not.toBeNull();
    click(button('360° view'));
    expect(container.querySelector('[data-testid="panorama-viewer"]')).not.toBeNull();
  });

  test('reloads a saved image thumbnail with a cache-busting revision', async () => {
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));
    click(button('Adjust panorama orientation'));

    await act(async () => {
      click(button('Save correction'));
      await Promise.resolve();
    });

    expect(api.saveOrientationCorrection).toHaveBeenCalledWith({
      origPath: media.origPath,
      orientation: { yaw: 0, pitch: 0, roll: 0 },
    });
    expect(container.querySelector('.thumb').style.backgroundImage).toMatch(
      /http:\/\/localhost:3000\/small\/photo\.jpg\?revision=\d+/
    );
  });

  test('wraps viewer navigation between the first and last media items', () => {
    renderApp();
    loadMedia();
    const secondMedia = { ...media, thumpName: 'second.jpg', bigName: 'second-1000.jpg' };
    act(() => listeners['read-media-file']({}, secondMedia));

    click(container.querySelector('.media-card'));
    const previousButton = container.querySelector('button[aria-label="Previous media"]');
    const nextButton = container.querySelector('button[aria-label="Next media"]');

    click(previousButton);
    expect(container.querySelector('[data-testid="panorama-viewer"]').getAttribute('data-source')).toBe(
      'http://localhost:3000/big/second-1000.jpg'
    );

    click(nextButton);
    expect(container.querySelector('[data-testid="panorama-viewer"]').getAttribute('data-source')).toBe(
      'http://localhost:3000/big/photo-1000.jpg'
    );

    click(nextButton);
    expect(container.querySelector('[data-testid="panorama-viewer"]').getAttribute('data-source')).toBe(
      'http://localhost:3000/big/second-1000.jpg'
    );

    click(previousButton);
    expect(container.querySelector('[data-testid="panorama-viewer"]').getAttribute('data-source')).toBe(
      'http://localhost:3000/big/photo-1000.jpg'
    );
  });

  test('navigates the viewer with the left and right arrow keys', () => {
    renderApp();
    loadMedia();
    act(() => listeners['read-media-file']({}, { ...media, thumpName: 'second.jpg', bigName: 'second-1000.jpg' }));
    click(container.querySelector('.media-card'));

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(container.querySelector('[data-testid="panorama-viewer"]').getAttribute('data-source')).toBe(
      'http://localhost:3000/big/second-1000.jpg'
    );

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(container.querySelector('[data-testid="panorama-viewer"]').getAttribute('data-source')).toBe(
      'http://localhost:3000/big/photo-1000.jpg'
    );
  });

  test('does not offer conversion for a video that was already converted', () => {
    media = {
      type: 'video',
      thumpName: 'clip-1000-h264.jpg',
      bigName: 'clip-1000-h264.mp4',
      origPath: '/media/clip.mp4',
    };
    renderApp();
    loadMedia();

    click(container.querySelector('.media-card'));

    click(button('Simulate playback failure'));
    expect(button('Convert / fix video')).toBeUndefined();
  });

  test('offers conversion only after a playback failure for the current video', () => {
    media = {
      type: 'video',
      thumpName: 'clip.jpg',
      bigName: 'clip.mp4',
      origPath: '/media/clip.mp4',
    };
    const secondMedia = {
      type: 'video',
      thumpName: 'second.jpg',
      bigName: 'second.mp4',
      origPath: '/media/second.mp4',
    };
    renderApp();
    loadMedia();
    act(() => listeners['read-media-file']({}, secondMedia));

    click(container.querySelector('.media-card'));
    expect(button('Convert / fix video')).toBeUndefined();

    click(button('Simulate playback failure'));
    expect(button('Convert / fix video')).toBeDefined();

    click(container.querySelector('button[aria-label="Next media"]'));
    expect(button('Convert / fix video')).toBeUndefined();

    click(button('✕'));
    click(container.querySelector('.media-card'));
    expect(button('Convert / fix video')).toBeUndefined();
  });

  test('uses a native video element in Flat view', () => {
    media = {
      type: 'video',
      thumpName: 'clip.jpg',
      bigName: 'clip.mp4',
      origPath: '/media/clip.mp4',
    };
    renderApp();
    loadMedia();

    click(container.querySelector('.media-card'));
    click(button('Flat view'));

    expect(container.querySelector('[data-testid="panorama-viewer"]')).toBeNull();
    expect(container.querySelector('.viewer-panel video')).not.toBeNull();
  });

  test('offers conversion for another failed video after the first conversion completes', () => {
    media = {
      type: 'video',
      thumpName: 'first.jpg',
      bigName: 'first.mp4',
      origPath: '/media/first.mp4',
    };
    const secondMedia = {
      type: 'video',
      thumpName: 'second.jpg',
      bigName: 'second.mp4',
      origPath: '/media/second.mp4',
    };
    renderApp();
    loadMedia();
    act(() => listeners['read-media-file']({}, secondMedia));

    click(container.querySelector('.media-card'));
    click(button('Simulate playback failure'));
    click(button('Convert / fix video'));
    click(container.querySelector('button[aria-label="Next media"]'));
    click(button('Simulate playback failure'));

    expect(button('Convert / fix video')).toBeUndefined();

    act(() =>
      listeners['video-conversion-result'](
        {},
        {
          success: true,
          origPath: media.origPath,
          bigName: 'first-100-h264.mp4',
        }
      )
    );

    expect(button('Convert / fix video')).toBeDefined();
  });

  test('subscribes once to media events when StrictMode replays effects', () => {
    act(() =>
      root.render(
        <StrictMode>
          <App />
        </StrictMode>
      )
    );

    act(() => {
      listeners['start-read-dir']({}, 2);
      listeners['read-media-file']({}, media);
      listeners['read-media-file']({}, { ...media, thumpName: 'second.jpg', bigName: 'second-2000.jpg' });
    });

    expect(container.querySelectorAll('.media-card')).toHaveLength(2);
  });

  test('refreshes the cache size after the media import completes', () => {
    renderApp();
    api.send.mockClear();

    act(() => {
      listeners['start-read-dir']({}, 1);
      listeners['read-media-file']({}, media);
      listeners['import-finished']();
    });

    expect(api.send).toHaveBeenCalledWith('get-cache-size', null);
  });

  test('keeps the selected folder path while a subsequent import is loading', () => {
    jest.useFakeTimers();

    try {
      renderApp();
      act(() => {
        listeners['open-dir']({}, '/tmp/first-library');
        listeners['start-read-dir']({}, 1);
        listeners['read-media-file']({}, media);
      });
      act(() => {
        jest.advanceTimersByTime(600);
      });

      const nextMedia = { ...media, thumpName: 'next.jpg', bigName: 'next-1000.jpg' };
      act(() => {
        listeners['open-dir']({}, '/tmp/second-library');
        listeners['start-read-dir']({}, 1);
      });

      expect(container.querySelector('.path-label').textContent).toBe('/tmp/second-library');

      act(() => {
        listeners['read-media-file']({}, nextMedia);
      });
      act(() => {
        jest.advanceTimersByTime(600);
      });

      expect(container.querySelector('.path-label').textContent).toBe('/tmp/second-library');
    } finally {
      jest.useRealTimers();
    }
  });

  test('deletes the item requested from the viewer even if it was not selected first', () => {
    renderApp();
    loadMedia();
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    click(container.querySelector('.media-card'));
    click(button('Delete'));

    expect(api.send).toHaveBeenCalledWith('delete-selected', [media]);
  });

  test('resets the folder label when the last media item is removed', () => {
    renderApp();
    act(() => {
      listeners['open-dir']({}, '/tmp/media-library');
      listeners['read-media-file']({}, media);
    });

    expect(container.querySelector('.path-label').textContent).toBe('/tmp/media-library');

    act(() => {
      listeners['file-deleted']({}, media);
    });

    expect(container.querySelector('.path-label').textContent).toBe('No folder selected');
  });

  test('encodes media file names with spaces in thumbnail and viewer URLs', () => {
    media = { type: 'image', thumpName: 'space photo.jpg', bigName: 'space photo-1000.jpg' };
    renderApp();
    loadMedia();

    const thumb = container.querySelector('.thumb');
    expect(thumb.style.backgroundImage).toContain(encodeURIComponent(media.thumpName));

    click(container.querySelector('.media-card'));
    expect(container.querySelector('[data-testid="panorama-viewer"]').getAttribute('data-source')).toBe(
      `http://localhost:3000/big/${encodeURIComponent(media.bigName)}`
    );
  });

  test('downloads an available update only after user confirmation and installs after a second confirmation', () => {
    renderApp();
    act(() => {
      listeners['config-data']({}, { version: '2.0.0', checkUpdates: true });
      listeners['update-available'](
        {},
        {
          version: '2.1.0',
          releaseUrl: 'https://github.com/shturnev/ubuntu-360-player/releases/latest',
        }
      );
    });

    expect(container.textContent).toContain('New version available: v2.1.0 (installed v2.0.0)');
    click(button('Download update'));
    expect(api.send).toHaveBeenCalledWith('download-update', null);

    act(() => listeners['update-download-progress']({}, { percent: 51 }));
    expect(container.textContent).toContain('Downloading update: 51%');
    expect(api.send).not.toHaveBeenCalledWith('install-update', null);

    act(() => listeners['update-downloaded']({}, { version: '2.1.0' }));
    expect(button('Restart and install')).toBeDefined();
    click(button('Restart and install'));
    expect(api.send).toHaveBeenCalledWith('install-update', null);
  });

  test('loads and displays metadata only for the item currently open', () => {
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));
    click(button('Info'));

    expect(api.send).toHaveBeenCalledWith('get-media-metadata', {
      origPath: '/media/photo.jpg',
      type: 'image',
      requestId: 1,
    });
    expect(container.textContent).toContain('Loading media information');

    act(() =>
      listeners['media-metadata'](
        {},
        {
          origPath: '/media/photo.jpg',
          requestId: 1,
          entries: [{ key: 'dimensions', label: 'Dimensions', value: '1920 × 1080' }],
        }
      )
    );

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain('File name');
    expect(container.textContent).toContain('photo.jpg');
    expect(container.textContent).toContain('Dimensions');
    expect(container.textContent).toContain('1920 × 1080');

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('.metadata-dialog')).toBeNull();
  });

  test('pauses an active flat video before opening metadata', () => {
    media = { type: 'video', thumpName: 'clip.jpg', bigName: 'clip.mp4', origPath: '/media/clip.mp4' };
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));
    click(button('Flat view'));
    const video = container.querySelector('.viewer-panel video');
    video.pause = jest.fn();

    click(button('Info'));

    expect(video.pause).toHaveBeenCalledTimes(1);
  });

  test('does not reopen the dialog after it is closed while metadata is loading', () => {
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));
    click(button('Info'));
    click(container.querySelector('.metadata-backdrop'));

    act(() =>
      listeners['media-metadata'](
        {},
        {
          origPath: '/media/photo.jpg',
          requestId: 1,
          entries: [{ key: 'dimensions', label: 'Dimensions', value: '1920 × 1080' }],
        }
      )
    );

    expect(container.querySelector('.metadata-dialog')).toBeNull();
  });

  test('saves canvas JPEG bytes only through the dedicated bridge and restores the control after cancellation', async () => {
    api.savePanoramaScreenshot.mockResolvedValue({ cancelled: true });
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));

    await act(async () => {
      click(button('Save screenshot'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.savePanoramaScreenshot).toHaveBeenCalledWith({
      data: expect.any(ArrayBuffer),
    });
    expect(button('Save screenshot')).toBeDefined();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  test('reports screenshot save failures without leaving the control disabled', async () => {
    api.savePanoramaScreenshot.mockResolvedValue({ success: false });
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));

    await act(async () => {
      click(button('Save screenshot'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Unable to save the 360° screenshot.');
    expect(button('Save screenshot')).toBeDefined();
  });

  test('does not start parallel screenshot saves', async () => {
    let resolveSave;
    api.savePanoramaScreenshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        })
    );
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));

    click(button('Save screenshot'));
    keydown('p', { ctrlKey: true });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.savePanoramaScreenshot).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSave({ success: true });
      await Promise.resolve();
    });
    expect(button('Save screenshot')).toBeDefined();
  });

  test('ignores a response from an earlier metadata request for the same file', () => {
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));
    click(button('Info'));
    click(container.querySelector('.metadata-backdrop'));
    click(button('Info'));

    act(() =>
      listeners['media-metadata'](
        {},
        {
          origPath: '/media/photo.jpg',
          requestId: 1,
          entries: [{ key: 'dimensions', label: 'Dimensions', value: '800 × 600' }],
        }
      )
    );
    expect(container.textContent).toContain('Loading media information');

    act(() =>
      listeners['media-metadata'](
        {},
        {
          origPath: '/media/photo.jpg',
          requestId: 2,
          entries: [{ key: 'dimensions', label: 'Dimensions', value: '1920 × 1080' }],
        }
      )
    );
    expect(container.textContent).toContain('1920 × 1080');
    expect(container.textContent).not.toContain('800 × 600');
  });

  test('moves focus into the metadata dialog and restores it when closed', () => {
    renderApp();
    loadMedia();
    click(container.querySelector('.media-card'));
    const infoButton = button('Info');
    click(infoButton);

    expect(document.activeElement).toBe(container.querySelector('[aria-label="Close media information"]'));

    const metadataContent = container.querySelector('[aria-label="Media metadata"]');
    metadataContent.focus();
    expect(document.activeElement).toBe(metadataContent);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Close media information"]'));

    click(container.querySelector('[aria-label="Close media information"]'));

    expect(document.activeElement).toBe(infoButton);
  });
});
