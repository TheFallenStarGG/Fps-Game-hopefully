/** Records the game canvas + a drawn HUD + game audio to MP4 (WebM fallback) in ~45 s parts and uploads each to GitHub. */
const KEY = 'realmrange.rec.v1';
export const recCfg = { token: '', repo: 'TheFallenStarGG/Fps-Game-hopefully', branch: 'main', folder: 'recordings', mbps: 2.5, width: 1280 };
try { Object.assign(recCfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
export const saveRecCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(recCfg)); } catch (_) {} };

const MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const SEG_MS = 45000;

export function createRecorder({ canvas, audio, getState, onStatus }) {
  const out = document.createElement('canvas'), g = out.getContext('2d');
  const feed = [], pending = [];
  let rec = null, stream = null, active = false, t0 = 0, part = 0, last = 0, segTimer = 0, mime = '', stamp = '';
  const say = (m) => onStatus && onStatus(m);

  function download(it) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(it.blob);
    a.download = it.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  async function upload(it) {
    if (!recCfg.token) { say('No GitHub token set — downloading instead'); download(it); return; }
    try {
      say(`Uploading ${it.name}…`);
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(it.blob);
      });
      const r = await fetch(`https://api.github.com/repos/${recCfg.repo}/contents/${recCfg.folder}/${it.name}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${recCfg.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `recording ${it.name}`, content: b64, branch: recCfg.branch }),
      });
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 100));
      say(`Saved ${it.name} to GitHub`);
    } catch (e) {
      pending.push(it);
      say('Upload failed — kept (Menu → Recording → Retry)');
    }
  }

  function finish(blob) {
    part++;
    upload({ blob, name: `rec-${stamp}-p${part}.${mime.includes('mp4') ? 'mp4' : 'webm'}` });
  }

  function startSegment() {
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: recCfg.mbps * 1e6, audioBitsPerSecond: 96000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      finish(new Blob(chunks, { type: mime.split(';')[0] }));
      if (active) startSegment();
    };
    rec.start(1000);
    segTimer = setTimeout(() => { if (rec && rec.state === 'recording') rec.stop(); }, SEG_MS);
  }

  function start() {
    if (active) return;
    mime = window.MediaRecorder ? MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '' : '';
    if (!mime) { say('Recording is not supported in this browser'); return; }
    const w = Math.min(recCfg.width, canvas.width);
    out.width = w - (w % 2);
    out.height = Math.round((out.width * canvas.height) / canvas.width / 2) * 2;
    const as = audio.recordStream ? audio.recordStream() : null;
    stream = new MediaStream([...out.captureStream(30).getVideoTracks(), ...(as ? as.getAudioTracks() : [])]);
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    active = true; t0 = performance.now(); part = 0;
    startSegment();
    say(mime.includes('mp4') ? 'Recording (MP4)' : 'Recording (WebM — this browser can’t do MP4)');
  }

  function stop() {
    if (!active) return;
    active = false;
    clearTimeout(segTimer);
    if (rec && rec.state !== 'inactive') rec.stop();
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    say('Recording stopped — saving…');
  }

  function hudDraw(s) {
    const W = out.width, H = out.height, k = H / 600, now = performance.now();
    g.save();
    g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 4 * k;
    g.strokeStyle = '#fff'; g.lineWidth = 2 * k;
    if (!(s.scope > 0.5)) {
      const c = W / 2, m = H / 2, a = 6 * k, b = 14 * k;
      g.beginPath();
      g.moveTo(c - b, m); g.lineTo(c - a, m); g.moveTo(c + a, m); g.lineTo(c + b, m);
      g.moveTo(c, m - b); g.lineTo(c, m - a); g.moveTo(c, m + a); g.lineTo(c, m + b);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(16 * k, H - 40 * k, 220 * k, 12 * k);
    g.fillStyle = s.hp < 35 ? '#ff5a4a' : '#4be08e'; g.fillRect(16 * k, H - 40 * k, (220 * k * Math.max(0, s.hp)) / 100, 12 * k);
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = `800 ${30 * k}px monospace`; g.fillText(s.hp, 16 * k, H - 50 * k);
    g.textAlign = 'right'; g.fillStyle = '#ffc247'; g.font = `700 ${14 * k}px monospace`; g.fillText(s.weapon || '', W - 16 * k, H - 62 * k);
    g.fillStyle = '#fff'; g.font = `800 ${34 * k}px monospace`; g.fillText(s.kind === 'gun' ? `${s.ammo} / ${s.reserve}` : '', W - 16 * k, H - 24 * k);
    g.textAlign = 'center'; g.font = `700 ${16 * k}px monospace`; g.fillText(`K ${s.kills}    D ${s.deaths}`, W / 2, 28 * k);
    g.textAlign = 'right'; g.font = `600 ${14 * k}px system-ui`;
    feed.filter((f) => now - f.t < 6000).forEach((f, i) => g.fillText(f.s, W - 16 * k, 28 * k + i * 20 * k));
    g.restore();
  }

  /** call right after the frame is rendered (the WebGL buffer is only readable then) */
  function frame(now) {
    if (!active || now - last < 33) return;
    last = now;
    g.drawImage(canvas, 0, 0, out.width, out.height);
    hudDraw(getState());
  }

  return {
    start, stop, frame,
    toggle() { if (active) stop(); else start(); },
    get active() { return active; },
    get elapsed() { return active ? (performance.now() - t0) / 1000 : 0; },
    feedKill(a, b, head) {
      feed.push({ t: performance.now(), s: `${a} ${head ? '◎' : '▸'} ${b}` });
      if (feed.length > 5) feed.shift();
    },
    async retry() { for (const it of pending.splice(0)) await upload(it); },
    downloadAll() { pending.splice(0).forEach(download); },
  };
}
