/** Away mode is stored as household-local dates (YYYY-MM-DD), both ends inclusive. */
export type AwayWindow = { awayFrom: string | null; awayUntil: string | null };

export function isAwayOn(m: AwayWindow, localDate: string) {
  return !!m.awayFrom && !!m.awayUntil && m.awayFrom <= localDate && localDate <= m.awayUntil;
}

/** Current or upcoming away window, or null once it has ended. */
export function activeAway(m: AwayWindow, today: string) {
  return m.awayFrom && m.awayUntil && m.awayUntil >= today ? { from: m.awayFrom, until: m.awayUntil, now: m.awayFrom <= today } : null;
}
