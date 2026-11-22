// Sim defaults with no IBM-published value for I/O contention, queueing and effective CPU capacity. WLM's own
// mechanics live in content/wlm/tuning.ts; history and cache limits stay in the sim (they are not coefficients).

/** APPROX: real DASD fabric and backend paths slow down as they approach nominal capacity, but the model's
 *  wait formulas divide by (1 − utilisation), so utilisation is capped just below 1 to keep them finite.
 *  Shape: heavy I/O raises response times steeply instead of dispatching more than the hardware can do. */
export const DASD_MAX_RHO = 0.97;

/** APPROX: M/M/c utilisation is clamped below 1 for the same reason; callers treat overload as backlog.
 *  Shape: queue delay grows sharply near saturation and stays finite at the bound. */
export const QUEUE_MAX_RHO = 0.995;

/** FICTIONAL: effective engines per delivered engine assumed for an LPAR before it has been measured, or when
 *  it has delivered none. Shape: a cold LPAR projects as if HiperDispatch kept most of its engines effective. */
export const DEFAULT_EFF_RATIO = 0.93;
