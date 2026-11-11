import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from '../../src/App.jsx';

jest.mock('../../src/PanoramaViewer.jsx', () => function PanoramaViewer({ source, type }) {
  return <div data-testid="panorama-viewer" data-source={source} data-type={type} />;
});

describe('App', () => {
  let container;
  let root;
  let api;
  let listeners;
  let media;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
      openExternal: jest.fn().mockResolvedValue(undefined)
    };
    window.shtVR = api;
    media = { type: 'image', thumpName: 'photo.jpg', bigName: 'photo-1000.jpg' };
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

  const button = (name) => [...container.querySelectorAll('button')]
    .find((element) => element.textContent.trim() === name);

  const loadMedia = () => {
    act(() => {
      listeners['start-file-server']({}, 'http://localhost:3000/');
      listeners['read-media-file']({}, media);
    });
  };

  test('opens images in 360° mode and allows switching to a flat view', () => {
    renderApp();
    loadMedia();

    click(container.querySelector('.media-card'));

    const panorama = container.querySelector('[data-testid="panorama-viewer"]');
    expect(panorama.getAttribute('data-source')).toBe('http://localhost:3000/big/photo-1000.jpg');
    expect(panorama.getAttribute('data-type')).toBe('image');
    click(button('Flat view'));
    expect(container.querySelector('img[alt="photo-1000.jpg"]').getAttribute('src')).toBe('http://localhost:3000/big/photo-1000.jpg');
    click(button('360° view'));
    expect(container.querySelector('[data-testid="panorama-viewer"]')).not.toBeNull();
  });

  test('does not offer conversion for a video that was already converted', () => {
    media = {
      type: 'video',
      thumpName: 'clip-1000-h264.jpg',
      bigName: 'clip-1000-h264.mp4',
      origPath: '/media/clip.mp4'
    };
    renderApp();
    loadMedia();

    click(container.querySelector('.media-card'));

    expect(button('Convert / fix video')).toBeUndefined();
  });

  test('subscribes once to media events when StrictMode replays effects', () => {
    act(() => root.render(
      <StrictMode>
        <App />
      </StrictMode>
    ));

    act(() => {
      listeners['start-read-dir']({}, 2);
      listeners['read-media-file']({}, media);
      listeners['read-media-file']({}, { ...media, thumpName: 'second.jpg', bigName: 'second-2000.jpg' });
    });

    expect(container.querySelectorAll('.media-card')).toHaveLength(2);
  });

  test('refreshes the cache size after the media import completes', () => {
    jest.useFakeTimers();
    renderApp();

    act(() => {
      listeners['start-read-dir']({}, 1);
      listeners['read-media-file']({}, media);
    });

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(api.send).toHaveBeenCalledWith('get-cache-size', null);
    jest.useRealTimers();
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
    expect(container.querySelector('[data-testid="panorama-viewer"]').getAttribute('data-source')).toBe(`http://localhost:3000/big/${encodeURIComponent(media.bigName)}`);
  });

  test('offers the update download using the configured download link and hash', () => {
    renderApp();
    act(() => {
      listeners['config-data']({}, {
        version: '1.0.5',
        checkUpdates: true,
        downloadLink: 'https://downloads.example/#/file/'
      });
      listeners['need-to-update']({}, {
        filename_orig: 'sht-vr-player_1.0.6.deb',
        hash: 'abc123'
      });
    });

    expect(container.textContent).toContain('New version available: v1.0.6 (installed v1.0.5)');
    click(button('Download update'));

    expect(api.openExternal).toHaveBeenCalledWith('https://downloads.example/#/file/abc123');
  });
});
