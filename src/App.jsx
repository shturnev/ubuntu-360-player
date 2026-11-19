import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './App.scss';
import AppHeader from './components/AppHeader.jsx';
import EmptyLibraryState from './components/EmptyLibraryState.jsx';
import LoadingProgress from './components/LoadingProgress.jsx';
import MediaGrid from './components/MediaGrid.jsx';
import NoticeBanner from './components/NoticeBanner.jsx';
import SelectionBar from './components/SelectionBar.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import ViewerOverlay from './components/ViewerOverlay.jsx';
import { isConvertedVideoName } from './mediaUtils.js';
import { shortcutKey } from './shortcutKey.js';
import ShortcutList from './components/ShortcutList.jsx';

const EMPTY_PROGRESS = { show: false, total: 0, complete: 0 };

const getMediaIdentity = (item) => item?.origPath || item?.bigName || item?.thumpName || '';

function App() {
  const [selectedPath, setSelectedPath] = useState('');
  const [items, setItems] = useState([]);
  const [maxSizePx, setMaxSizePx] = useState(150);
  const [loadingProgress, setLoadingProgress] = useState(EMPTY_PROGRESS);
  const [insvProgress, setInsvProgress] = useState('');
  const [exportProgress, setExportProgress] = useState(EMPTY_PROGRESS);
  const [showingItem, setShowingItem] = useState(null);
  const [flatView, setFlatView] = useState(false);
  const [cacheSize, setCacheSize] = useState(0);
  const [configData, setConfigData] = useState({});
  const [updateState, setUpdateState] = useState({ status: 'idle', info: null, progress: 0 });
  const [canOpenDir, setCanOpenDir] = useState(true);
  const [canSelect, setCanSelect] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [savingMedia, setSavingMedia] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
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
  const [metadata, setMetadata] = useState({ identity: '', status: 'idle', entries: [], error: '' });
  const [viewerRevision, setViewerRevision] = useState(0);
  const showingItemIdRef = useRef('');
  const metadataRequestIdRef = useRef(0);
  const viewerRef = useRef(null);
  const directoryRequestInProgress = useRef(false);
  const appendImport = useRef(false);
  const mediaSaveInProgress = useRef(false);
  const exportRequestId = useRef(0);
  const activeExportId = useRef(null);
  const lensRequestIdRef = useRef(0);
  const activeLensRequestRef = useRef(null);
  const api = typeof window !== 'undefined' ? window.shtVR : null;

  const cancelInsvLensCorrection = (origPath) => {
    const active = activeLensRequestRef.current;
    if (!active || (origPath && active.origPath !== origPath)) return;
    activeLensRequestRef.current = null;
    if (active.insp) api?.cancelInspLensCorrection?.(active);
    else api?.cancelInsvLensCorrection?.(active);
  };

  const closeViewer = () => {
    cancelInsvLensCorrection();
    setShowingItem(null);
    setFlatView(false);
    setPlaybackFailedVideoId('');
    setMetadata({ identity: '', status: 'idle', entries: [], error: '' });
  };

  const totalSelected = useMemo(() => items.filter((item) => item.selected).length, [items]);

  useEffect(() => {
    let depth = 0;
    const isFileDrag = (event) =>
      Array.from(event.dataTransfer?.types || []).includes('Files') ||
      Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file') ||
      Boolean(event.dataTransfer?.files?.length);
    const reset = () => {
      depth = 0;
      setFileDragActive(false);
    };
    const enter = (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth += 1;
      setFileDragActive(true);
    };
    const over = (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setFileDragActive(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setFileDragActive(false);
    };
    const drop = async (event) => {
      const hasFiles = isFileDrag(event);
      reset();
      if (!hasFiles) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files || []);
      try {
        if (!api?.importDroppedFiles) throw new Error('Importing dropped files is unavailable.');
        const result = await api.importDroppedFiles(files);
        if (!result?.success) throw new Error(result?.message || 'Unable to import dropped files.');
      } catch (error) {
        setErrorMessage(error?.message || 'Unable to import dropped files.');
      }
    };
    const blur = (event) => {
      if (event.target === window) reset();
    };
    const handlers = { dragenter: enter, dragover: over, dragleave: leave, drop, dragend: reset, blur };
    Object.entries(handlers).forEach(([name, handler]) => window.addEventListener(name, handler, true));
    return () => {
      Object.entries(handlers).forEach(([name, handler]) => window.removeEventListener(name, handler, true));
    };
  }, [api]);

  useEffect(() => {
    if (!api) {
      return undefined;
    }

    const handlers = {
      'start-file-server': (_, url) => setServerUrl(url || ''),
      'config-data': (_, data) => setConfigData((prev) => ({ ...prev, ...(data || {}) })),
      'open-dir': (_, value) => {
        if (!value) {
          directoryRequestInProgress.current = false;
          setCanOpenDir(true);
          return;
        }
        setSelectedPath(value);
        setCanOpenDir(false);
      },
      'add-files': (_, value) => {
        if (!value) {
          directoryRequestInProgress.current = false;
          setCanOpenDir(true);
        }
      },
      'start-read-dir': (_, total) => {
        setInsvProgress('');
        appendImport.current = false;
        directoryRequestInProgress.current = true;
        setCanOpenDir(false);
        closeViewer();
        setMetadata({ identity: '', status: 'idle', entries: [], error: '' });
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
      'start-read-files': (_, total) => {
        setInsvProgress('');
        appendImport.current = true;
        directoryRequestInProgress.current = true;
        setCanOpenDir(false);
        const totalFiles = Number(total) || 0;
        setLoadingProgress(totalFiles > 0 ? { show: true, total: totalFiles, complete: 0 } : EMPTY_PROGRESS);
      },
      'import-finished': () => {
        setInsvProgress('');
        setLoadingProgress(EMPTY_PROGRESS);
        setCanOpenDir(true);
        directoryRequestInProgress.current = false;
        request('get-cache-size', null);
      },
      'export-progress': (_, progress) => {
        if (
          activeExportId.current === null ||
          progress?.requestId !== activeExportId.current ||
          !Number.isSafeInteger(progress?.total) ||
          progress.total <= 0 ||
          !Number.isSafeInteger(progress.complete) ||
          progress.complete < 0 ||
          progress.complete > progress.total
        )
          return;
        setExportProgress({ show: true, total: progress.total, complete: progress.complete });
      },
      'read-media-file': (_, data) => {
        setLoadingProgress((prev) => {
          const complete = prev.complete + 1;
          return { ...prev, complete };
        });

        if (!data || data.error) {
          if (data && data.error) {
            setErrorMessage(data.error.message || 'Unable to read media');
          }
          return;
        }

        if (appendImport.current) setSelectedPath('Media files');
        setItems((current) =>
          [...current, data].sort((a, b) => String(a.thumpName).localeCompare(String(b.thumpName)))
        );
      },
      'insv-progress': (_, progress) => {
        setInsvProgress(
          progress?.active && progress.name
            ? `File ${progress.name}: ${progress.stage === 'checking' ? 'checking stabilization' : 'stabilizing'}, please wait…`
            : ''
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
        setInsvProgress('');
        setCacheSize(0);
        setLoadingProgress(EMPTY_PROGRESS);
        setItems([]);
        setCanSelect(false);
        setShowingItem(null);
        setFlatView(false);
        setCanOpenDir(true);
        directoryRequestInProgress.current = false;
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
          setPlaybackFailedVideoId((current) => (current === getMediaIdentity(data) ? '' : current));
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
      'media-metadata': (_, data) => {
        if (!data || data.origPath !== showingItemIdRef.current) return;
        setMetadata((current) => {
          if (
            current.status !== 'loading' ||
            current.identity !== data.origPath ||
            current.requestId !== data.requestId
          ) {
            return current;
          }
          return {
            identity: data.origPath,
            requestId: data.requestId,
            status: data.error ? 'error' : 'ready',
            entries: Array.isArray(data.entries) ? data.entries : [],
            error: data.error || '',
          };
        });
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
    api.send('renderer-ready');

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

  useEffect(() => {
    showingItemIdRef.current = getMediaIdentity(showingItem);
  }, [showingItem]);

  useEffect(() => {
    const origPath = showingItem?.origPath;
    return () => cancelInsvLensCorrection(origPath);
  }, [showingItem?.origPath, api]);

  const openExternalLink = async (url) => {
    try {
      if (api && typeof api.openExternal === 'function') {
        const opened = await api.openExternal(url);
        if (opened === false) {
          setErrorMessage('Unable to open external link');
        }
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

  const openDirectory = () => {
    if (!canOpenDir || directoryRequestInProgress.current || !api || typeof api.send !== 'function') return;
    directoryRequestInProgress.current = true;
    setCanOpenDir(false);
    request('open-dir', true);
  };

  const addFiles = () => {
    if (!canOpenDir || directoryRequestInProgress.current || !api || typeof api.send !== 'function') return;
    directoryRequestInProgress.current = true;
    setCanOpenDir(false);
    request('add-files');
  };

  const saveCurrentMedia = async () => {
    if (!showingItem?.origPath || mediaSaveInProgress.current) return;
    if (showingItem.insv) {
      setErrorMessage('Exporting INSV pairs is not available.');
      return;
    }
    mediaSaveInProgress.current = true;
    setSavingMedia(true);
    try {
      if (!api || typeof api.saveCurrentMedia !== 'function') {
        throw new Error('Saving media is unavailable.');
      }
      const result = await api.saveCurrentMedia({ origPath: showingItem.origPath });
      if (!result?.success && !result?.cancelled) throw new Error(result?.message || 'Unable to save media.');
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to save media.');
    } finally {
      mediaSaveInProgress.current = false;
      setSavingMedia(false);
    }
  };

  const saveSelectedMedia = async () => {
    if (items.some((item) => item.selected && item.insv)) {
      setErrorMessage('Exporting INSV pairs is not available.');
      return;
    }
    const origPaths = items.filter((item) => item.selected).map((item) => item.origPath);
    if (!origPaths.length || mediaSaveInProgress.current) return;
    mediaSaveInProgress.current = true;
    setSavingMedia(true);
    const requestId = ++exportRequestId.current;
    activeExportId.current = requestId;
    try {
      if (!api || typeof api.saveSelectedMedia !== 'function') throw new Error('Saving media is unavailable.');
      const result = await api.saveSelectedMedia(origPaths, requestId);
      if (result?.cancelled) return;
      if (result?.errors?.length) {
        const failures = result.errors.map((error) => `${error.origPath}: ${error.message}`).join('; ');
        throw new Error(`Saved ${result.saved} file(s). Failed to save: ${failures}`);
      }
      if (!result?.success) throw new Error(result?.message || 'Unable to save selected media.');
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to save selected media.');
    } finally {
      activeExportId.current = null;
      setExportProgress(EMPTY_PROGRESS);
      mediaSaveInProgress.current = false;
      setSavingMedia(false);
    }
  };

  useEffect(() => {
    const handleShortcut = (event) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.metaKey) return;
      const key = shortcutKey(event);
      const action =
        event.ctrlKey && event.shiftKey && key === 'o'
          ? 'add-files'
          : !event.shiftKey && event.ctrlKey && ['o', 'p', 's'].includes(key)
            ? key
            : !event.shiftKey && !event.ctrlKey && key === 'f1'
              ? key
              : '';
      if (!action) return;
      // Suppress Chromium defaults even when the app action is blocked by a dialog or editable field.
      event.preventDefault();
      if (
        event.repeat ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) ||
        event.target?.isContentEditable ||
        event.target?.closest?.('[contenteditable]:not([contenteditable="false"])')
      )
        return;
      if (showSettings || document.querySelector('[aria-modal="true"], .orientation-correction')) return;
      if (action === 'o') openDirectory();
      if (action === 'add-files') addFiles();
      if (action === 'p') viewerRef.current?.saveScreenshot();
      if (action === 's') saveCurrentMedia();
      if (action === 'f1') setShowSettings(true);
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  });

  const toggleSelection = (index) => {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, selected: !item.selected } : item))
    );
  };

  const toggleSelectionAll = (selectAll) => {
    setItems((current) => current.map((item) => ({ ...item, selected: selectAll })));
  };

  const clearSelected = () => {
    request(
      'remove-from-library',
      items.filter((item) => item.selected)
    );
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

    if (selectedItems.some((entry) => entry.insv)) {
      setErrorMessage('Deleting INSV pairs is not available.');
      return;
    }
    const count = selectedItems.length;
    const confirmed = window.confirm(
      count > 1
        ? `Move ${count} original files to the Recycle Bin / Trash and remove them from the library?`
        : 'Move the original file to the Recycle Bin / Trash and remove it from the library?'
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

  const openMetadata = () => {
    if (!showingItem?.origPath) return;
    const identity = getMediaIdentity(showingItem);
    const requestId = ++metadataRequestIdRef.current;
    setMetadata({ identity, requestId, status: 'loading', entries: [], error: '' });
    request('get-media-metadata', { origPath: showingItem.origPath, type: showingItem.type, requestId });
  };

  const savePanoramaScreenshot = async (data) => {
    if (!api || typeof api.savePanoramaScreenshot !== 'function') {
      throw new Error('Saving screenshots is unavailable.');
    }

    try {
      const result = await api.savePanoramaScreenshot({ data });
      if (result?.success || result?.cancelled) return result;
    } catch (error) {
      // The renderer only exposes a controlled message, not IPC details.
    }
    throw new Error('Unable to save the 360° screenshot.');
  };

  const saveOrientationCorrection = async (orientation) => {
    if (!showingItem?.origPath || !api || typeof api.saveOrientationCorrection !== 'function') {
      throw new Error('Saving orientation corrections is unavailable.');
    }

    const origPath = showingItem.origPath;
    let request;
    if (showingItem.insp) {
      if (activeLensRequestRef.current) throw new Error('Another lens or orientation correction is still processing.');
      request = { origPath, requestId: ++lensRequestIdRef.current, insp: true, orientation: true };
      activeLensRequestRef.current = request;
    }
    try {
      const result = await api.saveOrientationCorrection({
        origPath,
        orientation,
        ...(request ? { requestId: request.requestId } : {}),
      });
      if (request && activeLensRequestRef.current !== request)
        throw new Error('The orientation correction was cancelled.');
      if (!result?.success) throw new Error(result?.message || 'Unable to save orientation correction.');
      setViewerRevision((current) => current + 1);
      const update = (item) =>
        item.origPath === origPath
          ? {
              ...item,
              ...(request && result.bigName
                ? { bigName: result.bigName, thumpName: result.thumpName || result.bigName }
                : {}),
              thumbnailRevision: Date.now(),
            }
          : item;
      setItems((current) => current.map(update));
      if (request) setShowingItem((current) => (current ? update(current) : current));
    } finally {
      if (request && activeLensRequestRef.current === request) activeLensRequestRef.current = null;
    }
  };

  const updateCheckSetting = () => {
    const nextValue = !configData.checkUpdates;
    const payload = { ...configData, checkUpdates: nextValue };
    setConfigData(payload);
    request('save-config', { checkUpdates: nextValue });
    if (nextValue) {
      request('check-for-update', null);
    }
  };

  const saveInsvLensFov = async (value) => {
    if (typeof api?.saveInsvLensFov !== 'function') throw new Error('Saving INSV lens FOV is unavailable.');
    const result = await api.saveInsvLensFov(value);
    if (!result?.success) throw new Error(result?.message || 'Unable to save the INSV lens FOV.');
    setConfigData((current) => ({ ...current, insvLensFov: result.insvLensFov }));
  };

  const saveInspLensFov = async (value) => {
    if (typeof api?.saveInspLensFov !== 'function') throw new Error('Saving INSP lens FOV is unavailable.');
    const result = await api.saveInspLensFov(value);
    if (!result?.success) throw new Error(result?.message || 'Unable to save the INSP lens FOV.');
    setConfigData((current) => ({ ...current, inspLensFov: result.inspLensFov }));
  };

  const saveInsvLensCorrection = async (value) => {
    const origPath = showingItem?.origPath;
    const insp = Boolean(showingItem?.insp);
    const save = insp ? api?.saveInspLensCorrection : api?.saveInsvLensCorrection;
    if ((!showingItem?.insv && !insp) || !origPath || typeof save !== 'function') {
      throw new Error('Saving lens corrections is unavailable.');
    }
    if (activeLensRequestRef.current) throw new Error('Another lens correction is still processing.');
    const request = { origPath, requestId: ++lensRequestIdRef.current, ...(insp ? { insp: true } : {}) };
    activeLensRequestRef.current = request;
    try {
      const result = await save({ ...request, value });
      if (activeLensRequestRef.current !== request) throw new Error('The lens correction was cancelled.');
      if (!result?.success) throw new Error(result?.message || 'Unable to save the lens correction.');
      const update = (item) =>
        item.origPath === origPath
          ? {
              ...item,
              thumpName: result.thumpName,
              bigName: result.bigName || result.thumpName,
              lensFieldOfView: result.lensFieldOfView,
              lensFovOverride: result.lensFovOverride,
              ...(insp ? { legacyInsp: false } : {}),
            }
          : item;
      setItems((current) => current.map(update));
      setShowingItem((current) => (current ? update(current) : current));
      return result;
    } finally {
      if (activeLensRequestRef.current === request) activeLensRequestRef.current = null;
    }
  };

  const viewerSrc = showingItem
    ? `${serverUrl}big/${encodeURIComponent(showingItem.bigName)}${viewerRevision ? `?revision=${viewerRevision}` : ''}`
    : '';
  const hasConvertedVideo = Boolean(
    showingItem && (convertedVideos.has(showingItem.origPath) || isConvertedVideoName(showingItem.bigName))
  );
  const showingItemId = getMediaIdentity(showingItem);
  const hasPlaybackFailure = Boolean(
    showingItem && showingItem.type === 'video' && showingItemId === playbackFailedVideoId
  );
  const downloadUpdate = () => {
    request('download-update', null);
    setUpdateState((current) => ({ ...current, status: 'downloading', progress: 0 }));
  };
  const isEmptyLibrary = items.length === 0 && !loadingProgress.show;
  const shortcutHints = (
    <section className="home-shortcuts" aria-labelledby="home-shortcuts-title">
      <h2 id="home-shortcuts-title">Keyboard shortcuts</h2>
      <ShortcutList />
    </section>
  );
  const errorNotice = errorMessage && (
    <NoticeBanner kind="error" title={errorMessage} onDismiss={() => setErrorMessage('')} />
  );
  const importProgress = loadingProgress.show && (
    <LoadingProgress complete={loadingProgress.complete} total={loadingProgress.total} detail={insvProgress} />
  );

  return (
    <div className="app-shell">
      {fileDragActive &&
        createPortal(
          <div className="file-drop-overlay" role="status">
            Drop media files to add to your library
          </div>,
          document.fullscreenElement || document.body
        )}
      <AppHeader
        version={configData.version}
        selectedPath={selectedPath}
        maxSizePx={maxSizePx}
        sliderDisabled={items.length === 0}
        canOpenDir={canOpenDir}
        canSelectMedia={items.length > 0}
        showCloseViewer={Boolean(showingItem)}
        showSettings={showSettings}
        onOpenDir={openDirectory}
        onAddFiles={addFiles}
        onToggleSelection={() => setCanSelect((value) => !value)}
        onCloseViewer={closeViewer}
        onToggleSettings={() => setShowSettings((value) => !value)}
        onThumbnailSizeChange={setMaxSizePx}
      />

      {!showingItem && errorNotice}

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
          saving={savingMedia}
          onSave={saveSelectedMedia}
          onToggleAll={() => toggleSelectionAll(!totalSelected)}
          onClear={clearSelected}
          onDelete={() => handleDelete(null)}
          onClose={() => setCanSelect(false)}
        />
      )}

      {isEmptyLibrary && (
        <EmptyLibraryState onOpenDir={openDirectory} onAddFiles={addFiles} disabled={!canOpenDir}>
          {shortcutHints}
        </EmptyLibraryState>
      )}

      {!showingItem && importProgress}
      {exportProgress.show && (
        <LoadingProgress
          complete={exportProgress.complete}
          total={exportProgress.total}
          label="Exporting"
          finishedLabel="Processed"
        />
      )}

      <MediaGrid
        items={items}
        serverUrl={serverUrl}
        maxSizePx={maxSizePx}
        canSelect={canSelect}
        onToggleSelection={toggleSelection}
        onOpenItem={(item) => {
          setPlaybackFailedVideoId('');
          setMetadata({ identity: '', status: 'idle', entries: [], error: '' });
          setShowingItem(item);
        }}
      />

      {showingItem && (
        <ViewerOverlay
          ref={viewerRef}
          importStatus={
            (errorNotice || importProgress) && (
              <div className="viewer-import-status">
                {errorNotice}
                {importProgress}
              </div>
            )
          }
          shortcutsBlocked={showSettings}
          showingItem={showingItem}
          items={items}
          viewerSrc={viewerSrc}
          insvSources={
            showingItem.insv && showingItem.insvToken
              ? [0, 1].map((lens) => `${serverUrl}insv/${encodeURIComponent(showingItem.insvToken)}/${lens}`)
              : undefined
          }
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
          metadata={metadata}
          onOpenMetadata={openMetadata}
          onCloseMetadata={() => setMetadata((current) => ({ ...current, status: 'idle' }))}
          onSaveScreenshot={savePanoramaScreenshot}
          onScreenshotError={setErrorMessage}
          onSaveOrientation={saveOrientationCorrection}
          onSaveInsvLensCorrection={saveInsvLensCorrection}
          onCancelInsvLensCorrection={() => {
            if (!activeLensRequestRef.current?.orientation) cancelInsvLensCorrection(showingItem.origPath);
          }}
          onDelete={() => handleDelete(showingItem)}
          onPrevious={() => {
            if (items.length < 2) return;
            cancelInsvLensCorrection(showingItem.origPath);
            const currentIndex = items.findIndex(
              (item) => item.origPath === showingItem.origPath && item.bigName === showingItem.bigName
            );
            const previousIndex = (currentIndex - 1 + items.length) % items.length;
            setPlaybackFailedVideoId('');
            setMetadata({ identity: '', status: 'idle', entries: [], error: '' });
            setShowingItem({ ...items[previousIndex], index: previousIndex });
          }}
          onNext={() => {
            if (items.length < 2) return;
            cancelInsvLensCorrection(showingItem.origPath);
            const currentIndex = items.findIndex(
              (item) => item.origPath === showingItem.origPath && item.bigName === showingItem.bigName
            );
            const nextIndex = (currentIndex + 1) % items.length;
            setPlaybackFailedVideoId('');
            setMetadata({ identity: '', status: 'idle', entries: [], error: '' });
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
              inspLensFov={configData.inspLensFov}
              onSaveInspLensFov={saveInspLensFov}
              insvLensFov={configData.insvLensFov}
              onSaveInsvLensFov={saveInsvLensFov}
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
