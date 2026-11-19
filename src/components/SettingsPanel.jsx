import './SettingsPanel.scss';
import { useEffect, useState } from 'react';
import ShortcutList from './ShortcutList.jsx';
import lensFov from '../lensFov.json';

const donateUrl = 'https://www.privat24.ua/send/krdrh';
const changeLogUrl = 'https://github.com/shturnev/ubuntu-360-player/releases';
const websiteUrl = 'https://viewer360.app/';

const DonationIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 20s-7-4.4-7-10.2A3.7 3.7 0 0 1 12 7.2a3.7 3.7 0 0 1 7 2.6C19 15.6 12 20 12 20Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const sections = [
  { id: 'general', label: 'General', icon: '◉' },
  { id: 'lenses', label: 'Lenses', icon: '◎' },
  { id: 'shortcuts', label: 'Shortcuts', icon: '⌘' },
  { id: 'about', label: 'About', icon: 'ⓘ' },
];

function LensFovSetting({ format, fieldOfView, onSave }) {
  const [lensValue, setLensValue] = useState(String(fieldOfView ?? ''));
  const [lensStatus, setLensStatus] = useState('');
  const [savingLens, setSavingLens] = useState(false);

  useEffect(() => {
    setLensValue(String(fieldOfView ?? ''));
  }, [fieldOfView]);

  const saveLensFov = async (event) => {
    event.preventDefault();
    const value = Number(lensValue);
    if (
      lensValue.trim() === '' ||
      !Number.isFinite(value) ||
      value < lensFov.minimum ||
      value > lensFov.maximum ||
      Math.abs(value * 10 - Math.round(value * 10)) > 1e-8
    ) {
      setLensStatus('Enter a value between 180 and 220 degrees in 0.1 degree steps.');
      return;
    }
    setSavingLens(true);
    setLensStatus('');
    try {
      await onSave(value);
      setLensStatus(`Saved. Applies to subsequent ${format} imports.`);
    } catch (error) {
      setLensStatus(error?.message || `Unable to save the ${format} lens FOV.`);
    } finally {
      setSavingLens(false);
    }
  };

  return (
    <form className="settings-card lens-fov-box" onSubmit={saveLensFov}>
      <strong className="settings-card-label">{format} lens field of view</strong>
      <p className="settings-subtext">Adjust the field of view for {format} files.</p>
      <div className="settings-fov-row">
        <label className="settings-field" htmlFor={`${format.toLowerCase()}-lens-fov`}>
          Field of view
          <span className="settings-input-wrap">
            <input
              id={`${format.toLowerCase()}-lens-fov`}
              aria-label={`${format} lens field of view (degrees)`}
              type="number"
              min={lensFov.minimum}
              max={lensFov.maximum}
              step={lensFov.step}
              value={lensValue}
              onChange={(event) => {
                setLensValue(event.target.value);
                setLensStatus('');
              }}
              disabled={savingLens}
            />
            <span aria-hidden="true">°</span>
          </span>
        </label>
        <button type="submit" className="settings-action" aria-label={`Save ${format} lens FOV`} disabled={savingLens}>
          {savingLens ? 'Saving…' : `Save ${format}`}
        </button>
      </div>
      {lensStatus && (
        <p className="settings-status" role="status">
          {lensStatus}
        </p>
      )}
    </form>
  );
}

function SettingsPanel({
  cacheSize,
  checkUpdates,
  inspLensFov,
  onSaveInspLensFov,
  insvLensFov,
  onSaveInsvLensFov,
  onDeleteCache,
  onUpdateSetting,
  onOpenExternal,
  onClose,
}) {
  const [activeSection, setActiveSection] = useState('general');

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <div>
          <h3>Settings</h3>
          <p>Make the viewer feel like yours.</p>
        </div>
        {onClose && (
          <button
            type="button"
            className="icon-button small"
            onClick={onClose}
            aria-label="Close settings"
            title="Close settings"
          >
            <CloseIcon />
          </button>
        )}
      </div>
      <div className="settings-layout">
        <nav className="settings-sidebar" aria-label="Settings sections">
          <div className="settings-sidebar-label">Preferences</div>
          {sections.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              className="settings-nav-button"
              aria-label={label}
              aria-pressed={activeSection === id}
              aria-controls={`settings-${id}`}
              onClick={() => setActiveSection(id)}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                {icon}
              </span>
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <section
            id="settings-general"
            className="settings-page"
            hidden={activeSection !== 'general'}
            aria-labelledby="settings-general-title"
          >
            <div className="settings-content-title">
              <h3 id="settings-general-title">General</h3>
              <p className="settings-subtext">Manage updates and local storage.</p>
            </div>
            <div className="settings-cards">
              <label className="settings-card settings-row">
                <span>
                  <strong className="settings-card-label">Check for updates</strong>
                  <span className="settings-subtext">Automatically check for new versions.</span>
                </span>
                <input
                  className="settings-switch"
                  aria-label="Check for updates"
                  type="checkbox"
                  checked={Boolean(checkUpdates)}
                  onChange={onUpdateSetting}
                />
              </label>
              <div className="settings-card settings-row">
                <div>
                  <strong className="settings-card-label">
                    Media cache <span className="settings-cache-size">· {cacheSize} MB</span>
                  </strong>
                  <p className="settings-subtext">Remove temporary files and free up space.</p>
                </div>
                <button
                  type="button"
                  className="settings-action"
                  aria-label={`Clear data cache (${cacheSize} MB)`}
                  onClick={onDeleteCache}
                >
                  Clear cache
                </button>
              </div>
            </div>
          </section>
          <section
            id="settings-lenses"
            className="settings-page"
            hidden={activeSection !== 'lenses'}
            aria-labelledby="settings-lenses-title"
          >
            <div className="settings-content-title settings-title-row">
              <div>
                <h3 id="settings-lenses-title">Lens calibration</h3>
                <p className="settings-subtext">Fine-tune the field of view for your media.</p>
              </div>
              <span className="settings-badge">Advanced</span>
            </div>
            <div className="settings-cards">
              <div className="settings-help">
                One value applies to both axes. The 180–220° range (step 0.1°) keeps each lens at least hemispherical
                and avoids extreme extrapolation. This is not factory calibration.
              </div>
              <LensFovSetting format="INSP" fieldOfView={inspLensFov} onSave={onSaveInspLensFov} />
              <LensFovSetting format="INSV" fieldOfView={insvLensFov} onSave={onSaveInsvLensFov} />
            </div>
          </section>
          <section
            id="settings-shortcuts"
            className="settings-page"
            hidden={activeSection !== 'shortcuts'}
            aria-labelledby="settings-shortcuts-title"
          >
            <div className="settings-content-title">
              <h3 id="settings-shortcuts-title">Keyboard shortcuts</h3>
              <p className="settings-subtext">Move around the viewer a little faster.</p>
            </div>
            <div className="settings-card shortcuts-box">
              <ShortcutList />
            </div>
          </section>
          <section
            id="settings-about"
            className="settings-page"
            hidden={activeSection !== 'about'}
            aria-labelledby="settings-about-title"
          >
            <div className="settings-content-title">
              <h3 id="settings-about-title">About the project</h3>
              <p className="settings-subtext">Explore and support 360 Media Viewer.</p>
            </div>
            <div className="settings-cards">
              <div className="settings-card settings-row">
                <div>
                  <strong className="settings-card-label">Project website</strong>
                  <p className="settings-subtext">Find out more about 360 Media Viewer.</p>
                  <p className="settings-subtext">viewer360.app</p>
                </div>
                <button
                  type="button"
                  className="settings-action"
                  aria-label="Visit website"
                  onClick={() => onOpenExternal(websiteUrl)}
                >
                  Visit website ↗
                </button>
              </div>
              <div className="settings-card">
                <strong className="settings-card-label">Support the project</strong>
                <p className="settings-subtext">Help us continue building a better viewer.</p>
                <div className="settings-button-group">
                  <button
                    type="button"
                    className="settings-action settings-action-primary"
                    onClick={() => onOpenExternal(donateUrl)}
                  >
                    <span className="settings-button-icon">
                      <DonationIcon />
                    </span>
                    <span>Donate</span>
                  </button>
                  <button type="button" className="settings-action" onClick={() => onOpenExternal(changeLogUrl)}>
                    View changelog
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
