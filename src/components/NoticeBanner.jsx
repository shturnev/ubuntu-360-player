import './NoticeBanner.scss';

function NoticeBanner({ kind, title, onDismiss, dismissLabel = 'Dismiss', children }) {
  return (
    <div className={`notice ${kind || ''}`} role="status">
      <span>{title}</span>
      <div className="notice-actions">
        {children}
        {onDismiss && (
          <button type="button" className="ghost-button" onClick={onDismiss}>
            {dismissLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default NoticeBanner;
