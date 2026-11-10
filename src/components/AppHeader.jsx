import './AppHeader.scss';

function AppHeader({ version, canOpenDir, onOpenDir, onToggleSelection, onCloseViewer }) {
  return (
    <header className="topbar">
      <div className="title-group">
        <span className="app-name">sht-vr-player</span>
        <span className="version">v{version || '1.0.5'}</span>
      </div>
      <div className="toolbar-actions">
        <button type="button" className="primary-button" onClick={onOpenDir} disabled={!canOpenDir}>Open folder</button>
        <button type="button" className="ghost-button" onClick={onToggleSelection}>Selection</button>
        <button type="button" className="ghost-button" onClick={onCloseViewer}>Close viewer</button>
      </div>
    </header>
  );
}

export default AppHeader;
