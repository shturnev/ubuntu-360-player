import './EmptyLibraryState.scss';

const FolderPlusIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m-3-3h6m5 7a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
);

function EmptyLibraryState({ onOpenDir }) {
  return (
    <div className="empty-state">
      <button type="button" className="primary-button large" onClick={onOpenDir}>
        <span className="button-icon"><FolderPlusIcon /></span>
        <span>Choose a media directory</span>
      </button>
    </div>
  );
}

export default EmptyLibraryState;
