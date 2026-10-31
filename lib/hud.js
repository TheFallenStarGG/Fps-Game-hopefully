export function createHud() {
  const hpYouEl = document.getElementById('hpYou');
  const hpEnemyEl = document.getElementById('hpEnemy');
  const msgEl = document.getElementById('msg');
  const ammoEl = document.getElementById('ammo');
  const scopeV = document.getElementById('scopeVignette');
  const modeEl = document.getElementById('camMode');

  function setMsg(t, ms = 1800) {
    msgEl.textContent = t || '';
    if (t && ms) setTimeout(() => { if (msgEl.textContent === t) msgEl.textContent = ''; }, ms);
  }

  function update(player, enemy) {
    hpYouEl.style.transform = `scaleX(${Math.max(0, player.hp / player.maxHp)})`;
    hpEnemyEl.style.transform = `scaleX(${Math.max(0, enemy.hp / enemy.maxHp)})`;
    if (ammoEl) {
      ammoEl.textContent = player.reloading
        ? 'RELOADING…'
        : `${player.ammo} / ${player.reserve}`;
    }
    if (scopeV) scopeV.style.display = player.ads ? 'block' : 'none';
    if (modeEl) modeEl.textContent = player.thirdPerson ? '3RD' : '1ST';
  }

  return { setMsg, update };
}
