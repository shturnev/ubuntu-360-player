import PanoramaViewer from '../PanoramaViewer.jsx';
import './PanoramaViewer.scss';

function ViewerOverlay({ showingItem, items, viewerSrc, flatView, onClose, onToggleFlatView, onDelete, onPrevious, onNext, onOpenExternal }) {
  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="close-viewer" onClick={onClose}>✕</button>
        {flatView && showingItem.type === 'video' ? (
          <video controls autoPlay src={viewerSrc} />
        ) : flatView ? (
          <img src={viewerSrc} alt={showingItem.bigName} />
        ) : (
          <PanoramaViewer source={viewerSrc} type={showingItem.type} alt={showingItem.bigName} onOpenExternal={onOpenExternal} />
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
