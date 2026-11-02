/** Bot Arena teams: leaders (client AI) + followers (order-driven, cheap). */
export const TEAM_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
export const TEAM_COLORS = [0xff4d6a, 0x4aa8ff, 0x5dff9a, 0xffc247, 0xc57bff, 0xff8a2b];

/** Clamp arena layout for performance. */
export function clampArenaCfg(s) {
  const teams = Math.max(2, Math.min(4, Math.round(+s.botTeams || 2)));
  const size = Math.max(4, Math.min(10, Math.round(+s.botTeamSize || 6)));
  const leaders = Math.max(1, Math.min(3, Math.round(+s.botLeaders || 1)));
  return { teams, size, leaders, total: teams * size };
}

export function assignRoles(cfg) {
  const list = [];
  let id = 0;
  for (let t = 0; t < cfg.teams; t++) {
    for (let i = 0; i < cfg.size; i++) {
      list.push({
        index: id++,
        member: i,
        team: t,
        teamName: TEAM_NAMES[t],
        color: TEAM_COLORS[t],
        isLeader: i < cfg.leaders,
      });
    }
  }
  return list;
}

export function makeOrder(type, extra = {}) {
  return { type, t: performance.now() / 1000, ...extra };
}
