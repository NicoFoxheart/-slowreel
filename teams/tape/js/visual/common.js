// common.js - small shared bits for the video UI (no three.js here, so the windows open instantly).
export const MOOD_LIST = [
  { id: 'sakura', name: 'Sakura dusk', sky: '#1d1640', heart: '#ff7fbf' },
  { id: 'kitsune', name: 'Fox fire', sky: '#2a1026', heart: '#ffa04a' },
  { id: 'moon', name: 'Moon rain', sky: '#0f1c40', heart: '#8fbfff' },
];
export const fmtEta = s => (!isFinite(s) ? '' : s < 60 ? `about ${Math.max(1, Math.round(s))} s left` : `about ${Math.round(s / 60)} min left`);
export const kbmb = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
/** The heart scene module with three.js plugged in (the page's import map resolves 'three'). */
export async function loadHeart() { const [m, T] = await Promise.all([import('./heart-scene.js?v=10'), import('three')]); m.setThree(T); return m; }
/**
 * Preview pacing: at most `fps` frames a second, and if the computer cannot keep up (frames arrive late for a while,
 * i.e. the GPU is the bottleneck) the preview drops its resolution step by step (then its frame rate), so the
 * studio's audio scheduling never waits on the preview. tick(now) -> dt in seconds when a frame should be drawn, else 0.
 */
export function previewPacer({ fps = 30, minScale = 0.3, onScale = () => { } } = {}) {
  let scale = 1, last = 0, interval = 1000 / fps, ema = interval, slow = 0;
  return {
    get scale() { return scale; },
    reset() { last = 0; ema = interval; slow = 0; },
    tick(now) {
      if (last && now - last < interval - 2) return 0;
      const dt = last ? now - last : interval; last = now;
      ema = ema * 0.75 + Math.min(dt, 1000) * 0.25;
      if (ema > interval * 1.5) {
        if (++slow >= 5) {
          slow = 0; ema = interval;
          if (scale > minScale + 1e-3) { scale = Math.max(minScale, scale * 0.7); onScale(scale); } else if (interval < 1000 / 15) interval = 1000 / 15;
        }
      } else slow = 0;
      return dt / 1000;
    },
  };
}
