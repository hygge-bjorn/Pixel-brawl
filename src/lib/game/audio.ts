/**
 * PIXEL BRAWL — chiptune audio engine.
 *
 * Everything (5 looping music themes + all SFX) is synthesised live with the
 * Web Audio API, so the game ships with zero audio assets and works offline.
 */

type Wave = OscillatorType;

interface Track {
  pattern: string;
  wave: Wave;
  gain: number;
  detune?: number;
  octave?: number;
  glide?: boolean;
}

export interface Theme {
  id: string;
  name: string;
  bpm: number;
  lead: Track;
  harmony?: Track;
  bass: Track;
  drums: string;
}

const NOTE_INDEX: Record<string, number> = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
};

function noteToFreq(token: string): number | null {
  if (!token || token === "." || token === "-") return null;
  const m = /^([A-G]#?)(-?\d)$/.exec(token);
  if (!m) return null;
  const semi = NOTE_INDEX[m[1]] + (parseInt(m[2], 10) + 1) * 12;
  return 440 * Math.pow(2, (semi - 69) / 12);
}

export const THEMES: Record<string, Theme> = {
  menu: {
    id: "menu",
    name: "Arcade Ignition",
    bpm: 126,
    lead: {
      wave: "square", gain: 0.3, detune: 6,
      pattern:
        "A4 . C5 E5 . D5 . C5 B4 . . G4 A4 . . . A4 . C5 E5 . G5 . F5 E5 . C5 . D5 . . .",
    },
    harmony: {
      wave: "triangle", gain: 0.16, octave: -1,
      pattern: "A3 . E3 . C4 . E3 . G3 . D3 . B3 . D3 .",
    },
    bass: {
      wave: "sawtooth", gain: 0.22,
      pattern: "A1 . A1 . F1 . F1 . G1 . G1 . E1 . E1 .",
    },
    drums: "K . H . S . H . K . H K S . H .",
  },
  neon_rooftop: {
    id: "neon_rooftop",
    name: "Neon Overdrive",
    bpm: 146,
    lead: {
      wave: "square", gain: 0.28, detune: 8,
      pattern:
        "E5 . B4 E5 . G5 . F#5 E5 . B4 . D5 . B4 . C5 . G4 C5 . E5 . D5 B4 . G4 . A4 . B4 .",
    },
    harmony: {
      wave: "sawtooth", gain: 0.12, octave: -1,
      pattern: "E4 B3 E4 G4 B3 E4 G4 B4 C4 G3 C4 E4 G3 C4 E4 G4",
    },
    bass: {
      wave: "sawtooth", gain: 0.24,
      pattern: "E1 E1 . E1 B0 . E1 . D1 D1 . D1 A0 . D1 .",
    },
    drums: "K . H H S . H . K K H . S . H H",
  },
  jungle_ruins: {
    id: "jungle_ruins",
    name: "Jade Canopy",
    bpm: 124,
    lead: {
      wave: "square", gain: 0.27,
      pattern:
        "D5 . F5 . A5 . G5 F5 E5 . D5 . C5 . D5 . F5 . A5 . C6 . A5 . G5 . F5 E5 D5 . . .",
    },
    harmony: {
      wave: "triangle", gain: 0.15, octave: -1,
      pattern: "D4 . A3 . F4 . A3 . C4 . G3 . E4 . G3 .",
    },
    bass: {
      wave: "triangle", gain: 0.26,
      pattern: "D1 . D1 A1 . D1 . . C1 . C1 G1 . C1 . .",
    },
    drums: "K . H . S H . H K . K . S . H H",
  },
  lava_forge: {
    id: "lava_forge",
    name: "Molten Anvil",
    bpm: 154,
    lead: {
      wave: "square", gain: 0.29, detune: 11,
      pattern:
        "F#4 . F#4 G4 . F#4 . C#5 B4 . A4 . G4 . F#4 . F#4 . A4 . C#5 . D5 . C#5 . B4 A4 G4 . F#4 .",
    },
    harmony: {
      wave: "sawtooth", gain: 0.13, octave: -1,
      pattern: "F#3 . C#4 . F#3 . A3 . D3 . A3 . C#3 . G#3 .",
    },
    bass: {
      wave: "sawtooth", gain: 0.27,
      pattern: "F#0 F#0 . F#0 . G0 . F#0 D1 . D1 . C#1 . C#1 .",
    },
    drums: "K K H . S . H K K . H H S . S .",
  },
  frost_spire: {
    id: "frost_spire",
    name: "Aurora Frost",
    bpm: 114,
    lead: {
      wave: "triangle", gain: 0.32,
      pattern:
        "C5 . E5 . G5 . F#5 . G5 . B5 . A5 . G5 . E5 . G5 . C6 . B5 . A5 . G5 . E5 . D5 .",
    },
    harmony: {
      wave: "square", gain: 0.1, octave: -1,
      pattern: "C4 . G3 . E4 . G3 . D4 . A3 . F#4 . A3 .",
    },
    bass: {
      wave: "triangle", gain: 0.24,
      pattern: "C1 . . G1 . . A1 . F1 . . C2 . . G1 .",
    },
    drums: "K . . H S . . H K . . H S . H H",
  },
};

class ChipAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private theme: Theme | null = null;
  private step = 0;
  private nextTime = 0;
  private musicVol = 0.5;
  private sfxVol = 0.7;
  muted = false;

  /** Must be called from a user gesture (browsers block audio otherwise). */
  init(): boolean {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return true;
    }
    try {
      const Ctor: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) {
        console.warn("[audio] Web Audio API unavailable in this browser");
        return false;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVol;
      this.musicBus.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxVol;
      this.sfxBus.connect(this.master);

      const len = Math.floor(this.ctx.sampleRate * 0.6);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      console.log("[audio] chiptune engine ready");
      return true;
    } catch (err) {
      console.error("[audio] failed to create AudioContext:", err);
      return false;
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.03);
    }
  }

  setMusicVolume(v: number) {
    this.musicVol = v;
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setSfxVolume(v: number) {
    this.sfxVol = v;
    if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  get currentThemeName(): string {
    return this.theme ? this.theme.name : "—";
  }

  playTheme(id: string) {
    if (!this.init()) return;
    const theme = THEMES[id];
    if (!theme) {
      console.warn("[audio] unknown theme:", id);
      return;
    }
    if (this.theme && this.theme.id === theme.id && this.timer) return;
    this.stopTheme();
    this.theme = theme;
    this.step = 0;
    this.nextTime = this.ctx!.currentTime + 0.08;
    this.timer = setInterval(() => this.scheduler(), 25);
    console.log("[audio] playing theme:", theme.name);
  }

  stopTheme() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.theme = null;
  }

  private scheduler() {
    if (!this.ctx || !this.theme) return;
    const stepDur = 60 / this.theme.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.14) {
      this.playStep(this.theme, this.step, this.nextTime, stepDur);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  private playStep(theme: Theme, step: number, time: number, stepDur: number) {
    this.playTrack(theme.lead, step, time, stepDur * 0.95);
    if (theme.harmony) this.playTrack(theme.harmony, step, time, stepDur * 0.9);
    this.playTrack(theme.bass, step, time, stepDur * 1.6);
    const drums = theme.drums.split(" ").filter(Boolean);
    const hit = drums[step % drums.length];
    if (hit === "K") this.kick(time);
    else if (hit === "S") this.snare(time);
    else if (hit === "H") this.hat(time);
  }

  private playTrack(track: Track, step: number, time: number, dur: number) {
    const tokens = track.pattern.split(" ").filter(Boolean);
    const token = tokens[step % tokens.length];
    let freq = noteToFreq(token);
    if (freq == null) return;
    if (track.octave) freq *= Math.pow(2, track.octave);
    this.blip(freq, time, dur, track.wave, track.gain, track.detune || 0, this.musicBus!);
  }

  private blip(
    freq: number, time: number, dur: number, wave: Wave, gain: number,
    detune: number, bus: GainNode
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, time);
    if (detune) osc.detune.setValueAtTime(detune, time);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.008);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.35), time + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private noise(time: number, dur: number, gain: number, filterFreq: number, q = 1) {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(filterFreq, time);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.musicBus!);
    src.start(time);
    src.stop(time + dur + 0.02);
  }

  private kick(time: number) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    osc.connect(g);
    g.connect(this.musicBus!);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private snare(time: number) {
    this.noise(time, 0.16, 0.34, 1900, 0.8);
  }

  private hat(time: number) {
    this.noise(time, 0.05, 0.13, 8200, 1.4);
  }

  /* ----------------------------- SFX ----------------------------- */

  private sfxBlip(freq: number, dur: number, wave: Wave, gain: number, slide = 0) {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private sfxNoise(dur: number, gain: number, freq: number, q = 1, sweepTo?: number) {
    if (!this.ctx || !this.noiseBuffer || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  swing() { this.sfxNoise(0.09, 0.16, 1200, 0.9, 3000); }
  hitLight() { this.sfxNoise(0.1, 0.3, 1500, 1.2, 500); this.sfxBlip(420, 0.08, "square", 0.16, -220); }
  hitHeavy() { this.sfxNoise(0.22, 0.42, 900, 0.7, 180); this.sfxBlip(230, 0.16, "square", 0.22, -160); }
  shieldUp() { this.sfxBlip(660, 0.1, "sine", 0.18, 240); }
  shieldHit() { this.sfxBlip(300, 0.12, "triangle", 0.2, -120); }
  jump() { this.sfxBlip(330, 0.11, "square", 0.16, 320); }
  doubleJump() { this.sfxBlip(480, 0.11, "square", 0.14, 360); }
  dodge() { this.sfxNoise(0.14, 0.14, 2600, 1.6, 700); }
  projectile() { this.sfxBlip(760, 0.13, "sawtooth", 0.14, -480); }
  ko() {
    this.sfxNoise(0.55, 0.42, 1400, 0.5, 120);
    this.sfxBlip(180, 0.5, "square", 0.24, -140);
  }
  blastoff() { this.sfxBlip(1100, 0.35, "sawtooth", 0.2, -950); }
  select() { this.sfxBlip(720, 0.06, "square", 0.14, 120); }
  confirm() { this.sfxBlip(560, 0.07, "square", 0.16); setTimeout(() => this.sfxBlip(880, 0.12, "square", 0.16), 70); }
  back() { this.sfxBlip(400, 0.09, "square", 0.14, -140); }
  countdown(n: number) { this.sfxBlip(n === 0 ? 880 : 520, n === 0 ? 0.3 : 0.14, "square", 0.22); }
  victory() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => setTimeout(() => this.sfxBlip(f, 0.26, "square", 0.2), i * 110));
  }
}

export const chipAudio = new ChipAudio();
