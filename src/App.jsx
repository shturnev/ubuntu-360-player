import { useEffect, useMemo, useState } from 'react';

const EMPTY_PROGRESS = { show: false, total: 0, complete: 0 };

function App() {
  const [selectedPath, setSelectedPath] = useState('');
  const [items, setItems] = useState([]);
  const [maxSizePx, setMaxSizePx] = useState(150);
  const [loadingProgress, setLoadingProgress] = useState(EMPTY_PROGRESS);
  const [showingItem, setShowingItem] = useState(null);
  const [cacheSize, setCacheSize] = useState(0);
  const [configData, setConfigData] = useState({ version: '1.0.5', checkUpdates: true, downloadLink: '' });
  const [canOpenDir, setCanOpenDir] = useState(true);
  const [canSelect, setCanSelect] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

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
        setLoadingProgress({ show: true, total: Number(total) || 0, complete: 0 });
        setItems([]);
      },
      'read-media-file': (_, data) => {
        setLoadingProgress((prev) => {
          const complete = prev.complete + 1;
          const next = { ...prev, complete };
          if (prev.total > 0 && complete >= prev.total) {
            setTimeout(() => setLoadingProgress(EMPTY_PROGRESS), 600);
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
        setErrorMessage(`New version available: ${payload.filename_orig || 'latest'}`);
      }
    };

    Object.entries(handlers).forEach(([channel, listener]) => api.on(channel, listener));

    api.send('get-config', null);
    api.send('check-for-update', null);
    api.send('get-cache-size', null);

    return () => {
      Object.entries(handlers).forEach(([channel, listener]) => api.removeListener(channel, listener));
    };
  }, [api]);

  const openExternalLink = async (url) => {
    if (api && typeof api.openExternal === 'function') {
      await api.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
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

  const deleteFiles = () => {
    const selectedItems = items.filter((item) => item.selected);
    if (!selectedItems.length) return;
    request('delete-selected', selectedItems);
    setCanSelect(false);
  };

  const handleDelete = (item = null) => {
    const targetIndex = item
      ? items.findIndex((entry) => entry.thumpName === item.thumpName && entry.bigName === item.bigName)
      : -1;

    if (item && targetIndex >= 0) {
      toggleSelection(targetIndex);
    }

    const confirmed = window.confirm(
      item ? 'Delete this selected media item?' : `Delete ${totalSelected > 1 ? `${totalSelected} selected files` : 'this file'}?`
    );

    if (!confirmed) {
      if (item && targetIndex >= 0) toggleSelection(targetIndex);
      return;
    }

    if (item && targetIndex >= 0) {
      const nextIndex = items[targetIndex + 1] ? targetIndex + 1 : items[targetIndex - 1] ? targetIndex - 1 : null;
      if (nextIndex !== null && items[nextIndex]) {
        setShowingItem({ ...items[nextIndex], index: nextIndex });
      } else {
        setShowingItem(null);
      }
    }

    deleteFiles();
  };

  const deleteCache = () => {
    request('delete-cache', items);
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="title-group">
          <span className="app-name">sht-vr-player</span>
          <span className="version">v{configData.version || '1.0.5'}</span>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="primary-button" onClick={() => request('open-dir', true)} disabled={!canOpenDir}>Open folder</button>
          <button type="button" className="ghost-button" onClick={() => setCanSelect((v) => !v)}>Selection</button>
          <button type="button" className="ghost-button" onClick={() => setShowingItem(null)}>Close viewer</button>
        </div>
      </header>

      {errorMessage && (
        <div className="notice error">
          {errorMessage}
          <button type="button" onClick={() => setErrorMessage('')}>Dismiss</button>
        </div>
      )}

      {canSelect && (
        <div className="selection-bar">
          <span>Selected {totalSelected} / {items.length}</span>
          <button type="button" onClick={() => toggleSelectionAll(!totalSelected)}>Toggle all</button>
          <button type="button" onClick={clearSelected}>Clear</button>
          <button type="button" onClick={() => handleDelete(null)} disabled={!totalSelected}>Delete</button>
          <button type="button" onClick={() => setCanSelect(false)}>
            Close
          </button>
        </div>
      )}

      {items.length === 0 && !loadingProgress.show && (
        <div className="empty-state">
          <button type="button" className="primary-button large" onClick={() => request('open-dir', true)}>Choose a media directory</button>
        </div>
      )}

      {selectedPath && <div className="path-label">{selectedPath}</div>}

      {loadingProgress.show && (
        <div className="progress-block">
          <div>
            {loadingProgress.complete === 0 || loadingProgress.complete !== loadingProgress.total
              ? `Loading... ${loadingProgress.complete} / ${loadingProgress.total}`
              : 'Completed'}
          </div>
          <div className="progress-bar">
            <span style={{ width: `${loadingProgress.total ? (loadingProgress.complete / loadingProgress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      <div className="media-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${maxSizePx}px, 1fr))` }}>
        {items.map((item, index) => (
          <div
            key={`${item.thumpName}-${item.bigName}-${index}`}
            className={`media-card ${item.selected ? 'selected' : ''}`}
            onClick={() => (canSelect ? toggleSelection(index) : setShowingItem({ ...item, index }))}
          >
            <div className="thumb" style={{ backgroundImage: `url(${serverUrl}small/${item.thumpName})` }}>
              {item.type === 'video' && <span className="video-badge">▶</span>}
            </div>
            <div className="selection-mark">✓</div>
          </div>
        ))}
      </div>

      {showingItem && (
        <div className="viewer-overlay" onClick={() => setShowingItem(null)}>
          <div className="viewer-panel" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="close-viewer" onClick={() => setShowingItem(null)}>✕</button>
            {showingItem.type === 'video' ? (
              <video controls autoPlay src={viewerSrc} />
            ) : (
              <img src={viewerSrc} alt={showingItem.bigName} />
            )}
            <div className="viewer-controls">
              <button type="button" onClick={() => {
                const previousIndex = showingItem.index - 1;
                if (items[previousIndex]) setShowingItem({ ...items[previousIndex], index: previousIndex });
              }} disabled={!items[showingItem.index - 1]}>←</button>
              <button type="button" onClick={() => handleDelete(showingItem)}>Delete</button>
              <button type="button" onClick={() => {
                const nextIndex = showingItem.index + 1;
                if (items[nextIndex]) setShowingItem({ ...items[nextIndex], index: nextIndex });
              }} disabled={!items[showingItem.index + 1]}>→</button>
            </div>
          </div>
        </div>
      )}

      <div className="settings-panel">
        <h3>Settings</h3>
        <button type="button" className="ghost-button full" onClick={deleteCache}>Clear data cache ({cacheSize} MB)</button>
        <label className="toggle-row">
          <span>Check for updates</span>
          <input type="checkbox" checked={Boolean(configData.checkUpdates)} onChange={updateCheckSetting} />
        </label>
        <div className="donate-box">
          <p>Please donate to support the project.</p>
          <button type="button" className="primary-button" onClick={() => openExternalLink('https://www.liqpay.ua/en/checkout/shtvrplayer')}>Donate</button>
          <a href="#" onClick={(event) => { event.preventDefault(); openExternalLink('https://gitlab.com/go-apps-XnjRcS/vr-viewer-for-linux/electron-version/-/blob/master/CHANGELOG.md'); }}>View changelog</a>
        </div>
      </div>

      <div className="slider-wrap">
        <label htmlFor="sizeRange">Thumbnail size</label>
        <input id="sizeRange" type="range" min="100" max="435" value={maxSizePx} onChange={(event) => setMaxSizePx(Number(event.target.value))} />
      </div>
    </div>
  );
}

export default App;
