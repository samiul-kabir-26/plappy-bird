// Flap / pause input. Returns a detach function.
export function attachInput({ pointerTarget, keyTarget, onFlap, onPause }) {
  const key = (e) => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); onFlap(); }
    else if (e.code === 'KeyP') onPause();
  };
  const pointer = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    onFlap();
  };
  keyTarget.addEventListener('keydown', key);
  pointerTarget.addEventListener('pointerdown', pointer);
  return () => {
    keyTarget.removeEventListener('keydown', key);
    pointerTarget.removeEventListener('pointerdown', pointer);
  };
}
