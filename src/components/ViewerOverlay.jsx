import { useEffect, useRef, useState } from 'react';
import PanoramaViewer from '../PanoramaViewer.jsx';
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

function ViewerOverlay({
  showingItem,
  items,
  viewerSrc,
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
}) {
  const panelRef = useRef(null);
  const flatVideoFrameTimer = useRef(null);
  const flatVideoHasFrame = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [flatVideoError, setFlatVideoError] = useState(false);
  const convertButton =
    showingItem.type === 'video' &&
    hasPlaybackFailure &&
    onConvertVideo &&
    !conversionProgress?.active &&
    !hasConvertedVideo;

  useEffect(() => {
    setFlatVideoError(false);
    flatVideoHasFrame.current = false;
    clearTimeout(flatVideoFrameTimer.current);
    flatVideoFrameTimer.current = null;

    return () => {
      clearTimeout(flatVideoFrameTimer.current);
      flatVideoFrameTimer.current = null;
    };
  }, [showingItem?.origPath, showingItem?.bigName, flatView]);

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsFullscreen(Boolean(panelRef.current && document.fullscreenElement === panelRef.current));
    };

    updateFullscreenState();
    document.addEventListener('fullscreenchange', updateFullscreenState);
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState);
  }, []);

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
    setFlatVideoError(true);
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

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div ref={panelRef} className="viewer-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="close-viewer" onClick={onClose}>
          ✕
        </button>
        {flatView && showingItem.type === 'video' ? (
          <>
            <video
              controls
              autoPlay
              src={viewerSrc}
              onLoadedData={handleFlatVideoLoadedData}
              onPlaying={handleFlatVideoPlaying}
              onPause={clearFlatVideoFrameTimer}
              onEnded={clearFlatVideoFrameTimer}
              onError={reportFlatVideoFailure}
            />
            {flatVideoError && (
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
          </>
        ) : flatView ? (
          <img src={viewerSrc} alt={showingItem.bigName} />
        ) : (
          <PanoramaViewer
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
          />
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
          <button type="button" onClick={onPrevious} disabled={items.length < 2}>
            <ArrowLeftIcon />
          </button>
          <button type="button" onClick={onToggleFlatView}>
            {flatView ? '360° view' : 'Flat view'}
          </button>
          <button
            type="button"
            className="fullscreen-button"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullscreen ? CloseFullScreenIcon() : OpenFullScreenIcon()}
          </button>

          <button type="button" onClick={onDelete} title={'Delete'}>
            Delete
          </button>
          <button type="button" onClick={onNext} disabled={items.length < 2}>
            <ArrowRightIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ViewerOverlay;
