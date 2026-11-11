import ThumbnailSlider from './ThumbnailSlider.jsx';
import './AppHeader.scss';

const FolderIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m-3-3h6m5 7a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
);

const SelectionIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 6L7 17l-5-5m20-2l-7.5 7.5L13 16"/></svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const SettingsIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"><g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></g></svg>
);

function AppHeader({
  version,
  selectedPath,
  maxSizePx,
  sliderDisabled,
  canOpenDir,
  canSelectMedia,
  showCloseViewer,
  showSettings,
  onOpenDir,
  onToggleSelection,
  onCloseViewer,
  onToggleSettings,
  onThumbnailSizeChange
}) {
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="title-group">
          <span className="app-name">sht-vr-player</span>
          <span className="version">v{version || '1.0.5'}</span>
        </div>

        <div className="toolbar-actions">
          <button type="button" className="icon-button primary-icon-button" onClick={onOpenDir} disabled={!canOpenDir} aria-label="Open folder" title="Open folder">
            <FolderIcon />
          </button>
          {canSelectMedia && (
            <button type="button" className="icon-button" onClick={onToggleSelection} aria-label="Toggle selection" title="Toggle selection">
              <SelectionIcon />
            </button>
          )}
          {showCloseViewer && (
            <button type="button" className="icon-button" onClick={onCloseViewer} aria-label="Close viewer" title="Close viewer">
              <CloseIcon />
            </button>
          )}
          <button type="button" className={`icon-button settings-button ${showSettings ? 'active' : ''}`} onClick={onToggleSettings} aria-label="Open settings" title="Open settings">
            <SettingsIcon />
          </button>
        </div>
      </div>

      <div className="topbar-row topbar-row--meta">
        <div className={`path-label ${selectedPath ? '' : 'empty'}`}>{selectedPath || 'No folder selected'}</div>
        {!sliderDisabled && <ThumbnailSlider value={maxSizePx} onChange={onThumbnailSizeChange} disabled={sliderDisabled} />}
      </div>
    </header>
  );
}

export default AppHeader;
