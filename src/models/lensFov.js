const limits = require('../lensFov.json');

function isValidLensFov(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= limits.minimum &&
    value <= limits.maximum &&
    Math.abs(value * 10 - Math.round(value * 10)) <= 1e-8
  );
}

module.exports = { isValidLensFov };
