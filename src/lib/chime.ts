// Draft-night fanfare, synthesized with the Web Audio API — no asset to load,
// nothing to 404 mid-draft. A timpani thump, a rising brass triad, then a
// sustained chord with a shimmer on top: "the pick is in".

/**
 * Pull a video id out of a YouTube URL (watch, youtu.be, embed, shorts) or
 * accept a bare id. Returns null if it doesn't look like one.
 */
export function youTubeId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

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

/**
 * "The Wooglin Cup draft is LIVE" — an original ~9s anthem for the room:
 * fanfare call, a marching motif over a timpani pulse, then a big sustained
 * chord. Original composition, so there's nothing to license.
 */
export function playDraftAnthem(volume = 1): void {
  const c = getCtx();
  if (!c || c.state !== "running") return;

  const t = c.currentTime + 0.05;
  const master = c.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume)) * 0.3;
  master.connect(c.destination);

  const C3 = 130.81, G3 = 196.0, C4 = 261.63, E4 = 329.63, G4 = 392.0;
  const A4 = 440.0, B4 = 493.88, C5 = 523.25, D5 = 587.33, E5 = 659.25;
  const F5 = 698.46, G5 = 783.99, C6 = 1046.5;

  // ── Opening fanfare ──────────────────────────────────────────────
  thump(c, master, t);
  voice(c, master, C3, t, 1.6, 0.35, "triangle");        // bass pad
  voice(c, master, G4, t + 0.10, 0.30, 0.5);
  voice(c, master, C5, t + 0.32, 0.30, 0.55);
  voice(c, master, E5, t + 0.54, 0.30, 0.55);
  voice(c, master, G5, t + 0.76, 0.70, 0.6);

  // ── Marching motif over a timpani pulse ──────────────────────────
  const beat = 0.30;
  const motifStart = t + 1.70;
  thump(c, master, motifStart);
  thump(c, master, motifStart + beat * 4);
  thump(c, master, motifStart + beat * 8);
  thump(c, master, motifStart + beat * 12);

  voice(c, master, C3, motifStart, 2.4, 0.3, "triangle");

  const phrase1 = [C5, D5, E5, G5];
  phrase1.forEach((f, i) => voice(c, master, f, motifStart + i * beat, beat * 0.95, 0.5));
  // answering phrase, a third higher
  const phrase2 = [E5, F5, G5, C6];
  phrase2.forEach((f, i) => voice(c, master, f, motifStart + (i + 4) * beat, beat * 0.95, 0.5));
  // harmony underneath the answer
  [G4, A4, B4, E5].forEach((f, i) =>
    voice(c, master, f, motifStart + (i + 4) * beat, beat * 0.95, 0.28));

  // build: rising run into the finish
  [G4, A4, B4, C5, D5, E5, F5, G5].forEach((f, i) =>
    voice(c, master, f, motifStart + (8 + i * 0.5) * beat, beat * 0.5, 0.34));

  // ── Landing chord ────────────────────────────────────────────────
  const finale = motifStart + beat * 12;
  thump(c, master, finale);
  voice(c, master, C3, finale, 3.0, 0.4, "triangle");
  voice(c, master, G3, finale, 3.0, 0.3, "triangle");
  voice(c, master, C4, finale, 2.8, 0.45);
  voice(c, master, E4, finale, 2.8, 0.4);
  voice(c, master, G4, finale, 2.8, 0.4);
  voice(c, master, C5, finale, 2.8, 0.45);
  voice(c, master, E5, finale + 0.06, 2.6, 0.3);
  voice(c, master, G5, finale + 0.12, 2.5, 0.25, "triangle");
  voice(c, master, C6, finale + 0.18, 2.2, 0.16, "sine");
}

/**
 * Play the draft theme. If a track exists at /public/draft-theme.mp3 (drop in
 * any audio you have the rights to) it plays that; otherwise it falls back to
 * the synthesized anthem above. Returns a stop() handle.
 */
export function playDraftTheme(volume = 1): () => void {
  if (typeof window === "undefined") return () => {};
  let stopped = false;
  const audio = new Audio("/draft-theme.mp3");
  audio.volume = Math.max(0, Math.min(1, volume));
  audio.play()
    .then(() => { if (stopped) audio.pause(); })
    .catch(() => { if (!stopped) playDraftAnthem(volume); }); // no file (or blocked) → synth
  return () => {
    stopped = true;
    audio.pause();
    audio.currentTime = 0;
  };
}
