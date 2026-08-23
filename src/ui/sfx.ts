type SoundName = "open" | "write" | "solve" | "collect" | "victory" | "blocked";

const NOTES: Record<SoundName, readonly [number, number, number]> = {
  open: [280, 360, 0.08],
  write: [620, 560, 0.025],
  solve: [420, 660, 0.13],
  collect: [720, 940, 0.11],
  victory: [330, 880, 0.34],
  blocked: [180, 140, 0.07],
};

let context: AudioContext | undefined;

export function playSound(name: SoundName, enabled = true): void {
  if (!enabled || typeof AudioContext === "undefined") return;
  context ??= new AudioContext();
  const [from, to, duration] = NOTES[name];
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  oscillator.type = name === "write" ? "triangle" : "sine";
  oscillator.frequency.setValueAtTime(from, now);
  oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.035, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}
