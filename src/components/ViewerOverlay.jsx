import { useEffect, useRef, useState } from 'react';
import PanoramaViewer from '../PanoramaViewer.jsx';
import './PanoramaViewer.scss';

function ViewerOverlay({
  showingItem,
  items,
  viewerSrc,
  flatView,
  conversionProgress,
  hasConvertedVideo,
  onConvertVideo,
  onClose,
  onToggleFlatView,
  onDelete,
  onPrevious,
  onNext,
  onOpenExternal
}) {
  const panelRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const convertButton = showingItem.type === 'video' && onConvertVideo && !conversionProgress?.active && !hasConvertedVideo;

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
      if (event.key === 'Escape' && panelRef.current && document.fullscreenElement === panelRef.current && typeof document.exitFullscreen === 'function') {
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

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div ref={panelRef} className="viewer-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="close-viewer" onClick={onClose}>✕</button>
        {flatView && showingItem.type === 'video' ? (
          <video controls autoPlay src={viewerSrc} />
        ) : flatView ? (
          <img src={viewerSrc} alt={showingItem.bigName} />
        ) : (
          <PanoramaViewer
            source={viewerSrc}
            type={showingItem.type}
            alt={showingItem.bigName}
            onOpenExternal={onOpenExternal}
            onConvertVideo={onConvertVideo}
            conversionProgress={conversionProgress}
          />
        )}
        {showingItem.type === 'video' && conversionProgress?.active && (
          <div className="conversion-progress" role="status" aria-live="polite">
            <strong>{conversionProgress.message || 'Converting video…'}</strong>
            <div className="conversion-bar" aria-label="video conversion progress">
              <span style={{ width: `${Math.min(100, Math.max(0, Number(conversionProgress.percent) || 0))}%` }} />
            </div>
            <small>
              {Math.round(Number(conversionProgress.percent) || 0)}% • {Math.round((Number(conversionProgress.elapsedMs) || 0) / 1000)}s elapsed • ETA {conversionProgress.etaMs == null ? 'unknown' : `${Math.round((Number(conversionProgress.etaMs) || 0) / 1000)}s`}
            </small>
          </div>
        )}
        {convertButton && (
          <div className="viewer-convert-actions">
            <button type="button" onClick={onConvertVideo}>Convert / fix video</button>
          </div>
        )}
        <div className="viewer-controls">
          <button type="button" onClick={toggleFullscreen}>
            {isFullscreen ? 'Exit full screen' : 'Full screen'}
          </button>
          <button type="button" onClick={onToggleFlatView}>
            {flatView ? '360° view' : 'Flat view'}
          </button>
          <button type="button" onClick={onPrevious} disabled={!items[showingItem.index - 1]}>←</button>
          <button type="button" onClick={onDelete}>Delete</button>
          <button type="button" onClick={onNext} disabled={!items[showingItem.index + 1]}>→</button>
        </div>
      </div>
    </div>
  );
}

export default ViewerOverlay;
