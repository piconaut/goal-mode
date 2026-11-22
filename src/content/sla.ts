// FICTIONAL: a go-live can explain incidents for its first two days; later misses need a current cause.
export const NEW_WORKLOAD_DAYS = 2;

// FICTIONAL: a clock-hour slot's EWMA weight over days, half the old value and half this hour, so a slot follows
// a shift in "normal for this hour" within a few days (RT-17, docs/rca-design.md §4.2(1)).
export const SLOT_BASELINE_DECAY = 0.5;
// FICTIONAL: a second delay group with at least this share of the total excess is accepted beside the primary
// (RT-17, docs/rca-design.md §4.2(2)).
export const CO_DOMINANT_SHARE = 1 / 3;
// FICTIONAL: when the delay groups together grew by less than this fraction of the response-time goal, none of them
// explains the miss and the CPU verdict stands (A6, docs/rca-design.md §4.2(2)).
export const DELAY_FLOOR_FRAC = 0.1;
