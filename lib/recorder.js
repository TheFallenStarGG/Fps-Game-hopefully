/** Records canvas + full desktop HUD (no mobile controls) + audio. Faster finalize for long clips. */
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

const MAX_MS = 30 * 60 * 1000;

export function createRecorder({ canvas, audio, getState, onStatus }) {
  const out = document.createElement('canvas');
  const g = out.getContext('2d', { alpha: false });
  const feed = [];
  const hits = [];
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
  let chunkBytes = 0;
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
      ['0x0', zerox],
      ['tmpfiles', tmpfiles],
      ['gofile', gofile],
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

  function encodeSettings(elapsedMs) {
    // Long clips: shrink so finalize + upload stay usable on mobile
    let w = recCfg.width || 1280;
    let mbps = recCfg.mbps || 2.5;
    if (elapsedMs > 4 * 60 * 1000) {
      w = Math.min(w, 960);
      mbps = Math.min(mbps, 1.6);
    }
    if (elapsedMs > 8 * 60 * 1000) {
      w = Math.min(w, 854);
      mbps = Math.min(mbps, 1.2);
    }
    return { w, mbps };
  }

  function start() {
    if (active) return;
    mime = window.MediaRecorder ? MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '' : '';
    if (!mime) {
      say('Recording not supported on this browser');
      return;
    }
    const { w, mbps } = encodeSettings(0);
    const srcW = canvas.width || 1280;
    const srcH = canvas.height || 720;
    out.width = Math.min(w, srcW);
    out.height = Math.round((out.width * srcH) / srcW / 2) * 2;

    const as = audio && audio.recordStream ? audio.recordStream() : null;
    const vstream = out.captureStream(30);
    stream = new MediaStream([
      ...vstream.getVideoTracks(),
      ...(as ? as.getAudioTracks() : []),
    ]);

    chunks = [];
    chunkBytes = 0;
    t0 = performance.now();
    last = 0;
    stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    active = true;

    const bits = Math.round(mbps * 1e6);
    rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: bits,
      audioBitsPerSecond: 128000,
    });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) {
        chunks.push(e.data);
        chunkBytes += e.data.size;
      }
    };
    rec.onstop = () => {
      // yield so UI can show "Finalizing…" before heavy Blob work
      const localMime = mime.split(';')[0];
      const localChunks = chunks;
      chunks = [];
      const name = `realmrange-${stamp}.${localMime.includes('mp4') ? 'mp4' : 'webm'}`;
      setTimeout(async () => {
        say('Finalizing clip…');
        await new Promise((r) => setTimeout(r, 30));
        let blob;
        try {
          blob = new Blob(localChunks, { type: localMime });
        } catch (e) {
          say('Finalize failed (out of memory?) — try a shorter clip or lower quality');
          return;
        }
        localChunks.length = 0;
        const it = { blob, name };
        say(`Ready ${(blob.size / (1024 * 1024)).toFixed(1)} MB — uploading…`);
        try {
          await upload(it);
        } catch (_) {}
      }, 0);
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      stream = null;
    };
    rec.start(500); // smaller timeslices = smoother memory, faster stop flush
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
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = 0;
    }
    say('Stopping — finalizing…');
    try {
      if (rec && rec.state !== 'inactive') rec.stop();
    } catch (_) {}
    rec = null;
  }

  function drawScope(W, H, amount) {
    const a = Math.min(1, Math.max(0, amount));
    if (a < 0.02) return;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.33;
    g.save();
    g.globalAlpha = a;
    // black outside the optic (even-odd hole)
    g.fillStyle = 'rgba(0,0,0,0.97)';
    g.beginPath();
    g.rect(0, 0, W, H);
    g.moveTo(cx + R, cy);
    g.arc(cx, cy, R, 0, Math.PI * 2, true);
    g.fill('evenodd');
    // crosshair
    g.strokeStyle = '#0a0a0a';
    g.lineWidth = Math.max(2, W * 0.002);
    g.beginPath();
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.stroke();
    // mild inner edge
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = Math.max(4, W * 0.006);
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  function drawAdsVignette(W, H, ads) {
    if (!ads || ads < 0.05) return;
    g.save();
    g.globalAlpha = Math.min(0.55, ads * 0.5);
    const grd = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.min(W, H) * 0.7);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  function hudDraw(s) {
    if (!s) return;
    const W = out.width;
    const H = out.height;
    const k = H / 600;
    const now = performance.now();

    // Scope / ADS overlays first (over world, under chrome)
    drawAdsVignette(W, H, s.adsBlend != null ? s.adsBlend : s.ads ? 1 : 0);
    if (s.scope > 0.05) drawScope(W, H, s.scope);

    g.save();
    g.shadowColor = 'rgba(0,0,0,.8)';
    g.shadowBlur = 4 * k;

    // Crosshair only when not scoped
    if (!(s.scope > 0.45)) {
      g.strokeStyle = '#fff';
      g.lineWidth = 2 * k;
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

    // Hit markers
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

    // Low HP pulse
    if (s.hp < 35 && s.alive !== false) {
      g.save();
      g.globalAlpha = 0.25 + 0.15 * Math.sin(now / 180);
      g.fillStyle = '#ff2a1a';
      g.fillRect(0, 0, W, H);
      g.restore();
    }

    // Top center: K / D
    g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.fillRect(W / 2 - 70 * k, 12 * k, 140 * k, 28 * k);
    g.fillStyle = '#fff';
    g.font = `700 ${16 * k}px monospace`;
    g.fillText(`K ${s.kills|0}    D ${s.deaths|0}`, W / 2, 32 * k);

    // Weapon slots (main / side / melee)
    const slots = s.slots || [];
    if (slots.length) {
      let x = W / 2 - (slots.length * 72 * k) / 2;
      const y = 48 * k;
      g.font = `600 ${11 * k}px system-ui`;
      g.textAlign = 'center';
      slots.forEach((sl, i) => {
        const on = sl.on;
        g.fillStyle = on ? 'rgba(255,194,71,.25)' : 'rgba(0,0,0,.4)';
        g.strokeStyle = on ? '#ffc247' : 'rgba(255,255,255,.25)';
        g.lineWidth = on ? 2 * k : 1 * k;
        g.beginPath();
        g.roundRect?.(x, y, 68 * k, 22 * k, 6 * k);
        if (!g.roundRect) g.rect(x, y, 68 * k, 22 * k);
        g.fill();
        g.stroke();
        g.fillStyle = on ? '#ffc247' : '#ddd';
        g.fillText(`${i + 1} ${(sl.name || '').slice(0, 10)}`, x + 34 * k, y + 15 * k);
        x += 72 * k;
      });
    }

    // Stance / cam (top-left under minimap area)
    g.textAlign = 'left';
    g.font = `600 ${12 * k}px system-ui`;
    g.fillStyle = 'rgba(255,255,255,.75)';
    const stance = s.crouching ? 'CROUCH' : s.sprinting ? 'SPRINT' : '';
    const cam = s.thirdPerson ? '3RD' : '1ST';
    if (stance) g.fillText(stance, 16 * k, 56 * k);
    g.fillText(cam, 16 * k, 72 * k);

    // Bottom-left HP
    g.fillStyle = 'rgba(0,0,0,.5)';
    g.fillRect(16 * k, H - 40 * k, 220 * k, 12 * k);
    g.fillStyle = s.hp < 35 ? '#ff5a4a' : '#4be08e';
    g.fillRect(16 * k, H - 40 * k, (220 * k * Math.max(0, Math.min(100, s.hp))) / 100, 12 * k);
    g.fillStyle = '#fff';
    g.font = `800 ${28 * k}px monospace`;
    g.fillText(String(s.hp|0), 16 * k, H - 50 * k);
    g.font = `600 ${11 * k}px system-ui`;
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.fillText('HEALTH', 70 * k, H - 50 * k);

    // Bottom-right weapon + ammo
    g.textAlign = 'right';
    g.fillStyle = '#ffc247';
    g.font = `700 ${14 * k}px monospace`;
    g.fillText(s.weapon || '', W - 16 * k, H - 62 * k);
    g.fillStyle = '#fff';
    g.font = `800 ${32 * k}px monospace`;
    if (s.kind === 'gun') g.fillText(`${s.ammo} / ${s.reserve}`, W - 16 * k, H - 24 * k);
    else g.fillText(s.kind === 'melee' ? 'MELEE' : '', W - 16 * k, H - 24 * k);

    // Reload bar
    if (s.reloading && s.reloadTotal > 0) {
      const t = Math.min(1, (s.reloadT || 0) / s.reloadTotal);
      const bw = 160 * k;
      const bx = W / 2 - bw / 2;
      const by = H - 90 * k;
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.fillRect(bx, by, bw, 8 * k);
      g.fillStyle = '#ffc247';
      g.fillRect(bx, by, bw * t, 8 * k);
      g.fillStyle = '#fff';
      g.font = `600 ${12 * k}px system-ui`;
      g.textAlign = 'center';
      g.fillText('RELOADING', W / 2, by - 6 * k);
    }

    // Kill feed
    g.textAlign = 'right';
    g.font = `600 ${13 * k}px system-ui`;
    feed
      .filter((f) => now - f.t < 6000)
      .forEach((f, i) => {
        const y = 100 * k + i * 24 * k;
        const text = f.s;
        const tw = g.measureText(text).width;
        const padX = 10 * k, h = 18 * k;
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.fillRect(W - 16 * k - tw - padX * 2, y - h + 4 * k, tw + padX * 2, h);
        g.fillStyle = '#ffc247';
        g.fillRect(W - 16 * k - tw - padX * 2, y - h + 4 * k, 3 * k, h);
        g.fillStyle = '#fff';
        g.fillText(text, W - 16 * k - padX, y);
      });

    // Center message
    if (s.msg) {
      g.textAlign = 'center';
      g.font = `700 ${18 * k}px system-ui`;
      g.fillStyle = 'rgba(0,0,0,.55)';
      const tw = g.measureText(s.msg).width;
      g.fillRect(W / 2 - tw / 2 - 12 * k, H * 0.18, tw + 24 * k, 28 * k);
      g.fillStyle = '#fff';
      g.fillText(s.msg, W / 2, H * 0.18 + 20 * k);
    }

    // Building badge
    if (s.building) {
      g.textAlign = 'center';
      g.fillStyle = 'rgba(80,200,120,.35)';
      g.fillRect(W / 2 - 50 * k, H - 110 * k, 100 * k, 22 * k);
      g.fillStyle = '#9dffb0';
      g.font = `700 ${13 * k}px system-ui`;
      g.fillText('BUILD MODE', W / 2, H - 94 * k);
    }

    // Recording pip
    g.fillStyle = '#ff3b3b';
    g.beginPath();
    g.arc(W - 20 * k, 20 * k, 6 * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `600 ${11 * k}px monospace`;
    g.textAlign = 'right';
    const sec = Math.floor((now - t0) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    g.fillText(`REC ${mm}:${ss}`, W - 30 * k, 24 * k);

    g.restore();
  }

  function frame(now) {
    if (!active || now - last < 33) return;
    last = now;
    // Long recording: optionally downscale mid-session is hard; keep frame path light
    g.drawImage(canvas, 0, 0, out.width, out.height);
    try {
      hudDraw(getState());
    } catch (_) {}
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
      if (feed.length > 6) feed.shift();
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
      const note = hostLabel(lastHost, lastExpires);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(lastUrl).then(
          () => say(`Copied (${note})`),
          () => say(`${note}: ${lastUrl}`),
        );
      } else say(`${note}: ${lastUrl}`);
    },
  };
}
