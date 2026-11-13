import { useEffect, useMemo, useState } from 'react';
import './App.scss';
import AppHeader from './components/AppHeader.jsx';
import EmptyLibraryState from './components/EmptyLibraryState.jsx';
import LoadingProgress from './components/LoadingProgress.jsx';
import MediaGrid from './components/MediaGrid.jsx';
import NoticeBanner from './components/NoticeBanner.jsx';
import SelectionBar from './components/SelectionBar.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import ViewerOverlay from './components/ViewerOverlay.jsx';

const EMPTY_PROGRESS = { show: false, total: 0, complete: 0 };

const getMediaIdentity = (item) => item?.origPath || item?.bigName || item?.thumpName || '';

function App() {
  const [selectedPath, setSelectedPath] = useState('');
  const [items, setItems] = useState([]);
  const [maxSizePx, setMaxSizePx] = useState(150);
  const [loadingProgress, setLoadingProgress] = useState(EMPTY_PROGRESS);
  const [showingItem, setShowingItem] = useState(null);
  const [flatView, setFlatView] = useState(false);
  const [cacheSize, setCacheSize] = useState(0);
  const [configData, setConfigData] = useState({});
  const [updateState, setUpdateState] = useState({ status: 'idle', info: null, progress: 0 });
  const [canOpenDir, setCanOpenDir] = useState(true);
  const [canSelect, setCanSelect] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [conversionProgress, setConversionProgress] = useState({
    active: false,
    percent: 0,
    elapsedMs: 0,
    etaMs: null,
    status: 'idle',
    message: '',
  });
  const [convertedVideos, setConvertedVideos] = useState(new Set());
  const [playbackFailedVideoId, setPlaybackFailedVideoId] = useState('');

  const closeViewer = () => {
    setShowingItem(null);
    setFlatView(false);
    setPlaybackFailedVideoId('');
  };

  const api = typeof window !== 'undefined' ? window.shtVR : null;

  const totalSelected = useMemo(() => items.filter((item) => item.selected).length, [items]);

  useEffect(() => {
    if (!api) {
      return undefined;
    }

    const handlers = {
      'start-file-server': (_, url) => setServerUrl(url || ''),
      'config-data': (_, data) => setConfigData((prev) => ({ ...prev, ...(data || {}) })),
      'open-dir': (_, value) => {
        if (!value) {
          setCanOpenDir(true);
          return;
        }
        setSelectedPath(value);
        setCanOpenDir(false);
      },
      'start-read-dir': (_, total) => {
        const totalFiles = Number(total) || 0;
        if (totalFiles <= 0) {
          setLoadingProgress(EMPTY_PROGRESS);
          setItems([]);
          setCanSelect(false);
          return;
        }

        setLoadingProgress({ show: true, total: totalFiles, complete: 0 });
        setItems([]);
        setCanSelect(false);
      },
      'read-media-file': (_, data) => {
        setLoadingProgress((prev) => {
          const complete = prev.complete + 1;
          const next = { ...prev, complete };
          if (prev.total > 0 && complete >= prev.total) {
            setTimeout(() => {
              setLoadingProgress(EMPTY_PROGRESS);
              setCanOpenDir(true);
              request('get-cache-size', null);
            }, 600);
          }
          return next;
        });

        if (!data || data.error) {
          if (data && data.error) {
            setErrorMessage(data.error.message || 'Unable to read media');
          }
          return;
        }

        setItems((current) =>
          [...current, data].sort((a, b) => String(a.thumpName).localeCompare(String(b.thumpName)))
        );
      },
      'file-deleted': (_, item) => {
        if (!item) return;
        setItems((current) =>
          current.filter((entry) => entry.thumpName !== item.thumpName && entry.bigName !== item.bigName)
        );
      },
      'cache-size': (_, value) => setCacheSize(Number(value) || 0),
      'delete-cache-finish': () => {
        setCacheSize(0);
        setItems([]);
        setCanSelect(false);
        setShowingItem(null);
        setFlatView(false);
        setCanOpenDir(true);
      },
      'delete-error': (_, err) => {
        setErrorMessage(err && err.message ? err.message : 'Delete failed');
      },
      'show-error': (_, err) => {
        setErrorMessage(err && err.message ? err.message : 'Unexpected error');
      },
      'update-available': (_, payload) => {
        if (!payload) return;
        setUpdateState({ status: 'available', info: payload, progress: 0 });
      },
      'update-download-progress': (_, payload) => {
        setUpdateState((current) => ({
          ...current,
          status: 'downloading',
          progress: Math.max(0, Math.min(100, Number(payload?.percent) || 0)),
        }));
      },
      'update-downloaded': (_, payload) => {
        setUpdateState((current) => ({
          ...current,
          status: 'downloaded',
          info: payload || current.info,
          progress: 100,
        }));
      },
      'update-error': (_, payload) => {
        setUpdateState({ status: 'idle', info: null, progress: 0 });
        setErrorMessage(payload?.message || 'Unable to update the application.');
      },
      'video-conversion-progress': (_, data) => {
        if (!data) return;
        setConversionProgress({
          active: Boolean(data.active),
          percent: Number(data.percent) || 0,
          elapsedMs: Number(data.elapsedMs) || 0,
          etaMs: data.etaMs == null ? null : Number(data.etaMs),
          status: data.status || 'running',
          message: data.message || '',
        });
      },
      'video-conversion-result': (_, data) => {
        if (!data) return;

        if (data.success) {
          setConvertedVideos((current) => new Set([...current, data.origPath]));
          setPlaybackFailedVideoId('');
          setItems((current) =>
            current.map((item) => (item.origPath === data.origPath ? { ...item, bigName: data.bigName } : item))
          );
          setShowingItem((current) =>
            current && current.origPath === data.origPath ? { ...current, bigName: data.bigName } : current
          );
          setFlatView(false);
          setErrorMessage('');
          setConversionProgress({
            active: false,
            percent: 100,
            elapsedMs: Number(data.elapsedMs) || 0,
            etaMs: 0,
            status: 'done',
            message: 'Ready to play.',
          });
          return;
        }

        setConversionProgress({
          active: false,
          percent: 0,
          elapsedMs: 0,
          etaMs: null,
          status: 'error',
          message: data.message || 'Unable to convert video.',
        });
        setErrorMessage(data.message || 'Unable to convert video.');
      },
    };

    const subscriptions = Object.entries(handlers).map(([channel, listener]) => ({
      channel,
      listener,
      unsubscribe: api.on(channel, listener),
    }));

    api.send('get-config', null);
    api.send('check-for-update', null);
    api.send('get-cache-size', null);

    return () => {
      subscriptions.forEach(({ channel, listener, unsubscribe }) => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        } else {
          api.removeListener(channel, listener);
        }
      });
    };
  }, [api]);

  const openExternalLink = async (url) => {
    try {
      if (api && typeof api.openExternal === 'function') {
        await api.openExternal(url);
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setErrorMessage(error && error.message ? error.message : 'Unable to open external link');
    }
  };

  const request = (channel, payload) => {
    if (api && typeof api.send === 'function') {
      api.send(channel, payload);
    }
  };

  const toggleSelection = (index) => {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, selected: !item.selected } : item))
    );
  };

  const toggleSelectionAll = (selectAll) => {
    setItems((current) => current.map((item) => ({ ...item, selected: selectAll })));
  };

  const clearSelected = () => {
    setItems((current) => current.filter((item) => !item.selected));
    setCanSelect(false);
  };

  const deleteFiles = (selectedItems = items.filter((item) => item.selected)) => {
    if (!selectedItems.length) return;
    request('delete-selected', selectedItems);
    setCanSelect(false);
  };

  useEffect(() => {
    if (items.length === 0 && !loadingProgress.show) {
      setSelectedPath('');
      setCanSelect(false);
      closeViewer();
    }
  }, [items.length, loadingProgress.show]);

  const handleDelete = (item = null) => {
    const targetIndex = item
      ? items.findIndex((entry) => entry.thumpName === item.thumpName && entry.bigName === item.bigName)
      : -1;
    const selectedItems = items.filter((entry, index) => entry.selected || (item && index === targetIndex));

    const confirmed = window.confirm(
      item
        ? 'Delete this selected media item?'
        : `Delete ${selectedItems.length > 1 ? `${selectedItems.length} selected files` : 'this file'}?`
    );

    if (!confirmed) return;

    if (item && targetIndex >= 0) {
      const nextIndex = items[targetIndex + 1] ? targetIndex + 1 : items[targetIndex - 1] ? targetIndex - 1 : null;
      if (nextIndex !== null && items[nextIndex]) {
        setShowingItem({ ...items[nextIndex], index: nextIndex });
      } else {
        setShowingItem(null);
      }
    }

    deleteFiles(selectedItems);
  };

  const deleteCache = () => {
    request('delete-cache', []);
  };

  const convertCurrentVideo = () => {
    if (!showingItem || showingItem.type !== 'video' || !showingItem.origPath) return;
    setConversionProgress({
      active: true,
      percent: 0,
      elapsedMs: 0,
      etaMs: null,
      status: 'running',
      message: 'Starting conversion…',
    });
    setErrorMessage('');
    request('convert-video', { filePath: showingItem.origPath });
  };

  const updateCheckSetting = () => {
    const nextValue = !configData.checkUpdates;
    const payload = { ...configData, checkUpdates: nextValue };
    setConfigData(payload);
    request('save-config', payload);
    if (nextValue) {
      request('check-for-update', null);
    }
  };

  const viewerSrc = showingItem ? `${serverUrl}big/${encodeURIComponent(showingItem.bigName)}` : '';
  const hasConvertedVideo = Boolean(
    showingItem && (convertedVideos.has(showingItem.origPath) || /-\d+-h264\.mp4$/i.test(showingItem.bigName || ''))
  );
  const showingItemId = getMediaIdentity(showingItem);
  const hasPlaybackFailure = Boolean(
    showingItem && showingItem.type === 'video' && showingItemId === playbackFailedVideoId
  );
  const downloadUpdate = () => {
    request('download-update', null);
    setUpdateState((current) => ({ ...current, status: 'downloading', progress: 0 }));
  };

  return (
    <div className="app-shell">
      <AppHeader
        version={configData.version}
        selectedPath={selectedPath}
        maxSizePx={maxSizePx}
        sliderDisabled={items.length === 0}
        canOpenDir={canOpenDir}
        canSelectMedia={items.length > 0}
        showCloseViewer={Boolean(showingItem)}
        showSettings={showSettings}
        onOpenDir={() => request('open-dir', true)}
        onToggleSelection={() => setCanSelect((value) => !value)}
        onCloseViewer={closeViewer}
        onToggleSettings={() => setShowSettings((value) => !value)}
        onThumbnailSizeChange={setMaxSizePx}
      />

      {errorMessage && <NoticeBanner kind="error" title={errorMessage} onDismiss={() => setErrorMessage('')} />}

      {updateState.status === 'available' && (
        <NoticeBanner
          kind="update-notice"
          title={`New version available: v${updateState.info?.version || 'latest'}${
            configData.version ? ` (installed v${configData.version})` : ''
          }`}
          onDismiss={() => setUpdateState({ status: 'idle', info: null, progress: 0 })}
          dismissLabel="Not now"
        >
          <button type="button" className="primary-button" onClick={downloadUpdate}>
            Download update
          </button>
          {updateState.info?.releaseUrl && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => openExternalLink(updateState.info.releaseUrl)}
            >
              Open release
            </button>
          )}
        </NoticeBanner>
      )}

      {updateState.status === 'downloading' && (
        <NoticeBanner
          kind="update-notice"
          title={`Downloading update: ${updateState.progress}%`}
          onDismiss={() => setUpdateState({ status: 'idle', info: null, progress: 0 })}
          dismissLabel="Not now"
        />
      )}

      {updateState.status === 'downloaded' && (
        <NoticeBanner
          kind="update-notice"
          title={`Update v${updateState.info?.version || ''} is ready to install.`}
          onDismiss={() => setUpdateState({ status: 'idle', info: null, progress: 0 })}
          dismissLabel="Not now"
        >
          <button type="button" className="primary-button" onClick={() => request('install-update', null)}>
            Restart and install
          </button>
        </NoticeBanner>
      )}

      {canSelect && (
        <SelectionBar
          totalSelected={totalSelected}
          totalItems={items.length}
          onToggleAll={() => toggleSelectionAll(!totalSelected)}
          onClear={clearSelected}
          onDelete={() => handleDelete(null)}
          onClose={() => setCanSelect(false)}
        />
      )}

      {items.length === 0 && !loadingProgress.show && <EmptyLibraryState onOpenDir={() => request('open-dir', true)} />}

      {loadingProgress.show && <LoadingProgress complete={loadingProgress.complete} total={loadingProgress.total} />}

      <MediaGrid
        items={items}
        serverUrl={serverUrl}
        maxSizePx={maxSizePx}
        canSelect={canSelect}
        onToggleSelection={toggleSelection}
        onOpenItem={(item) => {
          setPlaybackFailedVideoId('');
          setShowingItem(item);
        }}
      />

      {showingItem && (
        <ViewerOverlay
          showingItem={showingItem}
          items={items}
          viewerSrc={viewerSrc}
          flatView={flatView}
          conversionProgress={conversionProgress}
          hasConvertedVideo={hasConvertedVideo}
          hasPlaybackFailure={hasPlaybackFailure}
          onConvertVideo={convertCurrentVideo}
          onVideoPlaybackFailure={() => setPlaybackFailedVideoId(getMediaIdentity(showingItem))}
          onVideoPlaybackSuccess={() => setPlaybackFailedVideoId('')}
          onClose={closeViewer}
          onToggleFlatView={() => setFlatView((current) => !current)}
          onOpenExternal={openExternalLink}
          onDelete={() => handleDelete(showingItem)}
          onPrevious={() => {
            if (items.length < 2) return;
            const previousIndex = (showingItem.index - 1 + items.length) % items.length;
            setPlaybackFailedVideoId('');
            setShowingItem({ ...items[previousIndex], index: previousIndex });
          }}
          onNext={() => {
            if (items.length < 2) return;
            const nextIndex = (showingItem.index + 1) % items.length;
            setPlaybackFailedVideoId('');
            setShowingItem({ ...items[nextIndex], index: nextIndex });
          }}
        />
      )}

      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div
            className="settings-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
          >
            <SettingsPanel
              cacheSize={cacheSize}
              checkUpdates={Boolean(configData.checkUpdates)}
              onDeleteCache={deleteCache}
              onUpdateSetting={updateCheckSetting}
              onOpenExternal={openExternalLink}
              onClose={() => setShowSettings(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
