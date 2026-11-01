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
    if (host === 'litterbox') return `Litterbox (link expires in ${expires || '72 hours'})`;
    if (host === 'catbox') return 'Catbox (long-term link)';
    return host || 'unknown';
  }

  async function uploadDirect(it, useLitter) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', it.blob, it.name);
    let endpoint;
    if (useLitter) {
      form.append('time', '72h');
      endpoint = 'https://litterbox.catbox.moe/resources/internals/api.php';
    } else {
      endpoint = 'https://catbox.moe/user/api.php';
    }
    const r = await fetch(endpoint, { method: 'POST', body: form });
    const text = (await r.text()).trim();
    if (!r.ok || !/^https?:\/\//i.test(text)) throw new Error(text.slice(0, 120) || r.statusText);
    return {
      url: text,
      host: useLitter ? 'litterbox' : 'catbox',
      expires: useLitter ? '72 hours' : '',
    };
  }

  async function uploadViaWorker(it, useLitter) {
    const base = (WORKER_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('no worker');
    const ext = it.name.split('.').pop() || 'mp4';
    const type = ext === 'webm' ? 'video/webm' : 'video/mp4';
    const r = await fetch(
      `${base}/api/rec?name=${encodeURIComponent(it.name)}&host=${useLitter ? 'litterbox' : 'catbox'}`,
      { method: 'PUT', headers: { 'Content-Type': type }, body: it.blob }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText || String(r.status));
    if (!data.url) throw new Error('no url returned');
    return {
      url: data.url,
      host: data.host || (useLitter ? 'litterbox' : 'catbox'),
      expires: data.expires || (useLitter ? '72 hours' : ''),
    };
  }

  async function tryHost(it, useLitter) {
    try {
      return await uploadViaWorker(it, useLitter);
    } catch (e1) {
      try {
        return await uploadDirect(it, useLitter);
      } catch (e2) {
        throw new Error(e2.message || e1.message || 'upload failed');
      }
    }
  }

  async function upload(it) {
    const size = it.blob.size;
    if (size > LITTER_MAX) {
      say('File over 1 GB — downloading instead');
      download(it);
      return;
    }
    const mb = (size / 1048576).toFixed(1);
    const errors = [];

    if (size <= CATBOX_MAX) {
      say(`Uploading ${mb} MB to Catbox…`);
      try {
        const result = await tryHost(it, false);
        lastUrl = result.url;
        lastHost = result.host;
        lastExpires = result.expires || '';
        say(`Saved on ${hostLabel(lastHost, lastExpires)} — ${lastUrl}`);
        try {
          if (navigator.clipboard && lastUrl) await navigator.clipboard.writeText(lastUrl);
        } catch (_) {}
        return;
      } catch (e) {
        errors.push('Catbox: ' + (e.message || e));
        say('Catbox failed — trying Litterbox (72h)…');
      }
    } else {
      say(`File is ${mb} MB (>200) — using Litterbox (72h)…`);
    }

    try {
      const result = await tryHost(it, true);
      lastUrl = result.url;
      lastHost = result.host || 'litterbox';
      lastExpires = result.expires || '72 hours';
      say(`Saved on ${hostLabel(lastHost, lastExpires)} — ${lastUrl}`);
      try {
        if (navigator.clipboard && lastUrl) await navigator.clipboard.writeText(lastUrl);
      } catch (_) {}
    } catch (e) {
      errors.push('Litterbox: ' + (e.message || e));
      pending.push(it);
      say(`Upload failed (${errors.join(' | ')}) — downloading. Use Retry later.`);
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
    g.textAlign = 'right';
    g.font = `600 ${14 * k}px system-ui`;
    feed.filter((f) => now - f.t < 6000).forEach((f, i) => g.fillText(f.s, W - 16 * k, 28 * k + i * 20 * k));
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
