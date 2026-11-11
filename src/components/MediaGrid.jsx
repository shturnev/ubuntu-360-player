import './MediaGrid.scss';

function MediaGrid({ items, serverUrl, maxSizePx, canSelect, onToggleSelection, onOpenItem }) {
  return (
    <div className="media-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${maxSizePx}px, 1fr))` }}>
      {items.map((item, index) => (
        <div
          key={`${item.thumpName}-${item.bigName}-${index}`}
          className={`media-card ${item.selected ? 'selected' : ''}`}
          onClick={() => (canSelect ? onToggleSelection(index) : onOpenItem({ ...item, index }))}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (canSelect) {
                onToggleSelection(index);
              } else {
                onOpenItem({ ...item, index });
              }
            }
          }}
        >
          <div className="thumb" style={{ backgroundImage: `url(${serverUrl}small/${encodeURIComponent(item.thumpName)})` }}>
            {item.type === 'video' && <span className="video-badge">▶</span>}
          </div>
          <div className="selection-mark">✓</div>
        </div>
      ))}
    </div>
  );
}

export default MediaGrid;
