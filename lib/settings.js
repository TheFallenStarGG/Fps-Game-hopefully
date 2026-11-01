/** Shared constants + persisted user settings */
export const EYE_H = 1.65;
export const CROUCH_EYE = 1.15;

const KEY = 'realmrange.settings.v2';

export const settings = {
  sens: 1,
  fov: 78,
  volume: 0.7,
  adsToggle: true,
  invertY: false,
  showFps: false,
  aimAssist: true,
  assistStrength: 0.6,
  autoFire: true,
};

try {
  Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch (_) {}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (_) {}
}
