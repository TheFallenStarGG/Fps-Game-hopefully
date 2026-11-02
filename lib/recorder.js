/** Records canvas + HUD + audio. Uploads to Catbox (≤200 MB) or Litterbox (larger, temporary). */
import { WORKER_URL } from './net.js';

const KEY = 'realmrange.rec.v1';
export const recCfg = { mbps: 2.5, width: 1280 };
try {
  const s = JSON.parse(localStorage.getItem(KEY) || '{}');
  if (s.mbps) recCfg.mbps = +s.mbps;
  if (s.width) recCfg.width = +s.width;
} catch (_) {}
export const saveRecCfg = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ mbps: recCfg.mbps, width: recCfg.width }));
  } catch (_) {}
};

const MIMES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const CATBOX_MAX = 200 * 1024 * 1024;
const LITTER_MAX = 1024 * 1024 * 1024;
const MAX_MS = 30 * 60 * 1000;

export function createRecorder({ canvas, audio, getState, onStatus }) {
  const out = document.createElement('canvas');
  const g = out.getContext('2d');
  const feed = [];
  const hits = []; // { t, kind } kind: 'hit' | 'head' | 'kill'
  const pending = [];
  let rec = null;
  let stream = null;
  let active = false;
  let t0 = 0;
  let last = 0;
  let maxTimer = 0;
  let mime = '';
  let stamp = '';
  let chunks = [];
  let lastUrl = '';
  let lastHost = '';
  let lastExpires = '';
  const say = (m) => onStatus && onStatus(m);

  function download(it) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(it.blob);
    a.download = it.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 4000);
  }

  function hostLabel(host, expires) {
    if (host === 'litterbox') return `Litterbox (expires ${expires || '72 hours'})`;
    if (host === 'catbox') return 'Catbox (long-term)';
    if (host === 'gofile') return 'Gofile';
    if (host === '0x0') return '0x0.st';
    if (host === 'tmpfiles') return `tmpfiles (${expires || 'short'})`;
    if (host === 'file.io') return `file.io (${expires || 'temporary'})`;
    return host || 'unknown';
  }

  async function uploadViaWorker(it, host = 'auto') {
    const base = (WORKER_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('no worker');
    const ext = it.name.split('.').pop() || 'mp4';
    const type = ext === 'webm' ? 'video/webm' : 'video/mp4';
    const r = await fetch(
      `${base}/api/rec?name=${encodeURIComponent(it.name)}&host=${encodeURIComponent(host)}`,
      { method: 'PUT', headers: { 'Content-Type': type }, body: it.blob },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText || String(r.status));
    if (!data.url) throw new Error('no url returned');
    return {
      url: data.url,
      host: data.host || host,
      expires: data.expires || '',
    };
  }

  async function uploadDirectChain(it) {
    const errors = [];

    async function gofile() {
      const srv = await fetch('https://api.gofile.io/servers').then((r) => r.json());
      const server = srv?.data?.servers?.[0]?.name;
      if (!server) throw new Error('no server');
      const form = new FormData();
      form.append('file', it.blob, it.name);
      const j = await fetch(`https://${server}.gofile.io/uploadFile`, { method: 'POST', body: form }).then((r) => r.json());
      const page = j?.data?.downloadPage || j?.data?.directLink;
      if (!page) throw new Error('no link');
      return { url: page, host: 'gofile', expires: '' };
    }
    async function zerox() {
      const form = new FormData();
      form.append('file', it.blob, it.name);
      const text = (await fetch('https://0x0.st', { method: 'POST', body: form }).then((r) => r.text())).trim();
      if (!/^https?:\/\//i.test(text)) throw new Error(text.slice(0, 80));
      return { url: text, host: '0x0', expires: '' };
    }
    async function tmpfiles() {
      const form = new FormData();
      form.append('file', it.blob, it.name);
      const j = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: form }).then((r) => r.json());
      let u = j?.data?.url;
      if (!u) throw new Error('no url');
      u = String(u).replace('http://', 'https://');
      if (/tmpfiles\.org\/\d+\//.test(u)) u = u.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      return { url: u, host: 'tmpfiles', expires: '~1 hour' };
    }
    async function fileio() {
      const form = new FormData();
      form.append('file', it.blob, it.name);
      const j = await fetch('https://file.io/?expires=7d', { method: 'POST', body: form }).then((r) => r.json());
      if (!j?.link) throw new Error('no link');
      return { url: j.link, host: 'file.io', expires: j.expiry || '7 days' };
    }

    for (const [label, fn] of [
      ['gofile', gofile],
      ['0x0', zerox],
      ['tmpfiles', tmpfiles],
      ['file.io', fileio],
    ]) {
      try {
        return await fn();
      } catch (e) {
        errors.push(label + ': ' + (e.message || e));
      }
    }
    throw new Error(errors.join(' | ') || 'direct upload failed');
  }

  async function upload(it) {
    const size = it.blob.size;
    if (size > LITTER_MAX) {
      say('File over 1 GB — downloading instead');
      download(it);
      return;
    }
    const mb = (size / 1048576).toFixed(1);
    say(`Uploading ${mb} MB (trying free hosts)…`);
    try {
      let result;
      try {
        result = await uploadViaWorker(it, 'auto');
      } catch (e1) {
        say('Worker hosts failed — trying from browser…');
        result = await uploadDirectChain(it);
      }
      lastUrl = result.url;
      lastHost = result.host;
      lastExpires = result.expires || '';
      say(`Saved on ${hostLabel(lastHost, lastExpires)} — ${lastUrl}`);
      try {
        if (navigator.clipboard && lastUrl) await navigator.clipboard.writeText(lastUrl);
      } catch (_) {}
    } catch (e) {
      pending.push(it);
      say(`All hosts failed (${String(e.message || e).slice(0, 100)}) — downloading. Use Retry later.`);
      download(it);
    }
  }

  function finish(blob) {
    if (!blob || !blob.size) {
      say('Nothing to save');
      return;
    }
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    upload({ blob, name: `rec-${stamp}.${ext}` });
  }

  function start() {
    if (active) return;
    mime = window.MediaRecorder ? MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '' : '';
    if (!mime) {
      say('Recording is not supported in this browser');
      return;
    }
    const w = Math.min(recCfg.width, canvas.width || recCfg.width);
    out.width = w - (w % 2);
    out.height = Math.round((out.width * (canvas.height || 720)) / (canvas.width || 1280) / 2) * 2;
    const as = audio && audio.recordStream ? audio.recordStream() : null;
    const vstream = out.captureStream(30);
    stream = new MediaStream([
      ...vstream.getVideoTracks(),
      ...(as ? as.getAudioTracks() : []),
    ]);
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    chunks = [];
    lastUrl = '';
    lastHost = '';
    lastExpires = '';
    rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: recCfg.mbps * 1e6,
      audioBitsPerSecond: 96000,
    });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      chunks = [];
      finish(blob);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    };
    rec.start(1000);
    active = true;
    t0 = performance.now();
    clearTimeout(maxTimer);
    maxTimer = setTimeout(() => {
      if (active) {
        say('Hit 30 min limit — stopping');
        stop();
      }
    }, MAX_MS);
    say(mime.includes('mp4') ? 'Recording (MP4)…' : 'Recording (WebM)…');
  }

  function stop() {
    if (!active) return;
    active = false;
    clearTimeout(maxTimer);
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch (_) {}
    } else if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    say('Recording stopped — uploading…');
  }

  function hudDraw(s) {
    const W = out.width;
    const H = out.height;
    const k = H / 600;
    const now = performance.now();
    g.save();
    g.shadowColor = 'rgba(0,0,0,.8)';
    g.shadowBlur = 4 * k;
    g.strokeStyle = '#fff';
    g.lineWidth = 2 * k;
    if (!(s.scope > 0.5)) {
      const c = W / 2;
      const m = H / 2;
      const a = 6 * k;
      const b = 14 * k;
      g.beginPath();
      g.moveTo(c - b, m);
      g.lineTo(c - a, m);
      g.moveTo(c + a, m);
      g.lineTo(c + b, m);
      g.moveTo(c, m - b);
      g.lineTo(c, m - a);
      g.moveTo(c, m + a);
      g.lineTo(c, m + b);
      g.stroke();
    }
    // hit / head / kill markers (same idea as #hitm in the live HUD)
    const hx = W / 2, hy = H / 2;
    for (const h of hits) {
      const age = now - h.t;
      const life = h.kind === 'kill' ? 550 : 300;
      if (age > life) continue;
      const a = 1 - age / life;
      const col = h.kind === 'kill' ? '#ff3b3b' : h.kind === 'head' ? '#ff9a2e' : '#ffffff';
      const arm = (h.kind === 'kill' ? 15 : 11) * k;
      const gap = 6 * k;
      g.save();
      g.globalAlpha = a;
      g.strokeStyle = col;
      g.lineWidth = 2 * k;
      g.shadowColor = 'rgba(0,0,0,.8)';
      g.shadowBlur = 3 * k;
      // four ticks like the DOM hit marker
      g.beginPath();
      g.moveTo(hx - gap - arm * 0.7, hy - gap - arm * 0.7);
      g.lineTo(hx - gap, hy - gap);
      g.moveTo(hx + gap + arm * 0.7, hy - gap - arm * 0.7);
      g.lineTo(hx + gap, hy - gap);
      g.moveTo(hx - gap - arm * 0.7, hy + gap + arm * 0.7);
      g.lineTo(hx - gap, hy + gap);
      g.moveTo(hx + gap + arm * 0.7, hy + gap + arm * 0.7);
      g.lineTo(hx + gap, hy + gap);
      g.stroke();
      g.restore();
    }
    g.fillStyle = 'rgba(0,0,0,.5)';
    g.fillRect(16 * k, H - 40 * k, 220 * k, 12 * k);
    g.fillStyle = s.hp < 35 ? '#ff5a4a' : '#4be08e';
    g.fillRect(16 * k, H - 40 * k, (220 * k * Math.max(0, s.hp)) / 100, 12 * k);
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.font = `800 ${30 * k}px monospace`;
    g.fillText(String(s.hp), 16 * k, H - 50 * k);
    g.textAlign = 'right';
    g.fillStyle = '#ffc247';
    g.font = `700 ${14 * k}px monospace`;
    g.fillText(s.weapon || '', W - 16 * k, H - 62 * k);
    g.fillStyle = '#fff';
    g.font = `800 ${34 * k}px monospace`;
    g.fillText(s.kind === 'gun' ? `${s.ammo} / ${s.reserve}` : '', W - 16 * k, H - 24 * k);
    g.textAlign = 'center';
    g.font = `700 ${16 * k}px monospace`;
    g.fillText(`K ${s.kills}    D ${s.deaths}`, W / 2, 28 * k);
    // kill feed (top-right, same idea as #killfeed)
    g.textAlign = 'right';
    g.font = `600 ${14 * k}px system-ui`;
    feed
      .filter((f) => now - f.t < 6000)
      .forEach((f, i) => {
        const y = 28 * k + i * 24 * k;
        const text = f.s;
        const tw = g.measureText(text).width;
        const padX = 10 * k, padY = 4 * k, h = 18 * k;
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.fillRect(W - 16 * k - tw - padX * 2, y - h + padY, tw + padX * 2, h);
        g.fillStyle = '#ffc247';
        g.fillRect(W - 16 * k - tw - padX * 2, y - h + padY, 3 * k, h);
        g.fillStyle = '#fff';
        g.fillText(text, W - 16 * k - padX, y);
      });
    g.restore();
  }

  function frame(now) {
    if (!active || now - last < 33) return;
    last = now;
    g.drawImage(canvas, 0, 0, out.width, out.height);
    hudDraw(getState());
  }

  return {
    start,
    stop,
    frame,
    toggle() {
      if (active) stop();
      else start();
    },
    get active() {
      return active;
    },
    get elapsed() {
      return active ? (performance.now() - t0) / 1000 : 0;
    },
    get lastUrl() {
      return lastUrl;
    },
    get lastHost() {
      return lastHost;
    },
    get lastExpires() {
      return lastExpires;
    },
    feedKill(a, b, head) {
      feed.push({ t: performance.now(), s: `${a} ${head ? '◎' : '▸'} ${b}` });
      if (feed.length > 5) feed.shift();
    },
    hitMarker(kind = 'hit') {
      const k = kind === 'head' || kind === 'headshot' ? 'head' : kind === 'kill' ? 'kill' : 'hit';
      hits.push({ t: performance.now(), kind: k });
      if (hits.length > 8) hits.shift();
    },
    async retry() {
      for (const it of pending.splice(0)) await upload(it);
    },
    downloadAll() {
      pending.splice(0).forEach(download);
    },
    copyLastUrl() {
      if (!lastUrl) {
        say('No link yet — record and upload first');
        return;
      }
      const note =
        lastHost === 'litterbox'
          ? `Litterbox — expires in ${lastExpires || '72 hours'}`
          : 'Catbox — long-term link';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(lastUrl).then(
          () => say(`Copied (${note})`),
          () => say(`${note}: ${lastUrl}`)
        );
      } else say(`${note}: ${lastUrl}`);
    },
  };
}
