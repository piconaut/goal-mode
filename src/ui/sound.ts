// Tiny Web Audio cues; no assets. Browsers only allow audio after a user gesture, so the first cue may be silent.
let ctx: AudioContext | null = null;

function tone(freqHz: number, startSec: number, durSec: number, gain: number) {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime + startSec;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.frequency.value = freqHz;
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durSec);
  } catch {
    // No audio available: cues are optional.
  }
}

/** Two-tone pager chime for a new incident. */
export const pagerChime = () => {
  tone(880, 0, 0.18, 0.15);
  tone(660, 0.2, 0.25, 0.15);
};

/** Barely-there tick at each simulated hour boundary. */
export const hourTick = () => tone(1400, 0, 0.03, 0.03);
