/** Procedural body + FP viewmodel (ADS down-sights, staged reload) */

export function updateHumanoidAnim(ud, opts) {
  if (!ud || !ud.hips || !ud.legL || !ud.legR || !ud.armL || !ud.armR) return;

  const dt = opts.dt || 0.016;
  const grounded = opts.grounded !== false;
  const moving = !!opts.moving && grounded;
  const spd = Math.max(0, opts.speed || 0);

  if (moving && spd > 0.15) {
    ud.walkPhase = (ud.walkPhase || 0) + dt * (9 + spd * 0.5);
  } else {
    const phase = ud.walkPhase || 0;
    ud.walkPhase = phase + (0 - phase) * Math.min(1, dt * 5);
  }
  const w = ud.walkPhase || 0;
  const swing = Math.sin(w) * (moving ? 0.9 : 0);
  ud.legL.rotation.x = swing;
  ud.legR.rotation.x = -swing;

  if (!grounded) {
    ud.jumpBlend = Math.min(1, (ud.jumpBlend || 0) + dt * 5);
  } else {
    ud.jumpBlend = Math.max(0, (ud.jumpBlend || 0) - dt * 7);
  }
  const jb = ud.jumpBlend || 0;
  ud.legL.rotation.x += -0.7 * jb;
  ud.legR.rotation.x += -0.7 * jb;
  ud.hips.position.y = 0.95 + (moving ? Math.sin(w * 2) * 0.06 : 0) - 0.08 * jb;

  const wantAim = opts.ads ? 1 : 0;
  ud.aimBlend = (ud.aimBlend || 0) + (wantAim - (ud.aimBlend || 0)) * Math.min(1, dt * 12);
  const a = ud.aimBlend || 0;
  const kick = ud.shootKick || 0;

  ud.armL.rotation.set(
    -0.25 - a * 1.0 + swing * 0.35,
    0.15 * a,
    0.2 + a * 0.25
  );
  ud.armR.rotation.set(
    -0.3 - a * 1.15 - kick * 1.1,
    -0.35 * a,
    -0.12
  );

  if (ud.rifle) {
    ud.rifle.rotation.x = -a * 0.2 - kick * 0.5;
    ud.rifle.rotation.z = 0;
    ud.rifle.position.z = -0.15 - a * 0.12;
  }

  if (kick > 0) ud.shootKick = Math.max(0, kick - dt * 6);

  if (opts.reloading) {
    ud.reloadT = (ud.reloadT || 0) + dt;
    const wave = Math.sin(ud.reloadT * 14) * 0.35;
    if (ud.rifle) {
      ud.rifle.rotation.z = 0.9 + wave;
      ud.rifle.rotation.x = -0.55;
    }
    ud.armR.rotation.x = -1.4;
    ud.armL.rotation.x = -1.0 + wave * 0.6;
    ud.armL.rotation.z = 0.4;
  } else {
    ud.reloadT = 0;
  }

  if (ud.headM) ud.headM.rotation.x = (opts.pitch || 0) * 0.3;
}

export function triggerShootKick(ud) {
  if (!ud) return;
  ud.shootKick = 1;
}

export function updateViewmodel(viewmodel, opts) {
  if (!viewmodel) return;
  const dt = opts.dt || 0.016;
  const ud = viewmodel.userData;
  if (!ud.gunRoot) return;

  const { gunRoot, mag, bolt, handL } = ud;
  const ads = !!opts.ads;
  const reloading = !!opts.reloading;

  if (opts.moving && opts.grounded && !ads && !reloading) {
    ud.bob = (ud.bob || 0) + dt * 11;
  } else {
    ud.bob = (ud.bob || 0) * (1 - dt * 6);
  }
  const bobX = Math.sin(ud.bob) * 0.018;
  const bobY = Math.abs(Math.cos(ud.bob)) * 0.012;

  if (opts.shot) ud.kick = 1;
  ud.kick = Math.max(0, (ud.kick || 0) - dt * 6);
  const kick = ud.kick || 0;

  ud.aimBlend = (ud.aimBlend || 0) + ((ads ? 1 : 0) - (ud.aimBlend || 0)) * Math.min(1, dt * 10);
  const a = ud.aimBlend || 0;

  const hipPos = { x: 0.32, y: -0.3, z: -0.5 };
  const adsPos = { x: 0.0, y: -0.12, z: -0.28 };
  const hipRot = { x: -0.08, y: 0.12, z: 0.05 };
  const adsRot = { x: -0.02, y: 0.0, z: 0.0 };

  let px = hipPos.x + (adsPos.x - hipPos.x) * a + bobX * (1 - a);
  let py = hipPos.y + (adsPos.y - hipPos.y) * a + bobY * (1 - a) + kick * 0.05;
  let pz = hipPos.z + (adsPos.z - hipPos.z) * a;
  let rx = hipRot.x + (adsRot.x - hipRot.x) * a - kick * 0.14;
  let ry = hipRot.y + (adsRot.y - hipRot.y) * a;
  let rz = hipRot.z + (adsRot.z - hipRot.z) * a;

  mag.position.set(0, -0.12, -0.1);
  mag.rotation.set(0, 0, 0);
  mag.visible = true;
  bolt.position.set(0.08, 0.06, -0.2);
  handL.visible = false;
  handL.position.set(-0.15, -0.05, -0.05);

  if (reloading) {
    ud.reloadT = (ud.reloadT || 0) + dt;
    const t = ud.reloadT;

    if (t < 0.25) {
      const p = t / 0.25;
      py -= 0.2 * p;
      rx -= 0.5 * p;
      rz += 0.35 * p;
      handL.visible = true;
      handL.position.set(-0.05 - 0.05 * p, -0.12 - 0.05 * p, -0.05);
    } else if (t < 0.45) {
      const p = (t - 0.25) / 0.2;
      py -= 0.2;
      rx -= 0.5;
      rz += 0.35;
      handL.visible = true;
      mag.position.set(0, -0.12 - 0.25 * p, -0.1);
      mag.rotation.x = 0.4 * p;
      handL.position.set(-0.02, -0.15 - 0.2 * p, -0.05);
    } else if (t < 0.7) {
      const p = (t - 0.45) / 0.25;
      py -= 0.2;
      rx -= 0.5;
      rz += 0.35;
      handL.visible = true;
      mag.position.set(-0.1 * p, -0.4 - 0.5 * p, -0.1 + 0.2 * p);
      mag.rotation.set(1.2 * p, 0.8 * p, 1.5 * p);
      if (p > 0.85) mag.visible = false;
      handL.position.set(-0.15, -0.2, 0.05);
    } else if (t < 1.0) {
      const p = (t - 0.7) / 0.3;
      py -= 0.2 + 0.05 * Math.sin(p * Math.PI);
      rx -= 0.45;
      rz += 0.3;
      mag.visible = true;
      mag.position.set(0, -0.35 + 0.23 * p, -0.1);
      mag.rotation.set(0.3 * (1 - p), 0, 0);
      handL.visible = true;
      handL.position.set(-0.02, -0.3 + 0.18 * p, -0.05);
    } else if (t < 1.35) {
      const p = (t - 1.0) / 0.35;
      py -= 0.12;
      rx -= 0.25;
      handL.visible = true;
      const boltPull = p < 0.5 ? p * 2 : (1 - p) * 2;
      bolt.position.set(0.08, 0.06, -0.2 + 0.12 * boltPull);
      handL.position.set(0.1, 0.04, -0.15 + 0.1 * boltPull);
    } else {
      const p = Math.min(1, (t - 1.35) / 0.25);
      py -= 0.12 * (1 - p);
      rx -= 0.25 * (1 - p);
      handL.visible = false;
    }
  } else {
    ud.reloadT = 0;
  }

  gunRoot.position.set(px, py, pz);
  gunRoot.rotation.set(rx, ry, rz);
}

export function resetViewmodelReload(viewmodel) {
  if (!viewmodel || !viewmodel.userData) return;
  viewmodel.userData.reloadT = 0;
  }
