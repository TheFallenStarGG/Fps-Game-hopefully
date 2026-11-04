/**
 * On-screen log for phones: shows the [rifleman] / [humanoid] messages and any errors in a box at the bottom.
 * Tap the box to hide it. Info-only messages hide by themselves after 10 seconds; warnings and errors stay.
 */
const box = document.createElement('div');
box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:40vh;overflow:auto;z-index:99999;'
  + 'background:rgba(0,0,0,.85);color:#9fe;font:11px/1.35 monospace;padding:6px 8px;white-space:pre-wrap;display:none;';
box.addEventListener('click', () => { box.style.display = 'none'; });
let hideT = 0, sticky = false;

const text = (a) => {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.name + ': ' + a.message;
  try { return JSON.stringify(a); } catch (_) { return String(a); }
};

function show(kind, args) {
  const line = args.map(text).join(' ');
  const ours = line.includes('[rifleman]') || line.includes('[humanoid]');
  if (!ours && kind !== 'error') return;
  if (!box.isConnected) (document.body || document.documentElement).append(box);
  const row = document.createElement('div');
  row.style.color = kind === 'error' ? '#ff8a8a' : kind === 'warn' ? '#ffd56a' : '#9fe';
  row.textContent = line.slice(0, 600);
  box.append(row);
  box.style.display = 'block';
  box.scrollTop = box.scrollHeight;
  if (kind !== 'info') sticky = true;
  clearTimeout(hideT);
  if (!sticky) hideT = setTimeout(() => { box.style.display = 'none'; }, 10000);
}

for (const k of ['info', 'log', 'warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); show(k === 'log' ? 'info' : k, a); };
}
addEventListener('error', (e) => show('error', ['Error:', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno]));
addEventListener('unhandledrejection', (e) => show('error', ['Promise error:', e.reason]));
