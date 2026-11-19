import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import PanoramaViewer from '../PanoramaViewer.jsx';
import InsvViewer from './InsvViewer.jsx';
import { shortcutKey } from '../shortcutKey.js';
import lensFov from '../lensFov.json';
import './PanoramaViewer.scss';

const OpenFullScreenIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="m15 15l6 6M15 9l6-6m0 13v5h-5m5-13V3h-5M3 16v5h5m-5 0l6-6M3 8V3h5m1 6L3 3"
    />
  </svg>
);

const CloseFullScreenIcon = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    {...props}
  >
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="m15 15l6 6m-6-6v4.8m0-4.8h4.8M9 19.8V15m0 0H4.2M9 15l-6 6M15 4.2V9m0 0h4.8M15 9l6-6M9 4.2V9m0 0H4.2M9 9L3 3"
    />
  </svg>
);

const InfoIcon = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    {...props}
  >
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4m0-4h.01" />
    </g>
  </svg>
);

const ArrowLeftIcon = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    {...props}
  >
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="m12 19l-7-7l7-7m7 7H5"
    />
  </svg>
);

const ArrowRightIcon = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    {...props}
  >
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M5 12h14m-7-7l7 7l-7 7"
    />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const CameraIcon = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    {...props}
  >
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
      <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
      <circle cx="12" cy="13" r="3" />
    </g>
  </svg>
);

const OrientationIcon = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    {...props}
  >
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M10 5H3m9 14H3M14 3v4m2 10v4m5-9h-9m9 7h-5m5-14h-7m-6 5v4m0-2H3"
    />
  </svg>
);

const LensIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <circle cx="12" cy="12" r="9" strokeWidth="2" />
    <circle cx="12" cy="12" r="4" strokeWidth="2" />
    <path d="M12 3v3m0 12v3" strokeWidth="2" />
  </svg>
);

const DEFAULT_ORIENTATION = { yaw: 0, pitch: 0, roll: 0 };
const ORIENTATION_CONTROLS = [
  { key: 'yaw', label: 'Yaw', min: -180, max: 180 },
  { key: 'pitch', label: 'Pitch', min: -90, max: 90 },
  { key: 'roll', label: 'Roll', min: -180, max: 180 },
];

const getMediaFileName = (item) =>
  String(item?.origPath || item?.bigName || '')
    .split(/[\\/]/)
    .pop();

const ViewerOverlay = forwardRef(function ViewerOverlay(
  {
    showingItem,
    items,
    viewerSrc,
    insvSources,
    flatView,
    conversionProgress,
    hasConvertedVideo,
    hasPlaybackFailure,
    onConvertVideo,
    onVideoPlaybackFailure,
    onVideoPlaybackSuccess,
    onClose,
    onToggleFlatView,
    onDelete,
    onPrevious,
    onNext,
    onOpenExternal,
    metadata,
    onOpenMetadata,
    onCloseMetadata,
    onSaveScreenshot,
    onScreenshotError,
    onSaveOrientation,
    onSaveInsvLensCorrection,
    onCancelInsvLensCorrection,
    shortcutsBlocked,
    importStatus,
  },
  ref
) {
  const panelRef = useRef(null);
  const metadataDialogRef = useRef(null);
  const metadataButtonRef = useRef(null);
  const panoramaRef = useRef(null);
  const flatVideoRef = useRef(null);
  const flatVideoFrameTimer = useRef(null);
  const flatVideoHasFrame = useRef(false);
  const screenshotSaveInProgress = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canSaveScreenshot, setCanSaveScreenshot] = useState(false);
  const [isSavingScreenshot, setIsSavingScreenshot] = useState(false);
  const [orientationOpen, setOrientationOpen] = useState(false);
  const [orientation, setOrientation] = useState(DEFAULT_ORIENTATION);
  const [isSavingOrientation, setIsSavingOrientation] = useState(false);
  const [orientationSaveError, setOrientationSaveError] = useState('');
  const [lensOpen, setLensOpen] = useState(false);
  const [lensValue, setLensValue] = useState(String(showingItem.lensFieldOfView ?? ''));
  const [lensStatus, setLensStatus] = useState('');
  const [savingLens, setSavingLens] = useState(false);
  const lensOperationRef = useRef(0);
  const convertButton =
    showingItem.type === 'video' &&
    !showingItem.insv &&
    hasPlaybackFailure &&
    onConvertVideo &&
    !conversionProgress?.active &&
    !hasConvertedVideo;
  const usePanoramaRenderer = !flatView || orientationOpen;

  useEffect(() => {
    setOrientationOpen(false);
    setOrientation(DEFAULT_ORIENTATION);
    setOrientationSaveError('');
  }, [showingItem?.origPath, showingItem?.bigName]);

  useEffect(() => {
    lensOperationRef.current += 1;
    setLensOpen(false);
    setLensValue(String(showingItem?.lensFieldOfView ?? ''));
    setLensStatus('');
    setSavingLens(false);
  }, [showingItem?.origPath]);

  useEffect(() => {
    flatVideoHasFrame.current = false;
    clearTimeout(flatVideoFrameTimer.current);
    flatVideoFrameTimer.current = null;

    return () => {
      clearTimeout(flatVideoFrameTimer.current);
      flatVideoFrameTimer.current = null;
    };
  }, [flatView, orientationOpen, showingItem?.origPath, showingItem?.bigName]);

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsFullscreen(Boolean(panelRef.current && document.fullscreenElement === panelRef.current));
    };

    updateFullscreenState();
    document.addEventListener('fullscreenchange', updateFullscreenState);
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState);
  }, []);

  const metadataOpen = Boolean(metadata && metadata.status !== 'idle');
  const fileName = getMediaFileName(showingItem);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (metadataOpen || shortcutsBlocked) return;
      if (lensOpen && event.key === 'Escape') {
        event.preventDefault();
        closeLensCorrection();
        return;
      }
      if (orientationOpen && event.key === 'Escape') {
        event.preventDefault();
        setOrientationOpen(false);
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable) return;

      if (event.key === ' ' || event.key === 'Spacebar') {
        if (showingItem?.type !== 'video' || event.repeat || event.target?.closest?.('button, a')) return;

        event.preventDefault();
        if (flatView && !orientationOpen && !showingItem.insv) {
          const video = flatVideoRef.current;
          if (!video) return;
          if (video.paused) {
            video.play()?.catch(() => onVideoPlaybackFailure?.());
          } else {
            video.pause();
          }
          return;
        }
        panoramaRef.current?.togglePlayback?.();
      } else if (items.length >= 2 && event.key === 'ArrowLeft') {
        event.preventDefault();
        onPrevious?.();
      } else if (items.length >= 2 && event.key === 'ArrowRight') {
        event.preventDefault();
        onNext?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    flatView,
    items.length,
    metadataOpen,
    lensOpen,
    onNext,
    onPrevious,
    onVideoPlaybackFailure,
    orientationOpen,
    showingItem?.type,
    showingItem?.insv,
    shortcutsBlocked,
  ]);

  useEffect(() => {
    if (!metadataOpen) return undefined;

    const opener = metadataButtonRef.current;
    const dialog = metadataDialogRef.current;
    const focusableElements = () =>
      dialog?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || [];
    focusableElements()[0]?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseMetadata?.();
        return;
      }

      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      opener?.focus();
    };
  }, [metadataOpen, onCloseMetadata]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.key === 'Escape' &&
        panelRef.current &&
        document.fullscreenElement === panelRef.current &&
        typeof document.exitFullscreen === 'function'
      ) {
        document.exitFullscreen();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleFullscreen = async () => {
    const panel = panelRef.current;
    if (!panel) return;

    try {
      if (document.fullscreenElement === panel) {
        if (typeof document.exitFullscreen === 'function') {
          await document.exitFullscreen();
        }
        return;
      }

      if (typeof panel.requestFullscreen === 'function') {
        await panel.requestFullscreen();
      }
    } catch (error) {
      // Ignore browser or permission blocking; users can still use the standard fullscreen controls.
    }
  };

  const clearFlatVideoFrameTimer = () => {
    clearTimeout(flatVideoFrameTimer.current);
    flatVideoFrameTimer.current = null;
  };

  const reportFlatVideoFailure = () => {
    clearFlatVideoFrameTimer();
    onVideoPlaybackFailure?.();
  };

  const handleFlatVideoLoadedData = () => {
    flatVideoHasFrame.current = true;
    clearFlatVideoFrameTimer();
  };

  const handleFlatVideoPlaying = () => {
    if (flatVideoHasFrame.current || flatVideoFrameTimer.current) return;

    flatVideoFrameTimer.current = setTimeout(() => {
      flatVideoFrameTimer.current = null;
      if (!flatVideoHasFrame.current) reportFlatVideoFailure();
    }, 4000);
  };

  const openMetadata = () => {
    if (showingItem.type === 'video') {
      if (flatView && !orientationOpen && !showingItem.insv) {
        flatVideoRef.current?.pause();
      } else {
        panoramaRef.current?.pause?.();
      }
    }
    onOpenMetadata?.();
  };

  const toggleOrientationCorrection = () => {
    if (showingItem.insv) return;
    if (!flatView) {
      onToggleFlatView?.();
      setOrientationOpen(true);
      return;
    }

    setOrientationOpen((open) => !open);
  };

  useEffect(() => {
    const handleViewerShortcut = (event) => {
      const key = shortcutKey(event);
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey ||
        !['i', 'o'].includes(key) ||
        metadataOpen ||
        (key === 'i' && orientationOpen) ||
        shortcutsBlocked ||
        document.querySelector('[aria-modal="true"]') ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) ||
        event.target?.isContentEditable ||
        event.target?.closest?.('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      event.preventDefault();
      if (key === 'i') openMetadata();
      else toggleOrientationCorrection();
    };

    document.addEventListener('keydown', handleViewerShortcut);
    return () => document.removeEventListener('keydown', handleViewerShortcut);
  });

  const saveScreenshot = async () => {
    if (
      (flatView && !showingItem.insv) ||
      orientationOpen ||
      metadataOpen ||
      shortcutsBlocked ||
      !canSaveScreenshot ||
      screenshotSaveInProgress.current ||
      !panoramaRef.current ||
      !onSaveScreenshot
    )
      return;

    screenshotSaveInProgress.current = true;
    setIsSavingScreenshot(true);
    try {
      const screenshot = await panoramaRef.current.captureScreenshot();
      const data = await screenshot.arrayBuffer();
      const result = await onSaveScreenshot(data);
      if (result?.success || result?.cancelled) return;
      throw new Error('Unable to save the 360° screenshot.');
    } catch (error) {
      onScreenshotError?.(error?.message || 'Unable to save the 360° screenshot.');
    } finally {
      screenshotSaveInProgress.current = false;
      setIsSavingScreenshot(false);
    }
  };

  useImperativeHandle(ref, () => ({ saveScreenshot }));

  const setOrientationValue = (key, value) => {
    if (!Number.isFinite(value)) return;
    setOrientation((current) => ({ ...current, [key]: value }));
  };

  const saveOrientation = async () => {
    if (!onSaveOrientation || isSavingOrientation) return;

    setIsSavingOrientation(true);
    setOrientationSaveError('');
    try {
      await onSaveOrientation(orientation);
      setOrientation(DEFAULT_ORIENTATION);
      setOrientationOpen(false);
    } catch (error) {
      setOrientationSaveError(error?.message || 'Unable to save orientation correction.');
    } finally {
      setIsSavingOrientation(false);
    }
  };

  function closeLensCorrection() {
    lensOperationRef.current += 1;
    onCancelInsvLensCorrection?.();
    setSavingLens(false);
    setLensOpen(false);
    setLensStatus('');
  }

  const saveLensCorrection = async (value) => {
    if (savingLens || !onSaveInsvLensCorrection) return;
    if (
      value !== null &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < lensFov.minimum ||
        value > lensFov.maximum ||
        Math.abs(value * 10 - Math.round(value * 10)) > 1e-8)
    ) {
      setLensStatus('Enter a value between 180 and 220 degrees in 0.1 degree steps.');
      return;
    }
    const operation = ++lensOperationRef.current;
    setSavingLens(true);
    setLensStatus('');
    try {
      const result = await onSaveInsvLensCorrection(value);
      if (lensOperationRef.current !== operation) return;
      setLensValue(String(result.lensFieldOfView));
      setLensStatus(value === null ? 'Using the current global default.' : 'Lens correction saved.');
    } catch (error) {
      if (lensOperationRef.current === operation) {
        setLensStatus(error?.message || 'Unable to save the lens correction.');
      }
    } finally {
      if (lensOperationRef.current === operation) setSavingLens(false);
    }
  };

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div ref={panelRef} className="viewer-panel" onClick={(event) => event.stopPropagation()}>
        {importStatus}
        <button type="button" className="close-viewer" onClick={onClose}>
          ✕
        </button>
        {showingItem.insv ? (
          <InsvViewer
            ref={panoramaRef}
            sources={insvSources}
            frameRate={showingItem.frameRate}
            lensFieldOfView={showingItem.lensFieldOfView}
            flatProjection={flatView}
            motionMode={showingItem.motionMode}
            motionWarning={showingItem.motionWarning}
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
            onCaptureReadyChange={setCanSaveScreenshot}
          />
        ) : usePanoramaRenderer ? (
          <PanoramaViewer
            ref={panoramaRef}
            source={viewerSrc}
            type={showingItem.type}
            alt={showingItem.bigName}
            onOpenExternal={onOpenExternal}
            showConvertVideo={convertButton}
            onConvertVideo={onConvertVideo}
            onVideoPlaybackFailure={onVideoPlaybackFailure}
            onVideoPlaybackSuccess={onVideoPlaybackSuccess}
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
            onCaptureReadyChange={setCanSaveScreenshot}
            orientation={orientation}
            flatProjection={flatView}
            isOrientationEditing={orientationOpen}
            onOrientationChange={setOrientation}
            showAlignmentGuides={flatView && orientationOpen}
          />
        ) : showingItem.type === 'video' ? (
          <video
            ref={flatVideoRef}
            controls
            autoPlay
            src={viewerSrc}
            onLoadedData={handleFlatVideoLoadedData}
            onPlaying={handleFlatVideoPlaying}
            onPause={clearFlatVideoFrameTimer}
            onEnded={clearFlatVideoFrameTimer}
            onError={reportFlatVideoFailure}
          />
        ) : (
          <img src={viewerSrc} alt={showingItem.bigName} />
        )}
        {!showingItem.insv && flatView && !orientationOpen && showingItem.type === 'video' && hasPlaybackFailure && (
          <div className="error-block viewer-flat-error">
            <p role="status">Unable to play this video in Flat view.</p>
            <div className="error-block-actions">
              {convertButton && (
                <button type="button" className="primary-button" onClick={onConvertVideo}>
                  Convert / fix video
                </button>
              )}
              {onOpenExternal && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onOpenExternal('https://ffmpeg.org/download.html')}
                >
                  FFmpeg downloads and documentation
                </button>
              )}
            </div>
          </div>
        )}
        {showingItem.type === 'video' && conversionProgress?.active && (
          <div className="conversion-progress" role="status" aria-live="polite">
            <strong>{conversionProgress.message || 'Converting video…'}</strong>
            <div className="conversion-bar" aria-label="video conversion progress">
              <span style={{ width: `${Math.min(100, Math.max(0, Number(conversionProgress.percent) || 0))}%` }} />
            </div>
            <small>
              {Math.round(Number(conversionProgress.percent) || 0)}% •{' '}
              {Math.round((Number(conversionProgress.elapsedMs) || 0) / 1000)}s elapsed • ETA{' '}
              {conversionProgress.etaMs == null
                ? 'unknown'
                : `${Math.round((Number(conversionProgress.etaMs) || 0) / 1000)}s`}
            </small>
          </div>
        )}
        <div className="viewer-controls">
          <button type="button" onClick={onPrevious} disabled={items.length < 2} aria-label="Previous media">
            <ArrowLeftIcon />
          </button>
          <button type="button" onClick={onToggleFlatView} disabled={orientationOpen}>
            {flatView ? '360° view' : 'Flat view'}
          </button>

          <div className="viewer-center-controls">
            <button
              type="button"
              className="fullscreen-button"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? CloseFullScreenIcon() : OpenFullScreenIcon()}
            </button>
            {(!flatView || showingItem.insv) && canSaveScreenshot && (
              <button
                type="button"
                onClick={saveScreenshot}
                disabled={isSavingScreenshot}
                aria-label="Save screenshot"
                title="Save screenshot (Ctrl+P)"
                aria-busy={isSavingScreenshot}
              >
                {isSavingScreenshot ? 'Saving screenshot…' : <CameraIcon />}
              </button>
            )}
            {!showingItem.insv && (
              <button
                type="button"
                onClick={toggleOrientationCorrection}
                aria-expanded={orientationOpen}
                aria-controls="orientation-correction"
                aria-label="Adjust panorama orientation"
                title="Adjust panorama orientation (O)"
              >
                <OrientationIcon />
              </button>
            )}
            {(showingItem.insv || showingItem.insp) && (
              <button
                type="button"
                onClick={() => (lensOpen ? closeLensCorrection() : setLensOpen(true))}
                aria-expanded={lensOpen}
                aria-controls="lens-correction"
                aria-label="Adjust lens field of view"
                title="Adjust lens field of view"
              >
                <LensIcon />
              </button>
            )}
            <button
              ref={metadataButtonRef}
              type="button"
              onClick={openMetadata}
              title="Show media information (I)"
              aria-label="Info"
            >
              <InfoIcon />
            </button>
          </div>
          <button
            type="button"
            onClick={onDelete}
            disabled={Boolean(showingItem.insv)}
            title={showingItem.insv ? 'Deletion of INSV pairs is not available.' : 'Delete'}
          >
            Delete
          </button>
          <button type="button" onClick={onNext} disabled={items.length < 2} aria-label="Next media">
            <ArrowRightIcon />
          </button>
        </div>
        {orientationOpen && (
          <section
            id="orientation-correction"
            className="orientation-correction"
            aria-label="Panorama orientation correction"
          >
            <div className="orientation-correction-header">
              <div>
                <strong>Orientation correction</strong>
                <p>Drag the media to adjust yaw and pitch.</p>
              </div>
              <button
                type="button"
                className="icon-button small"
                onClick={() => setOrientationOpen(false)}
                aria-label="Close orientation correction"
              >
                <CloseIcon />
              </button>
            </div>
            {ORIENTATION_CONTROLS.map(({ key, label, min, max }) => (
              <label className="orientation-control" key={key}>
                <span>{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step="1"
                  value={orientation[key]}
                  onChange={(event) => setOrientationValue(key, event.target.valueAsNumber)}
                  aria-label={`${label} correction`}
                />
                <input
                  type="number"
                  min={min}
                  max={max}
                  step="1"
                  value={orientation[key]}
                  onChange={(event) => setOrientationValue(key, event.target.valueAsNumber)}
                  aria-label={`${label} correction value`}
                />
                <span>°</span>
              </label>
            ))}
            <button type="button" className="ghost-button" onClick={() => setOrientation(DEFAULT_ORIENTATION)}>
              Reset
            </button>
            {showingItem.type === 'image' && (
              <button type="button" className="primary-button" onClick={saveOrientation} disabled={isSavingOrientation}>
                {isSavingOrientation ? 'Saving…' : 'Save correction'}
              </button>
            )}
            {orientationSaveError && (
              <p className="orientation-save-error" role="alert">
                {orientationSaveError}
              </p>
            )}
          </section>
        )}
        {lensOpen && (showingItem.insv || showingItem.insp) && (
          <section
            id="lens-correction"
            className="lens-correction"
            aria-label={`${showingItem.insp ? 'INSP' : 'INSV'} lens correction`}
          >
            <div className="orientation-correction-header">
              <div>
                <strong>Lens field of view</strong>
                <p>One value for both lenses and axes. This does not replace factory calibration.</p>
              </div>
              <button
                type="button"
                className="icon-button small"
                onClick={closeLensCorrection}
                aria-label="Close lens correction"
              >
                <CloseIcon />
              </button>
            </div>
            <label className="lens-control">
              <span>Lens FOV (degrees)</span>
              <input
                type="number"
                min={lensFov.minimum}
                max={lensFov.maximum}
                step={lensFov.step}
                value={lensValue}
                disabled={savingLens}
                onChange={(event) => {
                  setLensValue(event.target.value);
                  setLensStatus('');
                }}
              />
            </label>
            <p className="lens-correction-help">
              180–220°, step 0.1°. Moving or changing {showingItem.insv ? 'either original' : 'the original'} starts a
              new correction.
            </p>
            <div className="lens-correction-actions">
              <button
                type="button"
                className="ghost-button"
                disabled={savingLens}
                onClick={() => saveLensCorrection(null)}
              >
                Use global default
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={savingLens}
                onClick={() => saveLensCorrection(lensValue.trim() === '' ? NaN : Number(lensValue))}
              >
                {savingLens ? 'Saving…' : 'Save lens correction'}
              </button>
            </div>
            <p role="status" className="lens-correction-help">
              {lensStatus ||
                (showingItem.legacyInsp
                  ? 'Using the older cached image (199°); restitching requires confirmation.'
                  : showingItem.lensFovOverride
                    ? 'Using a saved override.'
                    : 'Using the import default.')}
            </p>
          </section>
        )}
        {metadataOpen && (
          <div className="metadata-backdrop" onClick={onCloseMetadata}>
            <section
              ref={metadataDialogRef}
              className="metadata-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="media-info-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="metadata-dialog-header">
                <h2 id="media-info-title">Media information</h2>
                <button
                  type="button"
                  className="icon-button small"
                  onClick={onCloseMetadata}
                  aria-label="Close media information"
                  title="Close media information"
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="metadata-dialog-content" tabIndex={0} aria-label="Media metadata">
                {fileName && (
                  <dl className="metadata-list">
                    <div>
                      <dt>File name</dt>
                      <dd>{fileName}</dd>
                    </div>
                  </dl>
                )}
                {metadata.status === 'loading' && <p role="status">Loading media information…</p>}
                {metadata.status === 'error' && <p role="alert">{metadata.error}</p>}
                {metadata.status === 'ready' && metadata.entries.length === 0 && (
                  <p>No metadata is available for this file.</p>
                )}
                {metadata.status === 'ready' && metadata.entries.length > 0 && (
                  <dl className="metadata-list">
                    {metadata.entries.map((item) => (
                      <div key={item.key}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
});

export default ViewerOverlay;
