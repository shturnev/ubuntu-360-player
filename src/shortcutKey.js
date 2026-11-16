export function shortcutKey(event) {
  if (event.code) {
    if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
    return event.code === 'F1' ? 'f1' : '';
  }
  return event.key.toLowerCase();
}
