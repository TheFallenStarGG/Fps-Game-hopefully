/**
 * Ridgeback Lottery — utility.
 * Arm it (utility fire), then your next gunshot becomes a single Ridgeback-class
 * round: delete-on-hit body damage, violent kick, and a short gold blindness.
 */
import * as THREE from 'three';

const ARM_TIME = 0.85;
const BLIND_TIME = 0.55;
const RECOVER_TIME = 0.35;
const CHARGE_PER_LIFE = 1;

const RIDGE_DMG = { head: 300, body: 300, limb: 300 };

export function createLottery({ scene, hud, audio, camera }) {
  let charges = CHARGE_PER_LIFE;
  let phase = 'idle'; // idle | arming | armed | blind | recover
  let t = 0;
  let armed = false;

  // --- screen FX ---
  const fx = document.createElement('div');
  fx.id = 'lotteryFx';
  fx.style.cssText = [
    'position:fixed;inset:0;pointer-events:none;z-index:45;opacity:0;',
    'background:radial-gradient(ellipse at center,',
    'rgba(255,210,80,0.55) 0%,rgba(255,160,40,0.25) 35%,rgba(10,8,0,0.75) 100%);',
    'mix-blend-mode:screen;transition:opacity 40ms linear;',
  ].join('');
  document.body.appendChild(fx);

  const ring = document.createElement('div');
  ring.style.cssText = [
    'position:fixed;left:50%;top:50%;width:120px;height:120px;margin:-60px 0 0 -60px;',
    'border:2px solid rgba(255,200,80,0);border-radius:50%;pointer-events:none;z-index:46;',
    'box-shadow:0 0 24px rgba(255,180,40,0);transition:all 80ms ease-out;',
  ].join('');
  document.body.appendChild(ring);

  // --- world VFX: orbiting motes when armed ---
  const motes = new THREE.Group();
  motes.visible = false;
  const moteMat = new THREE.MeshBasicMaterial({
    color: 0xffc247, transparent: true, opacity: 0.85, depthWrite: false,
  });
  const moteGeo = new THREE.SphereGeometry(0.025, 8, 6);
  const moteMeshes = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(moteGeo, moteMat.clone());
    motes.add(m);
    moteMeshes.push(m);
  }
  scene.add(motes);

  // muzzle gold burst (reused)
  const burstMat = new THREE.MeshBasicMaterial({
    color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  });
  const burst = new THREE.Mesh(new THREE.CircleGeometry(0.35, 24), burstMat);
  burst.visible = false;
  scene.add(burst);

  function setPhase(p) {
    phase = p;
    t = 0;
  }

  function canArm() {
    return phase === 'idle' && charges > 0;
  }

  /** Called when player fires the utility. Returns true if arming started. */
  function arm() {
    if (!canArm()) {
      if (charges <= 0) hud.setMsg('Lottery spent — next life', 1600);
      else if (phase === 'armed') hud.setMsg('Lottery live — take the shot', 1400);
      return false;
    }
    setPhase('arming');
    audio.play && audio.play('equip');
    hud.setMsg('Chambering Ridgeback round…', 900);
    return true;
  }

  function isArmed() {
    return phase === 'armed';
  }

  function busy() {
    return phase === 'arming' || phase === 'blind';
  }

  /** Mutate / describe the next shot. Call from shoot() when armed. */
  function consumeShot() {
    if (phase !== 'armed') return null;
    charges = Math.max(0, charges - 1);
    armed = false;
    setPhase('blind');
    fx.style.opacity = '1';
    ring.style.borderColor = 'rgba(255,210,90,0.95)';
    ring.style.boxShadow = '0 0 40px rgba(255,180,40,0.8)';
    ring.style.width = '40px';
    ring.style.height = '40px';
    ring.style.margin = '-20px 0 0 -20px';
    motes.visible = false;
    audio.play && audio.play('shot', undefined, undefined, { snd: 'ridgeback' });
    hud.setMsg('RIDGEBACK LOTTERY', 900);
    return {
      dmg: RIDGE_DMG,
      pellets: 1,
      spread: 0.001,
      recoil: 0.22,
      fireCd: 0.85,
      bulletSpeed: 330,
      shake: 0.65,
      silent: false,
      soundId: 'ridgeback',
    };
  }

  function fireBurst(worldPos, dir) {
    burst.visible = true;
    burst.position.copy(worldPos);
    if (dir) burst.lookAt(worldPos.x + dir.x, worldPos.y + dir.y, worldPos.z + dir.z);
    burst.scale.setScalar(0.4);
    burstMat.opacity = 0.95;
  }

  function update(dt, player) {
    t += dt;

    if (phase === 'arming') {
      const k = Math.min(1, t / ARM_TIME);
      // soft gold pulse on edges while chambering
      fx.style.opacity = String(0.12 * Math.sin(k * Math.PI));
      if (t >= ARM_TIME) {
        setPhase('armed');
        armed = true;
        motes.visible = true;
        fx.style.opacity = '0';
        hud.setMsg('Lottery armed — next shot is Ridgeback', 2200);
        audio.play && audio.play('equip');
      }
    } else if (phase === 'armed') {
      // orbit motes around eye height
      const base = player;
      const ex = base.x - Math.sin(base.yaw) * 0.35;
      const ez = base.z - Math.cos(base.yaw) * 0.35;
      const ey = base.y + (base.eyeH || 1.55);
      motes.visible = true;
      for (let i = 0; i < moteMeshes.length; i++) {
        const a = t * 2.2 + i * (Math.PI * 2 / moteMeshes.length);
        const r = 0.45 + 0.06 * Math.sin(t * 3 + i);
        moteMeshes[i].position.set(
          ex + Math.cos(a) * r,
          ey + Math.sin(a * 1.3) * 0.18,
          ez + Math.sin(a) * r,
        );
        moteMeshes[i].material.opacity = 0.55 + 0.35 * Math.sin(t * 4 + i);
      }
    } else if (phase === 'blind') {
      const k = Math.min(1, t / BLIND_TIME);
      // hard flash then ease out
      const opac = k < 0.15 ? 1 : 1 - (k - 0.15) / 0.85;
      fx.style.opacity = String(Math.max(0, opac * 0.92));
      const s = 40 + k * 200;
      ring.style.width = s + 'px';
      ring.style.height = s + 'px';
      ring.style.margin = -s / 2 + 'px 0 0 ' + (-s / 2) + 'px';
      ring.style.borderColor = `rgba(255,210,90,${Math.max(0, 0.9 - k)})`;
      ring.style.boxShadow = `0 0 ${30 + k * 40}px rgba(255,180,40,${Math.max(0, 0.7 - k)})`;
      // look punch
      if (player) {
        player.pitch = Math.max(-1.35, player.pitch - dt * 0.55 * (1 - k));
        player.shake = Math.max(player.shake || 0, 0.55 * (1 - k));
        player.recoil = Math.max(player.recoil || 0, 0.18 * (1 - k));
      }
      if (burst.visible) {
        burst.scale.setScalar(0.4 + k * 2.2);
        burstMat.opacity = Math.max(0, 0.9 - k);
        if (k > 0.95) burst.visible = false;
      }
      if (t >= BLIND_TIME) {
        setPhase('recover');
        fx.style.opacity = '0';
        ring.style.borderColor = 'rgba(255,200,80,0)';
        ring.style.boxShadow = '0 0 0 rgba(0,0,0,0)';
      }
    } else if (phase === 'recover') {
      if (t >= RECOVER_TIME) setPhase('idle');
    }

    // aim punch while blind: reduce look scale slightly via player.lookScale if present
    if (player && phase === 'blind') {
      player.lookScale = 0.35;
    } else if (player && player.lookScale !== undefined && phase !== 'blind') {
      // don't stomp permanently — only restore if we set it
      if (player._lotteryLook) {
        player.lookScale = 1;
        player._lotteryLook = false;
      }
    }
    if (phase === 'blind' && player) player._lotteryLook = true;
  }

  function onRespawn() {
    charges = CHARGE_PER_LIFE;
    armed = false;
    motes.visible = false;
    burst.visible = false;
    fx.style.opacity = '0';
    setPhase('idle');
  }

  function dispose() {
    scene.remove(motes);
    scene.remove(burst);
    fx.remove();
    ring.remove();
  }

  return {
    arm,
    canArm,
    isArmed,
    busy,
    consumeShot,
    fireBurst,
    update,
    onRespawn,
    dispose,
    get charges() { return charges; },
    get phase() { return phase; },
    RIDGE_DMG,
  };
}
