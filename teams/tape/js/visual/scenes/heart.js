// heart.js - Nico's original fox-heart scene (../heart-scene.js) wrapped in the scene contract. Its picture is exactly the
// old one; it draws its own title, vignette, fades and progress line (meta.ownsText), so the host adds no overlay.
import { setThree, createHeartScene, MOODS } from '../heart-scene.js?v=9b';

export const meta = {
  id: 'heart', name: 'Fox heart', group: 'Classic', desc: "Nico's glowing fox heart under a dusk sky, petals and fox-fire sparks.",
  variants: Object.entries(MOODS).map(([id, m]) => ({ id, name: m.name, text: { ink: m.ink, accent: m.accent } })),
  defaultVariant: 'sakura', ownsText: true, thumbT: 7, intensity: true,
};

export function createScene({ THREE, canvas, renderer, width, height, pixelRatio = 1, variant = 'sakura', quality = 'high', title = '', artist = '', showText = true, intensity = 0.6, textLayer = null }) {
  setThree(THREE);
  const light = quality === 'light';
  const h = createHeartScene({ canvas, renderer, width, height, pixelRatio, mood: variant, intensity, light, antialias: !light,
    title: showText ? title : '', artist: showText ? artist : '', textLayer, hideBar: !showText });
  return {
    render(t, f, info = {}) { h.render(t, f, { duration: info.duration || 0 }); },
    resize(w, hh, pr = 1) { h.setSize(w, hh, pr); },
    setVariant(v) { h.setMood(v); },
    setIntensity(v) { h.setIntensity(v); },
    setTextLayer(bitmap, layout) { h.setTextLayer(bitmap, layout); },
    setText(t) { h.setText(t); },
    dispose() { h.dispose(); },
  };
}
