/** Procedural animations — exaggerated so motion is obvious */

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

  if (kick > 0) {
    ud.shootKick = Math.max(0, kick - dt * 6);
  }

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

  if (ud.headM) {
    ud.headM.rotation.x = (opts.pitch || 0) * 0.3;
  }
}

export function triggerShootKick(ud) {
  if (!ud) return;
  ud.shootKick = 1;
}

export function updateViewmodel(viewmodel, opts) {
  if (!viewmodel) return;
  const dt = opts.dt || 0.016;
  if (viewmodel.userData.kick === undefined) {
    viewmodel.userData.kick = 0;
    viewmodel.userData.reload = 0;
    viewmodel.userData.bob = 0;
  }
  const ud = viewmodel.userData;

  if (opts.moving && opts.grounded) {
    ud.bob = (ud.bob || 0) + dt * 11;
  } else {
    ud.bob = (ud.bob || 0) * (1 - dt * 6);
  }
  const ads = !!opts.ads;
  const bobX = Math.sin(ud.bob) * 0.02 * (ads ? 0.25 : 1);
  const bobY = Math.abs(Math.cos(ud.bob)) * 0.015 * (ads ? 0.25 : 1);

  if (opts.shot) ud.kick = 1;
  ud.kick = Math.max(0, (ud.kick || 0) - dt * 6);

  let rx = -0.05 - (ads ? 0.06 : 0) - ud.kick * 0.18;
  let rz = 0;
  let px = 0.05 + bobX - (ads ? 0.12 : 0);
  let py = -0.06 + bobY - (ads ? 0.05 : 0) + ud.kick * 0.06;
  let pz = ads ? -0.12 : 0;

  if (opts.reloading) {
    ud.reload = (ud.reload || 0) + dt;
    const wave = Math.sin(ud.reload * 14);
    rx -= 0.65;
    rz = 1.0 + wave * 0.25;
    py -= 0.12;
    px += 0.05;
  } else {
    ud.reload = 0;
  }

  viewmodel.rotation.set(rx, 0, rz);
  viewmodel.position.set(px, py, pz);
}
