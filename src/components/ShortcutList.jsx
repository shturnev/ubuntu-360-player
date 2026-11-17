function ShortcutList() {
  return (
    <dl className="shortcut-list">
      <div>
        <dt>Ctrl+O</dt>
        <dd>Import folder</dd>
      </div>
      <div>
        <dt>Ctrl+Shift+O</dt>
        <dd>Import files</dd>
      </div>
      <div>
        <dt>Ctrl+P</dt>
        <dd>Save screenshot of a ready 360° panorama</dd>
      </div>
      <div>
        <dt>Ctrl+S</dt>
        <dd>Save a copy of the current media</dd>
      </div>
      <div>
        <dt>F1</dt>
        <dd>Open Settings</dd>
      </div>
      <div>
        <dt>I</dt>
        <dd>Show media information</dd>
      </div>
      <div>
        <dt>O</dt>
        <dd>Toggle orientation correction</dd>
      </div>
      <div>
        <dt>Space</dt>
        <dd>Play or pause video</dd>
      </div>
      <div>
        <dt>Left / Right</dt>
        <dd>Previous / next media</dd>
      </div>
    </dl>
  );
}

export default ShortcutList;
