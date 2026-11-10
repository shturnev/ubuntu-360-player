import { useEffect, useMemo, useState } from 'react';
import './App.scss';
import AppHeader from './components/AppHeader.jsx';
import EmptyLibraryState from './components/EmptyLibraryState.jsx';
import LoadingProgress from './components/LoadingProgress.jsx';
import MediaGrid from './components/MediaGrid.jsx';
import NoticeBanner from './components/NoticeBanner.jsx';
import SelectionBar from './components/SelectionBar.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import ThumbnailSlider from './components/ThumbnailSlider.jsx';
import ViewerOverlay from './components/ViewerOverlay.jsx';

const EMPTY_PROGRESS = { show: false, total: 0, complete: 0 };

function App() {
  const [selectedPath, setSelectedPath] = useState('');
  const [items, setItems] = useState([]);
  const [maxSizePx, setMaxSizePx] = useState(150);
  const [loadingProgress, setLoadingProgress] = useState(EMPTY_PROGRESS);
  const [showingItem, setShowingItem] = useState(null);
  const [flatView, setFlatView] = useState(false);
  const [cacheSize, setCacheSize] = useState(0);
  const [configData, setConfigData] = useState({ version: '1.0.5', checkUpdates: true, downloadLink: '' });
  const [updateInfo, setUpdateInfo] = useState(null);
  const [canOpenDir, setCanOpenDir] = useState(true);
  const [canSelect, setCanSelect] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const closeViewer = () => {
    setShowingItem(null);
    setFlatView(false);
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

        setItems((current) => [...current, data].sort((a, b) => String(a.thumpName).localeCompare(String(b.thumpName))));
      },
      'file-deleted': (_, item) => {
        if (!item) return;
        setItems((current) => current.filter((entry) => entry.thumpName !== item.thumpName && entry.bigName !== item.bigName));
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
      'need-to-update': (_, payload) => {
        if (!payload) return;
        setUpdateInfo(payload);
      }
    };

    const subscriptions = Object.entries(handlers).map(([channel, listener]) => ({
      channel,
      listener,
      unsubscribe: api.on(channel, listener)
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
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: !item.selected } : item));
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
    if (items.length === 0) {
      setCanSelect(false);
      closeViewer();
    }
  }, [items.length]);

  const handleDelete = (item = null) => {
    const targetIndex = item
      ? items.findIndex((entry) => entry.thumpName === item.thumpName && entry.bigName === item.bigName)
      : -1;
    const selectedItems = items.filter((entry, index) => entry.selected || (item && index === targetIndex));

    const confirmed = window.confirm(
      item ? 'Delete this selected media item?' : `Delete ${selectedItems.length > 1 ? `${selectedItems.length} selected files` : 'this file'}?`
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

  const updateCheckSetting = () => {
    const nextValue = !configData.checkUpdates;
    const payload = { ...configData, checkUpdates: nextValue };
    setConfigData(payload);
    request('save-config', payload);
    if (nextValue) {
      request('check-for-update', null);
    }
  };

  const viewerSrc = showingItem ? `${serverUrl}big/${showingItem.bigName}` : '';
  const updateFilenameVersion = updateInfo && updateInfo.filename_orig
    ? updateInfo.filename_orig.split('_')[1]
    : null;
  const updateVersion = updateFilenameVersion
    ? updateFilenameVersion.replace(/\.[^.]+$/, '')
    : updateInfo?.filename_orig || 'latest';

  const downloadUpdate = () => {
    if (!configData.downloadLink || !updateInfo || !updateInfo.hash) {
      setErrorMessage('Update download link is unavailable');
      return;
    }
    openExternalLink(`${configData.downloadLink}${updateInfo.hash}`);
  };

  return (
    <div className="app-shell">
      <AppHeader
        version={configData.version || '1.0.5'}
        canOpenDir={canOpenDir}
        canSelectMedia={items.length > 0}
        showCloseViewer={Boolean(showingItem)}
        onOpenDir={() => request('open-dir', true)}
        onToggleSelection={() => setCanSelect((value) => !value)}
        onCloseViewer={closeViewer}
      />

      {errorMessage && (
        <NoticeBanner kind="error" title={errorMessage} onDismiss={() => setErrorMessage('')} />
      )}

      {updateInfo && (
        <NoticeBanner kind="update-notice" title={`New version available: v${updateVersion} (installed v${configData.version || '1.0.5'})`} onDismiss={() => setUpdateInfo(null)}>
          <button type="button" className="primary-button" onClick={downloadUpdate}>Download update</button>
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

      {items.length === 0 && !loadingProgress.show && (
        <EmptyLibraryState onOpenDir={() => request('open-dir', true)} />
      )}

      {selectedPath && <div className="path-label">{selectedPath}</div>}

      {loadingProgress.show && (
        <LoadingProgress complete={loadingProgress.complete} total={loadingProgress.total} />
      )}

      <MediaGrid
        items={items}
        serverUrl={serverUrl}
        maxSizePx={maxSizePx}
        canSelect={canSelect}
        onToggleSelection={toggleSelection}
        onOpenItem={(item) => setShowingItem(item)}
      />

      {showingItem && (
        <ViewerOverlay
          showingItem={showingItem}
          items={items}
          viewerSrc={viewerSrc}
          flatView={flatView}
          onClose={closeViewer}
          onToggleFlatView={() => setFlatView((current) => !current)}
          onDelete={() => handleDelete(showingItem)}
          onPrevious={() => {
            const previousIndex = showingItem.index - 1;
            if (items[previousIndex]) setShowingItem({ ...items[previousIndex], index: previousIndex });
          }}
          onNext={() => {
            const nextIndex = showingItem.index + 1;
            if (items[nextIndex]) setShowingItem({ ...items[nextIndex], index: nextIndex });
          }}
        />
      )}

      <SettingsPanel
        cacheSize={cacheSize}
        checkUpdates={Boolean(configData.checkUpdates)}
        onDeleteCache={deleteCache}
        onUpdateSetting={updateCheckSetting}
        onOpenExternal={openExternalLink}
      />

      <ThumbnailSlider value={maxSizePx} onChange={setMaxSizePx} disabled={items.length === 0} />
    </div>
  );
}

export default App;
