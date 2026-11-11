import './SelectionBar.scss';

function SelectionBar({ totalSelected, totalItems, onToggleAll, onClear, onDelete, onClose }) {
  return (
    <div className="selection-bar">
      <span>
        Selected {totalSelected} / {totalItems}
      </span>
      <button type="button" onClick={onToggleAll}>
        Toggle all
      </button>
      <button type="button" onClick={onClear}>
        Clear
      </button>
      <button type="button" onClick={onDelete} disabled={!totalSelected}>
        Delete
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

export default SelectionBar;
