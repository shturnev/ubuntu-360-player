import './ThumbnailSlider.scss';

function ThumbnailSlider({ value, onChange, disabled = false }) {
  return (
    <div className="slider-wrap" aria-label="Thumbnail size control">
      <input
        id="sizeRange"
        type="range"
        min="100"
        max="435"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (!disabled) {
            onChange(Number(event.target.value));
          }
        }}
      />
    </div>
  );
}

export default ThumbnailSlider;
