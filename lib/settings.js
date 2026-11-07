/** Shared constants + persisted user settings */
export const EYE_H = 1.65;
export const CROUCH_EYE = 1.15;

const KEY = 'realmrange.settings.v2';

/** Graphics presets. "def" = normal. viewDist = view distance in METRES (only this much of the map is drawn). shadows: 0 off, 1 basic, 2 normal, 3 high, 4 ultra. detail: 0 off, 1 normal, 2 high, 3 ultra (grass, trees, rocks). */
export const PRESETS = {
  perf: { shadows: 0, detail: 0, viewDist: 140, renderScale: 0.55, muzzleLights: false, debris: false, godRays: false, ao: false, bloom: false, grade: false, bump: false, texRes: 0.5, aniso: 1, aa: false, animLod: true, bots: 4 },
  def: { shadows: 2, detail: 1, viewDist: 300, renderScale: 1, muzzleLights: true, debris: true, godRays: false, ao: false, bloom: false, grade: false, bump: false, texRes: 1, aniso: 8, aa: true, animLod: false, bots: 99 },
  high: { shadows: 3, detail: 2, viewDist: 400, renderScale: 1, muzzleLights: true, debris: true, godRays: true, ao: true, bloom: true, grade: true, bump: true, texRes: 2, aniso: 16, aa: true, animLod: false, bots: 99 },
  ultra: { shadows: 4, detail: 3, viewDist: 500, renderScale: 1.25, muzzleLights: true, debris: true, godRays: true, ao: true, bloom: true, grade: true, bump: true, texRes: 3, aniso: 16, aa: true, animLod: false, bots: 99 },
};

export const settings = {
  sens: 1,
  fov: 78,
  volume: 0.7,
  adsToggle: true,
  invertY: false,
  showFps: false,
  showMinimap: true,
  minimapSize: 200,
  aimAssist: true,
  assistStrength: 0.6,
  autoFire: true,
  preset: 'def',
  // Auto-lower graphics when FPS stays low - safer for first-time / weak PCs; reversible in Graphics menu
  autoPerf: true,
  // Developer (only meaningful when unlocked in lib/dev.js)
  devShowErrors: false,
  devShowLoadLogs: false,
  botTeams: 2,
  botTeamSize: 6,
  botLeaders: 1,
  ...PRESETS.def,
};

try {
  Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch (_) {}

// viewDist used to be 1 (short) / 2 (medium) / 3 (far). It is metres now: convert old saves.
if (!(settings.viewDist > 3)) {
  const p = PRESETS[settings.preset];
  settings.viewDist = p ? p.viewDist : ([300, 170, 250, 400][settings.viewDist | 0] || 300);
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (_) {}
}

export function applyPreset(name) {
  if (!PRESETS[name]) return;
  Object.assign(settings, PRESETS[name]);
  settings.preset = name;
  saveSettings();
}

/** 'perf' | 'def' | 'high' | 'ultra' | 'custom' */
export function detectPreset() {
  for (const n in PRESETS) {
    if (Object.keys(PRESETS[n]).every((k) => settings[k] === PRESETS[n][k])) return n;
  }
  return 'custom';
}

// escape hatch: open the game with ?safe to reset graphics
try {
  if (/[?&]safe\b/.test(location.search)) applyPreset('def');
} catch (_) {}
