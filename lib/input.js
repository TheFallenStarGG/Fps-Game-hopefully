/** Keyboard, mouse, touch */

export function createInput(canvas, hooks) {
  const {
    isTouch,
    keys,
    moveStick,
    onShoot,
    onReload,
    onToggleCamera,
    getPlayer,
    setRmb,
    setAimMobile,
    setFiringMobile,
  } = hooks;

  let stickTouchId = null, lookTouchId = null;
  let lastLookX = null, lastLookY = null;

  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
    if (e.code === 'KeyR') onReload();
    if (e.code === 'KeyV' || e.code === 'KeyC') onToggleCamera();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));

  canvas.addEventListener('click', () => {
    if (isTouch) return;
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    else onShoot();
  });
  addEventListener('mousedown', (e) => {
    if (isTouch) return;
    if (e.button === 2) setRmb(true);
    if (e.button === 0 && document.pointerLockElement === canvas) onShoot();
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 2) setRmb(false);
  });
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    const player = getPlayer();
    player.yaw -= e.movementX * 0.0022;
    player.pitch -= e.movementY * 0.0020;
    player.pitch = Math.max(-0.55, Math.min(0.75, player.pitch));
  });

  const stick = document.getElementById('stick');
  const knob = document.getElementById('knob');
  const lookZone = document.getElementById('lookZone');
  const btnFire = document.getElementById('btnFire');
  const btnJump = document.getElementById('btnJump');
  const btnAim = document.getElementById('btnAim');
  const btnReload = document.getElementById('btnReload');
  const btnCam = document.getElementById('btnCam');

  function stickFromTouch(clientX, clientY) {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (clientX - cx) / (r.width / 2), dy = (clientY - cy) / (r.height / 2);
    const mag = Math.hypot(dx, dy) || 1;
    if (mag > 1) { dx /= mag; dy /= mag; }
    moveStick.x = dx; moveStick.y = dy;
    knob.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
  }

  if (stick) {
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      stickTouchId = t.identifier;
      stickFromTouch(t.clientX, t.clientY);
    }, { passive: false });
    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === stickTouchId) stickFromTouch(t.clientX, t.clientY);
    }, { passive: false });
  }

  if (lookZone) {
    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      lookTouchId = t.identifier;
      lastLookX = t.clientX; lastLookY = t.clientY;
    }, { passive: false });
    lookZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const player = getPlayer();
      for (const t of e.changedTouches) {
        if (t.identifier !== lookTouchId) continue;
        if (lastLookX != null) {
          player.yaw -= (t.clientX - lastLookX) * 0.005;
          player.pitch -= (t.clientY - lastLookY) * 0.0045;
          player.pitch = Math.max(-0.55, Math.min(0.75, player.pitch));
        }
        lastLookX = t.clientX; lastLookY = t.clientY;
      }
    }, { passive: false });
  }

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stickTouchId) {
        stickTouchId = null; moveStick.x = 0; moveStick.y = 0;
        if (knob) knob.style.transform = 'translate(0,0)';
      }
      if (t.identifier === lookTouchId) {
        lookTouchId = null; lastLookX = lastLookY = null;
      }
    }
  }
  addEventListener('touchend', endTouch);
  addEventListener('touchcancel', endTouch);

  if (btnFire) {
    btnFire.addEventListener('touchstart', (e) => { e.preventDefault(); setFiringMobile(true); onShoot(); }, { passive: false });
    btnFire.addEventListener('touchend', () => setFiringMobile(false));
  }
  if (btnJump) {
    btnJump.addEventListener('touchstart', (e) => { e.preventDefault(); keys.add('Space'); }, { passive: false });
    btnJump.addEventListener('touchend', () => keys.delete('Space'));
  }
  if (btnAim) {
    btnAim.addEventListener('touchstart', (e) => { e.preventDefault(); setAimMobile(true); }, { passive: false });
    btnAim.addEventListener('touchend', () => setAimMobile(false));
  }
  if (btnReload) {
    btnReload.addEventListener('touchstart', (e) => { e.preventDefault(); onReload(); }, { passive: false });
  }
  if (btnCam) {
    btnCam.addEventListener('touchstart', (e) => { e.preventDefault(); onToggleCamera(); }, { passive: false });
    btnCam.addEventListener('click', (e) => { e.preventDefault(); onToggleCamera(); });
  }
                     }
