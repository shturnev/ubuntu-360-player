import './SettingsPanel.scss';

function SettingsPanel({ cacheSize, checkUpdates, onDeleteCache, onUpdateSetting, onOpenExternal }) {
  return (
    <div className="settings-panel">
      <h3>Settings</h3>
      <button type="button" className="ghost-button full" onClick={onDeleteCache}>Clear data cache ({cacheSize} MB)</button>
      <label className="toggle-row">
        <span>Check for updates</span>
        <input type="checkbox" checked={Boolean(checkUpdates)} onChange={onUpdateSetting} />
      </label>
      <div className="donate-box">
        <p>Please donate to support the project.</p>
        <button type="button" className="primary-button" onClick={() => onOpenExternal('https://www.liqpay.ua/en/checkout/shtvrplayer')}>Donate</button>
        <a href="#" onClick={(event) => {
          event.preventDefault();
          onOpenExternal('https://gitlab.com/go-apps-XnjRcS/vr-viewer-for-linux/electron-version/-/blob/master/CHANGELOG.md');
        }}>View changelog</a>
      </div>
    </div>
  );
}

export default SettingsPanel;
