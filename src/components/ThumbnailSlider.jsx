import './ThumbnailSlider.scss';

function ThumbnailSlider({ value, onChange }) {
  return (
    <div className="slider-wrap">
      <label htmlFor="sizeRange">Thumbnail size</label>
      <input id="sizeRange" type="range" min="100" max="435" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

export default ThumbnailSlider;
