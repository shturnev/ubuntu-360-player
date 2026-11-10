import PanoramaViewer from '../PanoramaViewer.jsx';
import './PanoramaViewer.scss';

function ViewerOverlay({
  showingItem,
  items,
  viewerSrc,
  flatView,
  conversionProgress,
  onConvertVideo,
  onClose,
  onToggleFlatView,
  onDelete,
  onPrevious,
  onNext,
  onOpenExternal
}) {
  const convertButton = showingItem.type === 'video' && onConvertVideo && !conversionProgress?.active;

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer-panel" onClick={(event) => event.stopPropagation()}>
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
            <button type="button" onClick={onConvertVideo}>Convert for 360° playback</button>
          </div>
        )}
        <div className="viewer-controls">
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
