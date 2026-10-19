// Time and unit constants shared by the whole sim. See SPEC §3.

/** One tick = WLM policy adjustment interval. */
export const TICK_SEC = 10;
export const DAY_SEC = 86_400;
export const TICKS_PER_DAY = DAY_SEC / TICK_SEC;
/** Played days run 06:00 → 06:00 so each ends on the batch deadline. */
export const DAY_START_HOUR = 6;
/** R4HA bookkeeping granularity: 48 five-minute values per 4 hours. */
export const R4HA_SLOT_SEC = 300;
export const R4HA_SLOTS = 48;
export const TICKS_PER_R4HA_SLOT = R4HA_SLOT_SEC / TICK_SEC;

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
