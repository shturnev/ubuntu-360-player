import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from '../../src/App.jsx';

jest.mock(
  '../../src/PanoramaViewer.jsx',
  () => {
    const React = require('react');
    return React.forwardRef(function PanoramaViewer({
      source,
      type,
      showConvertVideo,
      onConvertVideo,
      onVideoPlaybackFailure,
      onVideoPlaybackSuccess,
    }, ref) {
      React.useImperativeHandle(ref, () => ({ pause: jest.fn() }));
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
  }
);

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
      openExternal: jest.fn().mockResolvedValue(undefined),
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
    [...container.querySelectorAll('button')].find((element) => element.textContent.trim() === name);

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
    expect(container.querySelector('img[alt="photo-1000.jpg"]').getAttribute('src')).toBe(
      'http://localhost:3000/big/photo-1000.jpg'
    );
    click(button('360° view'));
    expect(container.querySelector('[data-testid="panorama-viewer"]')).not.toBeNull();
  });

  test('wraps viewer navigation between the first and last media items', () => {
    renderApp();
    loadMedia();
    const secondMedia = { ...media, thumpName: 'second.jpg', bigName: 'second-1000.jpg' };
    act(() => listeners['read-media-file']({}, secondMedia));

    click(container.querySelector('.media-card'));
    const controls = container.querySelectorAll('.viewer-controls button');
    const previousButton = controls[0];
    const nextButton = controls[4];

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

    click(container.querySelectorAll('.viewer-controls button')[4]);
    expect(button('Convert / fix video')).toBeUndefined();

    click(button('✕'));
    click(container.querySelector('.media-card'));
    expect(button('Convert / fix video')).toBeUndefined();
  });

  test('offers conversion after a Flat view playback error', () => {
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
    act(() => container.querySelector('.viewer-panel video').dispatchEvent(new Event('error')));

    expect(container.textContent).toContain('Unable to play this video in Flat view.');
    expect(button('Convert / fix video')).toBeDefined();
  });

  test('offers conversion when Flat view starts without a video frame', () => {
    jest.useFakeTimers();
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
    act(() => {
      container.querySelector('.viewer-panel video').dispatchEvent(new Event('playing'));
      jest.advanceTimersByTime(4000);
    });

    expect(container.textContent).toContain('Unable to play this video in Flat view.');
    expect(button('Convert / fix video')).toBeDefined();
    jest.useRealTimers();
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
    click(container.querySelectorAll('.viewer-controls button')[4]);
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
    });
    expect(container.textContent).toContain('Loading media information');

    act(() =>
      listeners['media-metadata']({}, {
        origPath: '/media/photo.jpg',
        entries: [{ key: 'dimensions', label: 'Dimensions', value: '1920 × 1080' }],
      })
    );

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
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
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    video.pause = jest.fn();

    click(button('Info'));

    expect(video.pause).toHaveBeenCalledTimes(1);
  });
});
