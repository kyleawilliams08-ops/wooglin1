// Draft-night fanfare, synthesized with the Web Audio API — no asset to load,
// nothing to 404 mid-draft. A timpani thump, a rising brass triad, then a
// sustained chord with a shimmer on top: "the pick is in".

let ctx: AudioContext | null = null;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/**
 * Browsers block audio until the user interacts with the page. Call this from
 * a click/tap (the draft room wires it to the first interaction) so the chime
 * can fire later on its own.
 */
export async function unlockAudio(): Promise<boolean> {
  const c = getCtx();
  if (!c) return false;
  if (c.state === "suspended") {
    try { await c.resume(); } catch { return false; }
  }
  return c.state === "running";
}

export function audioReady(): boolean {
  return getCtx()?.state === "running";
}

/** One voice: two slightly detuned oscillators through a lowpass, with an envelope. */
function voice(
  c: AudioContext,
  out: AudioNode,
  freq: number,
  start: number,
  dur: number,
  peak: number,
  type: OscillatorType = "sawtooth",
) {
  const gain = c.createGain();
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1800, start);
  filter.frequency.exponentialRampToValueAtTime(4200, start + 0.08);
  filter.frequency.exponentialRampToValueAtTime(1200, start + dur);
  filter.connect(gain);
  gain.connect(out);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.035);          // attack
  gain.gain.exponentialRampToValueAtTime(peak * 0.6, start + dur * 0.5); // sustain
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);           // release

  for (const detune of [-6, 6]) {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }
}

/** The low drum hit that opens it. */
function thump(c: AudioContext, out: AudioNode, start: number) {
  const gain = c.createGain();
  gain.connect(out);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.9, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);

  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(85, start);
  osc.frequency.exponentialRampToValueAtTime(38, start + 0.5);
  osc.connect(gain);
  osc.start(start);
  osc.stop(start + 0.6);
}

/**
 * Play the fanfare (~1.9s). No-ops silently if audio is still locked, so a
 * missed unlock never throws in the middle of a reveal.
 */
export function playDraftChime(volume = 1): void {
  const c = getCtx();
  if (!c || c.state !== "running") return;

  const t = c.currentTime + 0.02;
  const master = c.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume)) * 0.32;
  master.connect(c.destination);

  // Notes: G4 → C5 → E5 rising call, landing on a big C major chord.
  const G4 = 392.0, C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;

  thump(c, master, t);

  voice(c, master, G4, t + 0.10, 0.34, 0.55);
  voice(c, master, C5, t + 0.28, 0.34, 0.6);
  voice(c, master, E5, t + 0.46, 0.34, 0.6);

  // Landing chord
  const chordAt = t + 0.66;
  voice(c, master, C5, chordAt, 1.25, 0.6);
  voice(c, master, E5, chordAt, 1.25, 0.5);
  voice(c, master, G5, chordAt, 1.25, 0.5);
  voice(c, master, C6, chordAt, 1.25, 0.35, "triangle");

  // Shimmer on top of the landing
  voice(c, master, C6 * 1.5, chordAt + 0.05, 1.0, 0.12, "sine");
}
