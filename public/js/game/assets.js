import { makeBackground, makeBird, makeGround, makePipe } from './sprites.js';

const loadImage = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });

// Resolves every theme asset to a drawable. Anything not set, or that fails to
// load, silently falls back to the built-in default.
export async function loadAssets(config, cache = {}) {
  const a = config.assets;
  const get = async (id) => {
    if (!id) return null;
    if (!(id in cache)) cache[id] = loadImage(`/uploads/${id}`);
    return cache[id];
  };
  const [bird, pipeTop, pipeBottom, background, ground, logo] = await Promise.all(
    [a.bird, a.pipeTop, a.pipeBottom, a.background, a.ground, a.logo].map(get)
  );
  const frames = bird ? Math.max(1, Math.min(a.birdFrames || 1, bird.naturalWidth)) : 3;
  const defaults = (cache.__defaults ??= { bird: makeBird(3), pipe: makePipe(), ground: makeGround(), background: makeBackground() });
  return {
    bird: bird || defaults.bird,
    birdFrames: frames,
    custom: { bird: !!bird, pipe: !!(pipeBottom || pipeTop), ground: !!ground, background: !!background },
    pipeBottom: pipeBottom || pipeTop || defaults.pipe,
    pipeTop: pipeTop || pipeBottom || defaults.pipe,
    // The bottom pipe image has its cap at the top. If only one image is supplied it is mirrored for the other side.
    pipeFlipTop: !pipeTop,
    pipeFlipBottom: !pipeBottom && !!pipeTop,
    background: background || defaults.background,
    ground: ground || defaults.ground,
    logo,
  };
}
