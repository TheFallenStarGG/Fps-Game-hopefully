/** Game modes (shared by lobby, HUD, net) + client-side match state fed by server messages */
export const MODES = {
  ffa: { id: 'ffa', name: 'FREE FOR ALL', short: '8 players · first to 20 kills', color: 0xff8a2b, online: true, cap: 8, min: 1, teams: false, rounds: false, target: 20 },
  duel: { id: 'duel', name: '1 v 1 DUEL', short: 'The Pit · first to 3 rounds', color: 0x4aa8ff, online: true, cap: 2, min: 2, teams: true, rounds: true, win: 3 },
  team: { id: 'team', name: '2 v 2 TEAMS', short: 'The Pit · first to 3 rounds', color: 0x5dff9a, online: true, cap: 4, min: 4, teams: true, rounds: true, win: 3 },
  bots: { id: 'bots', name: 'BOT ARENA', short: 'Solo · open map · 6 bots', color: 0xff4d6a, online: false, bots: 6, teams: false, rounds: false },
};
export const TEAM_COLOR = { A: '#4aa8ff', B: '#ff6b4a' };
const FROZEN = ['countdown', 'intermission', 'ended'];

export function createMatch() {
  const m = {
    mode: 'bots', cfg: MODES.bots, phase: 'live', round: 0, wins: { A: 0, B: 0 }, t: 0, note: '', winner: '',
    have: 1, need: 1, team: null, scores: [], target: 0,

    begin(id) {
      m.cfg = MODES[id] || MODES.ffa;
      m.mode = m.cfg.id;
      m.phase = 'live'; m.round = 0; m.wins = { A: 0, B: 0 }; m.t = 0; m.note = ''; m.winner = '';
      m.team = null; m.scores = []; m.target = m.cfg.target || 0;
    },

    /** feed every server message of type welcome | phase | scores */
    apply(msg) {
      if (msg.type === 'welcome') {
        m.cfg = MODES[msg.mode] || MODES.ffa;
        m.mode = m.cfg.id;
        m.team = msg.team || null;
        m.target = msg.target || 0;
        m.scores = msg.scores || [];
        if (msg.phase) m.apply(msg.phase);
      } else if (msg.type === 'phase') {
        m.phase = msg.phase;
        m.round = msg.round || 0;
        m.wins = msg.wins || m.wins;
        m.t = msg.t || 0;
        m.note = msg.note || '';
        m.winner = msg.winner || '';
        if (msg.have != null) m.have = msg.have;
        if (msg.need != null) m.need = msg.need;
      } else if (msg.type === 'scores') {
        m.scores = msg.list || [];
        if (msg.target != null) m.target = msg.target;
      }
    },

    tick(dt) { if (m.t > 0) m.t = Math.max(0, m.t - dt); },

    /** true during countdown / intermission / results: no moving or shooting */
    get frozen() { return FROZEN.includes(m.phase); },

    scoreline() { return `A ${m.wins.A} — ${m.wins.B} B`; },

    /** big centre-screen text: { title, sub } or null */
    banner() {
      switch (m.phase) {
        case 'waiting': return { title: 'WAITING FOR PLAYERS', sub: `${m.have} / ${m.need}` };
        case 'countdown': return { title: m.cfg.rounds ? `ROUND ${m.round}` : 'GET READY', sub: String(Math.max(1, Math.ceil(m.t))) };
        case 'intermission': return { title: m.note || 'ROUND OVER', sub: m.scoreline() };
        case 'ended': return { title: m.winner ? `${m.winner} WINS` : 'MATCH OVER', sub: m.cfg.rounds ? m.scoreline() : '' };
        default: return null;
      }
    },

    /** small status line for the HUD */
    status() {
      if (!m.cfg.online) return '';
      if (m.cfg.rounds) return `Round ${m.round} · ${m.scoreline()}`;
      return m.target ? `First to ${m.target}` : '';
    },

    rows(myId) {
      return m.scores.map((s) => ({ ...s, me: s.id === myId })).sort((a, b) => b.k - a.k || a.d - b.d);
    },
  };
  return m;
}
