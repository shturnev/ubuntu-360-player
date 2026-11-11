import './SettingsPanel.scss';

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 7h14M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7m-8 0 1 12.5A1.5 1.5 0 0 0 9.5 21h5a1.5 1.5 0 0 0 1.5-1.5L17 7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DonationIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 20s-7-4.4-7-10.2A3.7 3.7 0 0 1 12 7.2a3.7 3.7 0 0 1 7 2.6C19 15.6 12 20 12 20Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

function SettingsPanel({ cacheSize, checkUpdates, onDeleteCache, onUpdateSetting, onOpenExternal, onClose }) {
  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>Settings</h3>
        {onClose && (
          <button type="button" className="icon-button small" onClick={onClose} aria-label="Close settings" title="Close settings">
            <CloseIcon />
          </button>
        )}
      </div>

      <button type="button" className="ghost-button full" onClick={onDeleteCache}>
        <span className="button-icon"><TrashIcon /></span>
        <span>Clear data cache ({cacheSize} MB)</span>
      </button>

      <label className="toggle-row">
        <span>Check for updates</span>
        <input type="checkbox" checked={Boolean(checkUpdates)} onChange={onUpdateSetting} />
      </label>

      <div className="donate-box">
        <p>Please donate to support the project.</p>
        <div className="donate-actions">
          <button type="button" className="primary-button" onClick={() => onOpenExternal('https://www.liqpay.ua/en/checkout/shtvrplayer')}>
            <span className="button-icon"><DonationIcon /></span>
            <span>Donate</span>
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onOpenExternal('https://gitlab.com/go-apps-XnjRcS/vr-viewer-for-linux/electron-version/-/blob/master/CHANGELOG.md')}
          >
            View changelog
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
