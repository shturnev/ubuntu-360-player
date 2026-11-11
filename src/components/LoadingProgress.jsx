import './LoadingProgress.scss';

function LoadingProgress({ complete, total }) {
  const progressPercent = total ? (complete / total) * 100 : 0;

  return (
    <div className="progress-block">
      <div>{complete === 0 || complete !== total ? `Loading... ${complete} / ${total}` : 'Completed'}</div>
      <div className="progress-bar">
        <span style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
}

export default LoadingProgress;
