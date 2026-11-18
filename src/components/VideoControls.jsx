function formatTime(seconds) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function VideoControls({
  isPlaying,
  currentTime,
  duration,
  volume,
  onPlayPause,
  onSeek,
  onVolumeChange,
  onToggleFullscreen,
  isFullscreen,
  disabled = false,
}) {
  return (
    <div className="panorama-video-controls">
      <div className="panorama-video-toolbar">
        <button
          type="button"
          className="panorama-play"
          onClick={onPlayPause}
          aria-label={isPlaying ? 'Pause video' : 'Play video'}
          title={isPlaying ? 'Pause' : 'Play'}
          disabled={disabled}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {isPlaying ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" /> : <path d="M7 4v16l13-8z" />}
          </svg>
        </button>
        <span className="panorama-video-time" aria-live="polite">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <span className="panorama-video-spacer" />
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 9v6h4l5 4V5L7 9H3zm12.5 3a3.5 3.5 0 0 0-2-3.16v6.31a3.5 3.5 0 0 0 2-3.15z" />
          {volume > 0 && <path d="M14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z" />}
          {volume === 0 && (
            <path d="m16 9-1.41-1.41L12 10.17l-2.59-2.58L8 9l2.59 3L8 15l1.41 1.41L12 13.83l2.59 2.58L16 15l-2.59-3z" />
          )}
        </svg>
        <input
          className="panorama-video-volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={onVolumeChange}
          aria-label="Adjust video volume"
        />
        <button
          type="button"
          className="panorama-fullscreen"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
          title={isFullscreen ? 'Exit full screen' : 'Full screen'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {isFullscreen ? (
              <path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z" />
            ) : (
              <path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v6h6v-2H6v-4zm10 4h4v-4h2v6h-6z" />
            )}
          </svg>
        </button>
      </div>
      <input
        className="panorama-video-seek"
        type="range"
        min="0"
        max={duration || 0}
        step="0.01"
        value={currentTime}
        onChange={onSeek}
        aria-label="Seek video playback"
        disabled={disabled}
        style={{ '--progress': `${duration ? (currentTime / duration) * 100 : 0}%` }}
      />
    </div>
  );
}

export default VideoControls;
