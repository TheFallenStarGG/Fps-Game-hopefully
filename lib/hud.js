/** DOM HUD: vitals, ammo pips, dynamic crosshair, hit markers, damage indicators, kill feed, respawn + reload bars */
export function createHud() {
  const el = {};
  for (const id of ['hpFill', 'hpNum', 'ammoCur', 'ammoRes', 'pips', 'stance', 'camMode', 'cross', 'hitm', 'dmgFlash',
    'lowHp', 'scopeVig', 'dmgRing', 'reloadWrap', 'reloadFill', 'msg', 'respawn', 'respawnCt', 'kills', 'deaths',
    'killfeed', 'fps']) el[id] = document.getElementById(id);

  const last = {};
  let msgTimer = 0, pips = [], gap = 8, gapShown = -1;

  const flag = (key, node, cls, on) => {
    if (last[key] !== on) { last[key] = on; node.classList.toggle(cls, on); }
  };
  const restart = (node, cls) => { node.className = ''; void node.offsetWidth; node.className = cls; };

  function setMsg(t, ms = 1800) {
    el.msg.textContent = t || '';
    clearTimeout(msgTimer);
    if (t && ms) msgTimer = setTimeout(() => { el.msg.textContent = ''; }, ms);
  }

  function buildPips(n) {
    el.pips.textContent = '';
    pips = [];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      el.pips.appendChild(p);
      pips.push(p);
    }
    last.ammo = -1;
  }

  function update(p) {
    const hp = Math.ceil(p.hp);
    if (hp !== last.hp) {
      last.hp = hp;
      el.hpNum.textContent = hp;
      el.hpFill.style.transform = `scaleX(${Math.max(0, p.hp / p.maxHp).toFixed(3)})`;
    }
    flag('hpLow', el.hpFill, 'low', hp < 35);
    flag('lowVig', el.lowHp, 'on', hp > 0 && hp < 35);

    if (p.magSize !== pips.length) buildPips(p.magSize);
    if (p.ammo !== last.ammo) {
      last.ammo = p.ammo;
      el.ammoCur.textContent = p.ammo;
      el.ammoCur.classList.toggle('low', p.ammo <= p.magSize * 0.25);
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('off', i >= p.ammo);
    }
    if (p.reserve !== last.res) { last.res = p.reserve; el.ammoRes.textContent = '/ ' + p.reserve; }

    const stance = !p.alive ? '' : p.sprinting ? 'SPRINT' : p.crouching ? 'CROUCH' : !p.onGround ? 'AIRBORNE' : 'STAND';
    if (stance !== last.stance) { last.stance = stance; el.stance.textContent = stance; }
    const cam = p.thirdPerson ? '3RD PERSON' : '1ST PERSON';
    if (cam !== last.cam) { last.cam = cam; el.camMode.textContent = cam; }

    flag('ads', el.cross, 'ads', p.ads && !p.thirdPerson && p.alive);
    flag('hide', el.cross, 'hide', !p.alive);
    flag('scope', el.scopeVig, 'on', p.ads && p.alive);
  }

  function hitMarker(kind = 'hit') {
    restart(el.hitm, 'show ' + kind);
  }

  /** angle: radians, 0 = from ahead, +PI/2 = from the right. null = no direction. */
  function damage(angle) {
    restart(el.dmgFlash, 'on');
    if (typeof angle !== 'number') return;
    const w = document.createElement('div');
    w.className = 'wedge';
    w.style.transform = `rotate(${angle}rad)`;
    w.appendChild(document.createElement('i'));
    el.dmgRing.appendChild(w);
    while (el.dmgRing.children.length > 6) el.dmgRing.firstChild.remove();
    setTimeout(() => w.remove(), 1300);
  }

  function addKill(killer, victim, head) {
    const row = document.createElement('div');
    row.className = 'kf';
    const a = document.createElement('b');
    a.textContent = killer;
    if (killer === 'You') a.className = 'you';
    const mid = document.createElement('span');
    mid.className = 'ico';
    mid.textContent = head ? '◎' : '▸';
    const v = document.createElement('b');
    v.textContent = victim;
    if (victim === 'You') v.className = 'you';
    row.append(a, mid, v);
    el.killfeed.appendChild(row);
    while (el.killfeed.children.length > 5) el.killfeed.firstChild.remove();
    setTimeout(() => row.remove(), 6000);
  }

  function setScore(k, d) {
    el.kills.textContent = k;
    el.deaths.textContent = d;
  }

  /** rad = current spread half-angle, fovDeg = vertical camera FOV */
  function setSpread(rad, fovDeg) {
    const g = (Math.tan(rad) / Math.tan((fovDeg * Math.PI) / 360)) * (innerHeight / 2);
    gap += (Math.min(90, Math.max(5, g)) - gap) * 0.3;
    if (Math.abs(gap - gapShown) > 0.3) {
      gapShown = gap;
      el.cross.style.setProperty('--g', gap.toFixed(1) + 'px');
    }
  }

  /** f: 0..1 progress, or -1 to hide */
  function setReload(f) {
    const on = f >= 0;
    flag('rl', el.reloadWrap, 'on', on);
    if (on) {
      const v = f.toFixed(3);
      if (v !== last.rlv) { last.rlv = v; el.reloadFill.style.transform = `scaleX(${v})`; }
    }
  }

  function setRespawn(s) {
    const on = s !== null && s !== undefined;
    flag('rs', el.respawn, 'on', on);
    if (on) {
      const t = s > 0 ? `Respawning in ${s}` : 'Respawning…';
      if (t !== last.rst) { last.rst = t; el.respawnCt.textContent = t; }
    }
  }

  function setFps(v) {
    el.fps.textContent = v == null ? '' : v + ' FPS';
  }

  return { setMsg, update, hitMarker, damage, addKill, setScore, setSpread, setReload, setRespawn, setFps };
}
