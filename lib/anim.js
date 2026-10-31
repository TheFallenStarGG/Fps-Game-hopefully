/** Procedural pose updates for humanoids */

export function updateHumanoidAnim(ud, opts) {
  const {
    hips, legL, legR, armL, armR, rifle, headM,
  } = ud;
  if (!hips) return;

  const dt = opts.dt || 0.016;
  const moving = !!opts.moving && opts.grounded !== false;
  const spd = opts.speed || 0;

  if (moving && spd > 0.2) {
    ud.walkPhase = (ud.walkPhase || 0) + dt * (8 + spd * 0.4);
  } else {
    ud.walkPhase = (ud.walkPhase || 0) * (1 - Math.min(1, dt * 6));
  }
  const w = ud.walkPhase || 0;
  const swing = Math.sin(w) * (moving ? 0.55 : 0.05);
  legL.rotation.x = swing;
  legR.rotation.x = -swing;

  if (!opts.grounded) {
    ud.jumpBlend = Math.min(1, (ud.jumpBlend || 0) + dt * 4);
  } else {
    ud.jumpBlend = Math.max(0, (ud.jumpBlend || 0) - dt * 6);
  }
  const jb = ud.jumpBlend || 0;
  legL.rotation.x += -0.4 * jb;
  legR.rotation.x += -0.4 * jb;
  hips.position.y = 0.9 + 0.08 * Math.sin(w * 2) * (moving ? 1 : 0) * (1 - jb) - 0.05 * jb;

  const wantAim = opts.ads ? 1 : 0;
  ud.aimBlend = (ud.aimBlend || 0) + (wantAim - (ud.aimBlend || 0)) * Math.min(1, dt * 10);
  const a = ud.aimBlend || 0;

  armL.rotation.x = -0.15 - a * 0.85 + swing * 0.15;
  armL.rotation.z = 0.1 + a * 0.2;
  armR.rotation.x = -0.2 - a * 1.0 - (ud.shootKick || 0) * 0.8;
  armR.rotation.y = -a * 0.25;
  armR.rotation.z = -0.05;

  if (rifle) {
    rifle.rotation.x = -a * 0.15 - (ud.shootKick || 0) * 0.35;
    rifle.position.z = -0.25 - a * 0.1;
  }

  if (ud.shootKick > 0) {
    ud.shootKick = Math.max(0, ud.shootKick - dt * 8);
  }

  if (opts.reloading) {
    ud.reloadT = (ud.reloadT || 0) + dt;
    const rt = ud.reloadT;
    const wave = Math.sin(rt * 10) * 0.25;
    if (rifle) {
      rifle.rotation.z = 0.6 + wave;
      rifle.rotation.x = -0.4;
    }
    armR.rotation.x = -1.2;
    armL.rotation.x = -0.9 + wave * 0.5;
  } else {
    ud.reloadT = 0;
    if (rifle) rifle.rotation.z = 0;
  }

  if (headM) {
    headM.rotation.x = (opts.pitch || 0) * 0.25;
  }
}

export function triggerShootKick(ud) {
  if (ud) ud.shootKick = 1;
}

export function updateViewmodel(viewmodel, opts) {
  if (!viewmodel) return;
  const dt = opts.dt || 0.016;
  viewmodel.userData = viewmodel.userData || { kick: 0, reload: 0, bob: 0 };
  const ud = viewmodel.userData;
  if (opts.moving && opts.grounded) {
    ud.bob += dt * 10;
  } else {
    ud.bob *= 1 - dt * 5;
  }
  const bobX = Math.sin(ud.bob) * 0.012 * (opts.ads ? 0.3 : 1);
  const bobY = Math.abs(Math.cos(ud.bob)) * 0.01 * (opts.ads ? 0.3 : 1);

  if (opts.shot) ud.kick = 1;
  ud.kick = Math.max(0, (ud.kick || 0) - dt * 7);

  let rx = -0.02 - (opts.ads ? 0.04 : 0) - ud.kick * 0.12;
  let ry = 0;
  let rz = 0;
  let px = 0.02 + bobX - (opts.ads ? 0.08 : 0);
  let py = -0.02 + bobY - (opts.ads ? 0.04 : 0) + ud.kick * 0.04;
  let pz = opts.ads ? -0.08 : 0;

  if (opts.reloading) {
    ud.reload = (ud.reload || 0) + dt;
    const w = Math.sin(ud.reload * 12);
    rx -= 0.5;
    rz = 0.8 + w * 0.2;
    py -= 0.08;
  } else {
    ud.reload = 0;
  }

  viewmodel.rotation.set(rx, ry, rz);
  viewmodel.position.set(px, py, pz);
                          }
