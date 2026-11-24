// FICTIONAL: a go-live can explain incidents for its first two days; later misses need a current cause.
export const NEW_WORKLOAD_DAYS = 2;

// FICTIONAL: a clock-hour slot's EWMA weight over days, half the old value and half this hour, so a slot follows
// a shift in "normal for this hour" within a few days (RT-17, docs/rca-design.md §4.2(1)).
export const SLOT_BASELINE_DECAY = 0.5;
// FICTIONAL: a second delay group with at least this share of the total excess is accepted beside the primary
// (RT-17, docs/rca-design.md §4.2(2)).
export const CO_DOMINANT_SHARE = 1 / 3;
// FICTIONAL: a CF or LCU at this many times its best peer's reading is "far slower than its peers" (RT-35): the
// shape of a standing misconfiguration, which own-history growth cannot see. RMF defines the fields (CF Activity
// service time and async conversion, DEVICE DISC and response), not a typical ratio; the line is the game's.
export const PEER_SLOW_RATIO = 4;
// FICTIONAL: a CF must carry at least this share of the sysplex's CF requests to set the peer line (RT-35): a token
// or test CF with a handful of requests is not a comparable peer. The book defines the request counts; the share is
// the game's.
export const PEER_MIN_REQUEST_SHARE = 0.01;

// FICTIONAL: when the delay groups together grew by less than this fraction of the response-time goal, none of them
// explains the miss and the CPU verdict stands (A6, docs/rca-design.md §4.2(2)).
export const DELAY_FLOOR_FRAC = 0.1;
