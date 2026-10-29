// Tokkip's sounds in Healthy PC: the same WAVs as Tokkip PC and the phone
// (copied into public/sounds by scripts/sync-tokkip.mjs), soft by default.
// The same shape as Tokkip PC's engine (play, fadeOut), without its custom sounds.

export const SOUND_NAMES = ["finish", "pop", "blip", "greet", "love", "slap", "annoyed", "dizzy", "proud", "level_up", "error", "open", "close", "tick"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

const KEY = "tokkip.sound";

class SoundEngine {
  enabled = true;
  volume = 0.12;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private playing = new Map<string, Set<{ src: AudioBufferSourceNode; gain: GainNode }>>();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { enabled?: boolean; volume?: number };
      if (typeof saved.enabled === "boolean") this.enabled = saved.enabled;
      if (typeof saved.volume === "number") this.volume = Math.max(0, Math.min(0.2, saved.volume));
    } catch {
      /* first run, or no storage */
    }
  }

  preload(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (typeof window === "undefined" || !window.AudioContext) return;
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
      await Promise.all(
        SOUND_NAMES.map(async (name) => {
          try {
            const res = await fetch(`/sounds/${name}.wav`);
            if (res.ok) this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
          } catch {
            /* a missing sound never breaks the app */
          }
        }),
      );
    })();
    return this.loading;
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ enabled: this.enabled, volume: this.volume }));
    } catch {
      /* not kept */
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.save();
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(0.2, v));
    if (this.master) this.master.gain.value = this.volume;
    this.save();
  }

  play(name: SoundName | string) {
    if (!this.enabled) return;
    const { ctx, master } = this;
    const buf = this.buffers.get(name);
    if (!ctx || !master || !buf) {
      void this.preload();
      return;
    }
    if (ctx.state === "suspended") void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(master);
    const voice = { src, gain };
    let voices = this.playing.get(name);
    if (!voices) this.playing.set(name, (voices = new Set()));
    voices.add(voice);
    src.onended = () => {
      voices.delete(voice);
      gain.disconnect();
    };
    src.start();
  }

  fadeOut(name: string, seconds: number) {
    const ctx = this.ctx;
    const voices = this.playing.get(name);
    if (!ctx || !voices) return;
    const t = ctx.currentTime;
    for (const { src, gain } of voices) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + seconds);
      try {
        src.stop(t + seconds);
      } catch {
        /* already stopped */
      }
    }
  }
}

export const Sound = new SoundEngine();
