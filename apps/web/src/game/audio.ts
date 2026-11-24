// Procedural sound: every effect is synthesised with WebAudio, so the game ships no audio files.

class Sfx {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  fx!: GainNode;
  noiseBuf!: AudioBuffer;
  ambience: { stop: () => void } | null = null;
  hum: { gain: GainNode; stop: () => void } | null = null;
  volume = 0.7;
  musicVolume = 0.5;
  muted = false;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVolume * 0.6;
    this.music.connect(this.master);
    this.fx = ctx.createGain();
    this.fx.connect(this.master);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : v;
  }
  setMusic(v: number) {
    this.musicVolume = v;
    if (this.ctx) this.music.gain.value = v * 0.6;
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private noise(dur: number, f0: number, f1: number, q: number, vol: number, type: BiquadFilterType = "bandpass", pan = 0) {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.fx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0, pan = 0) {
    const ctx = this.ensure();
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.006, vol, dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.fx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  swing(pan = 0) { this.noise(0.14, 2400, 600, 1.2, 0.35, "bandpass", pan); }
  stab(pan = 0) { this.noise(0.08, 3800, 1500, 2, 0.3, "bandpass", pan); }
  bolt(pan = 0) { this.tone(880, 0.12, "triangle", 0.18, 1600, 0, pan); this.noise(0.1, 5000, 3000, 3, 0.08, "highpass", pan); }
  fireball(pan = 0) { this.noise(0.45, 300, 1400, 0.8, 0.4, "lowpass", pan); this.tone(120, 0.4, "sawtooth", 0.08, 60, 0, pan); }
  boom(pan = 0) { this.noise(0.6, 900, 60, 0.7, 0.7, "lowpass", pan); this.tone(70, 0.5, "sine", 0.5, 30, 0, pan); }
  hit(pan = 0) { this.tone(140, 0.09, "square", 0.22, 60, 0, pan); this.noise(0.06, 1800, 500, 1, 0.25, "bandpass", pan); }
  bone(pan = 0) { this.noise(0.12, 3000, 900, 5, 0.3, "bandpass", pan); this.tone(320, 0.05, "square", 0.08, 180, 0.02, pan); }
  hurt() { this.tone(220, 0.18, "sawtooth", 0.25, 90); this.noise(0.15, 1200, 300, 1, 0.25); }
  dodge() { this.noise(0.22, 600, 2600, 0.9, 0.22, "bandpass"); }
  shield() { this.tone(520, 0.25, "triangle", 0.2, 780); this.tone(780, 0.3, "sine", 0.12, 1040, 0.05); }
  blink() { this.tone(1400, 0.18, "sine", 0.18, 300); this.noise(0.18, 6000, 1500, 2, 0.12, "bandpass"); }
  potion() { [0, 0.06, 0.12].forEach((d, i) => this.tone(500 + i * 220, 0.12, "sine", 0.15, undefined, d)); }
  windup(pan = 0) { this.tone(180, 0.25, "sawtooth", 0.06, 260, 0, pan); }
  slam(pan = 0) { this.noise(0.5, 500, 40, 0.6, 0.65, "lowpass", pan); this.tone(55, 0.45, "sine", 0.55, 28, 0, pan); }
  monsterDie(pan = 0) { this.noise(0.3, 2500, 200, 1.5, 0.35, "bandpass", pan); this.tone(260, 0.25, "square", 0.08, 70, 0, pan); }
  playerDie() { this.tone(330, 0.9, "sawtooth", 0.25, 55); this.noise(0.8, 1200, 80, 0.8, 0.3, "lowpass"); }
  chestCreak() { this.tone(90, 0.35, "sawtooth", 0.08, 140); this.noise(0.35, 700, 1200, 8, 0.12); }
  chestOpen() { this.noise(0.25, 1800, 700, 1.5, 0.2); [0, 0.07, 0.14].forEach((d, i) => this.tone(880 * (1 + i * 0.25), 0.18, "triangle", 0.12, undefined, d)); }
  pickup(rarity = 0) {
    const base = 660 + rarity * 110;
    [0, 0.05].forEach((d, i) => this.tone(base * (1 + i * 0.5), 0.1, "square", 0.08, undefined, d));
  }
  legendary() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.9, "triangle", 0.1, undefined, i * 0.07));
    this.noise(1.2, 8000, 3000, 1, 0.08, "highpass");
  }
  door() { this.tone(70, 0.6, "sawtooth", 0.15, 45); this.noise(0.6, 300, 120, 1, 0.3, "lowpass"); }
  extract() { [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, "sine", 0.12, undefined, i * 0.09)); this.noise(1.0, 400, 6000, 0.7, 0.15, "bandpass"); }
  alarm() { [0, 0.25, 0.5].forEach((d) => this.tone(440, 0.18, "square", 0.08, 330, d)); }
  gong() { this.tone(98, 2.2, "sine", 0.35, 92); this.tone(196.5, 1.8, "sine", 0.12, 190); this.tone(293, 1.5, "triangle", 0.05, 288); }
  betrayal() { this.tone(110, 0.6, "sawtooth", 0.2, 104); this.tone(116.5, 0.6, "sawtooth", 0.2, 110); this.noise(0.4, 900, 200, 2, 0.2); }
  click() { this.tone(1200, 0.04, "square", 0.05); }
  hover() { this.tone(1800, 0.02, "square", 0.02); }

  /** Low drone + distant drips. Intensity (0..1) raises tension with corruption. */
  startAmbience() {
    const ctx = this.ensure();
    if (this.ambience) return;
    const nodes: AudioScheduledSourceNode[] = [];
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 3);
    out.connect(this.music);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    lp.connect(out);
    for (const [f, det] of [[55, 0], [55, 7], [82.4, -5], [110, 3]] as const) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = 0.09;
      o.connect(g).connect(lp);
      o.start();
      nodes.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 160;
    lfo.connect(lg).connect(lp.frequency);
    lfo.start();
    nodes.push(lfo);
    let alive = true;
    const drip = () => {
      if (!alive) return;
      this.tone(1200 + Math.random() * 900, 0.15, "sine", 0.03, 400 + Math.random() * 200, 0, Math.random() * 2 - 1);
      setTimeout(drip, 1500 + Math.random() * 4000);
    };
    setTimeout(drip, 2000);
    this.ambience = {
      stop: () => {
        alive = false;
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        nodes.forEach((n) => n.stop(t + 1.6));
      },
    };
    (this as any)._ambLp = lp;
  }
  setTension(x: number) {
    const lp: BiquadFilterNode | undefined = (this as any)._ambLp;
    if (lp && this.ctx) lp.frequency.setTargetAtTime(380 + x * 900, this.ctx.currentTime, 2);
  }
  stopAmbience() {
    this.ambience?.stop();
    this.ambience = null;
    this.setHum(0);
  }

  // ---- Menu music: night-town theme (koto ostinato, soft taiko, dark pad) ----
  menu: { stop: () => void } | null = null;

  private pluckAt(t: number, freq: number, vol: number, out: AudioNode) {
    const ctx = this.ctx!;
    for (const det of [0, 5]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = freq;
      o.detune.value = det;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(5200, t);
      f.frequency.exponentialRampToValueAtTime(800, t + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(f).connect(g).connect(out);
      o.start(t);
      o.stop(t + 1);
    }
  }

  private drumAt(t: number, vol: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.75);
  }

  /** Starts the looping night-town theme (call after a user gesture). */
  startMenuMusic() {
    const ctx = this.ensure();
    if (this.menu) return;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 2.5);
    out.connect(this.music);
    // Echo gives the plucks a temple-hall tail.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.32;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    echo.connect(fb).connect(echo);
    echo.connect(wet).connect(out);
    const pluckBus = ctx.createGain();
    pluckBus.connect(out);
    pluckBus.connect(echo);
    // Pad
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const padG = ctx.createGain();
    padG.gain.value = 0.05;
    lp.connect(padG).connect(out);
    const pads = [55, 82.4, 110, 130.8].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = [0, -6, 5, 3][i];
      o.connect(lp);
      o.start();
      return o;
    });
    // A Bb D E F — the in scale, two octaves.
    const scale = [220, 233.1, 293.7, 329.6, 349.2, 440, 466.2, 587.3, 659.3];
    const phrase = [0, -1, 2, -1, 3, 2, -1, 1, 0, -1, 3, -1, 5, 4, -1, 3, 2, -1, 4, -1, 6, 5, -1, 4, 3, 2, -1, 1, 0, -1, -1, -1];
    const step = 60 / 96 / 2;
    let next = ctx.currentTime + 0.15;
    let i = 0;
    const timer = window.setInterval(() => {
      while (next < ctx.currentTime + 0.35) {
        const s = i % phrase.length;
        const bar = Math.floor(i / phrase.length) % 4;
        const n = phrase[s];
        if (n >= 0) this.pluckAt(next, scale[Math.min(scale.length - 1, n + (bar === 3 ? 2 : 0))], 0.07, pluckBus);
        if (s % 8 === 0) this.drumAt(next, bar === 3 && s === 24 ? 0.5 : 0.32, out);
        if (s === 6 || s === 22) this.drumAt(next, 0.18, out);
        next += step;
        i++;
      }
    }, 50);
    this.menu = {
      stop: () => {
        clearInterval(timer);
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
        pads.forEach((o) => o.stop(t + 0.9));
      },
    };
  }

  stopMenuMusic() {
    this.menu?.stop();
    this.menu = null;
  }

  /** Portal hum, volume by proximity (0..1). */
  setHum(level: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.hum && level > 0.01) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.fx);
      const os = [110, 164.8, 220.5].map((f) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        o.connect(g);
        o.start();
        return o;
      });
      this.hum = { gain: g, stop: () => os.forEach((o) => o.stop()) };
    }
    if (this.hum) this.hum.gain.gain.setTargetAtTime(level * 0.12, ctx.currentTime, 0.2);
    if (this.hum && level <= 0.01) {
      const h = this.hum;
      setTimeout(() => {
        if (this.hum === h && h.gain.gain.value < 0.01) {
          h.stop();
          this.hum = null;
        }
      }, 800);
    }
  }
}

export const sfx = new Sfx();
