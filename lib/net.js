/**
 * Multiplayer + chat client
 * Set WORKER_URL to your deployed worker origin (no trailing slash)
 */

export const WORKER_URL = 'https://fps-game-server.YOUR_SUBDOMAIN.workers.dev';

export function createNet(hooks) {
  const {
    onWelcome,
    onJoin,
    onLeave,
    onState,
    onShoot,
    onDamage,
    onHp,
    onChat,
    onRespawnIn,
    onClose,
    onError,
  } = hooks;

  let ws = null;
  let myId = null;
  let connected = false;
  let stateTimer = null;

  function connect(room, name) {
    disconnect();
    const q = new URLSearchParams({
      room: room || 'lobby',
      name: name || 'Player',
    });
    const url = WORKER_URL.replace(/\/$/, '') + '/ws?' + q.toString();
    const wss = url.replace(/^http/, 'ws');
    ws = new WebSocket(wss);

    ws.onopen = () => {
      connected = true;
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'welcome':
          myId = msg.id;
          onWelcome && onWelcome(msg);
          break;
        case 'join':
          onJoin && onJoin(msg.player);
          break;
        case 'leave':
          onLeave && onLeave(msg.id);
          break;
        case 'state':
          onState && onState(msg);
          break;
        case 'shoot':
          onShoot && onShoot(msg);
          break;
        case 'damage':
          onDamage && onDamage(msg);
          break;
        case 'hp':
          onHp && onHp(msg);
          break;
        case 'chat':
          onChat && onChat(msg);
          break;
        case 'respawn_in':
          onRespawnIn && onRespawnIn(msg.ms);
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      connected = false;
      myId = null;
      stopStateLoop();
      onClose && onClose();
    };

    ws.onerror = () => {
      onError && onError();
    };
  }

  function disconnect() {
    stopStateLoop();
    if (ws) {
      try {
        ws.close();
      } catch (_) {}
      ws = null;
    }
    connected = false;
    myId = null;
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch (_) {}
  }

  function sendState(player) {
    send({
      type: 'state',
      x: player.x,
      z: player.z,
      yaw: player.yaw,
      pitch: player.pitch,
      hp: player.hp,
      alive: player.alive,
      ads: player.ads,
      thirdPerson: player.thirdPerson,
    });
  }

  function sendShoot(payload) {
    send({ type: 'shoot', ...payload });
  }

  function sendChat(text) {
    send({ type: 'chat', text });
  }

  function sendRespawn() {
    send({ type: 'respawn' });
  }

  function startStateLoop(getPlayer) {
    stopStateLoop();
    stateTimer = setInterval(() => {
      if (!connected) return;
      const p = getPlayer();
      if (p) sendState(p);
    }, 50);
  }

  function stopStateLoop() {
    if (stateTimer) {
      clearInterval(stateTimer);
      stateTimer = null;
    }
  }

  return {
    connect,
    disconnect,
    send,
    sendState,
    sendShoot,
    sendChat,
    sendRespawn,
    startStateLoop,
    stopStateLoop,
    getMyId: () => myId,
    isConnected: () => connected,
  };
}
