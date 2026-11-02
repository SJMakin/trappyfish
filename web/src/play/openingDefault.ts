const key = 'trappy.play-opening-default.v1';
let memory = 'free';
export function loadOpeningDefault(): 'free' | 'favourites' {
  try { memory = localStorage.getItem(key) ?? memory; } catch { /* Tab fallback. */ }
  return memory === 'favourites' ? 'favourites' : 'free';
}
export function saveOpeningDefault(value: 'free' | 'favourites'): boolean {
  memory = value;
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
