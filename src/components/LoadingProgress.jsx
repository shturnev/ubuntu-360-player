import './LoadingProgress.scss';

function LoadingProgress({ complete, total, label = 'Loading', finishedLabel, detail }) {
  const progressPercent = total ? (complete / total) * 100 : 0;

  return (
    <div className="progress-block">
      <div className="progress-heading">
        <span>
          {complete === 0 || complete !== total
            ? `${label}... ${complete} / ${total}`
            : finishedLabel
              ? `${finishedLabel} ${complete} / ${total}`
              : 'Completed'}
        </span>
        {detail && (
          <span className="progress-detail" role="status">
            {detail}
          </span>
        )}
      </div>
      <div
        className="progress-bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={complete}
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
}

export default LoadingProgress;
