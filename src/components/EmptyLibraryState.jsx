import './EmptyLibraryState.scss';

function EmptyLibraryState({ onOpenDir }) {
  return (
    <div className="empty-state">
      <button type="button" className="primary-button large" onClick={onOpenDir}>Choose a media directory</button>
    </div>
  );
}

export default EmptyLibraryState;
