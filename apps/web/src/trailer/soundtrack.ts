// Trailer soundtrack, synthesised offline: taiko, a pentatonic koto ostinato,
// a dark pad, risers and a big logo slam. Returns a 16-bit WAV as base64.
// The groove runs on the same beat grid as the edit, so every cut is a taiko hit.
// Levels leave headroom; the encoder normalises to -14 LUFS / -1.5 dBTP.

const SR = 44100;

function noiseBuffer(ctx: BaseAudioContext, secs: number) {
  const b = ctx.createBuffer(1, Math.ceil(secs * SR), SR);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function impulse(ctx: BaseAudioContext, secs: number, decay: number) {
  const b = ctx.createBuffer(2, Math.ceil(secs * SR), SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
  }
  return b;
}

export async function renderSoundtrack(duration: number, cuts: number[], SLAM: number, BEAT: number): Promise<string> {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);
  const master = ctx.createGain();
  master.gain.value = 0.3; // headroom: stacked hits must not clip the 16-bit WAV
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  master.connect(comp).connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 2.8, 3);
  const verbGain = ctx.createGain();
  verbGain.gain.value = 0.32;
  verb.connect(verbGain).connect(master);
  const noise = noiseBuffer(ctx, 3);

  const DROP = cuts.find((c) => c > 0) ?? BEAT * 3; // groove starts with the first gameplay cut

  // ---- instruments --------------------------------------------------------
  const taiko = (t: number, vol = 1, pitch = 1) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(42 * pitch, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.1 * vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g);
    g.connect(master);
    g.connect(verb);
    o.start(t);
    o.stop(t + 0.65);
    // skin slap
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900;
    f.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    n.connect(f).connect(ng).connect(master);
    n.start(t, Math.random());
    n.stop(t + 0.1);
  };
  const rim = (t: number, vol = 0.25) => {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 3500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    n.connect(f).connect(g).connect(master);
    n.start(t, Math.random());
    n.stop(t + 0.06);
  };
  const koto = (t: number, freq: number, vol = 0.16) => {
    // plucked string: two detuned triangles, fast decay, bright attack
    for (const det of [0, 4]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = freq;
      o.detune.value = det;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(6000, t);
      f.frequency.exponentialRampToValueAtTime(900, t + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(f).connect(g);
      g.connect(master);
      g.connect(verb);
      o.start(t);
      o.stop(t + 0.6);
    }
  };
  const whoosh = (t: number, len = 0.35, vol = 0.35) => {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(5000, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(f).connect(g).connect(master);
    n.start(t, Math.random());
    n.stop(t + len + 0.02);
  };

  // ---- dark pad (whole trailer) --------------------------------------------
  {
    const pad = ctx.createGain();
    pad.gain.setValueAtTime(0.0001, 0);
    pad.gain.exponentialRampToValueAtTime(0.16, 1.5);
    pad.gain.setValueAtTime(0.16, SLAM - 0.3);
    pad.gain.exponentialRampToValueAtTime(0.0001, SLAM - 0.05); // silence before the slam
    pad.gain.setValueAtTime(0.0001, SLAM);
    pad.gain.exponentialRampToValueAtTime(0.2, SLAM + 0.05);
    pad.gain.exponentialRampToValueAtTime(0.0001, duration);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(300, 0);
    lp.frequency.linearRampToValueAtTime(1400, SLAM - 0.3);
    lp.connect(pad);
    pad.connect(master);
    pad.connect(verb);
    for (const [f, d] of [
      [55, 0],
      [55, 9],
      [82.4, -6],
      [110, 4],
      [130.8, 0],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(lp);
      o.start(0);
      o.stop(duration);
    }
  }

  // ---- intro: lone koto + heartbeat taiko -----------------------------------
  const scale = [220, 233.1, 293.7, 329.6, 349.2, 440, 466.2, 587.3]; // A Bb D E F (in-scale)
  // Cold open: a full-strength hit on frame 0, two pickups into the drop.
  taiko(0.0, 1.4, 0.65);
  whoosh(0.0, 0.25, 0.3);
  taiko(BEAT * 1, 0.55, 0.85);
  taiko(BEAT * 2, 0.7, 0.85);
  [0, BEAT * 0.5, BEAT, BEAT * 1.5, BEAT * 2, BEAT * 2.5].forEach((t, i) => koto(t + 0.02, scale[[0, 2, 3, 1, 3, 4][i]] / 2, 0.2));

  // ---- groove: taiko pattern + koto ostinato from the first gameplay cut ----
  const barLen = BEAT * 4;
  for (let t = DROP; t < SLAM - 0.35; t += BEAT / 2) {
    const step = Math.round((t - DROP) / (BEAT / 2)) % 8;
    if (step === 0 || step === 3 || step === 4) taiko(t, step === 0 ? 0.9 : 0.6);
    if (step === 2 || step === 6) rim(t, 0.22);
    if (step % 2 === 1) rim(t, 0.1);
  }
  const ost = [0, 2, 3, 5, 3, 2, 4, 3];
  let k = 0;
  for (let t = DROP; t < SLAM - 0.35; t += BEAT / 2, k++) {
    const bar = Math.floor((t - DROP) / barLen);
    const lift = bar >= 4 ? 1 : 0; // raise the line in the second half
    koto(t, scale[(ost[k % 8] + lift) % scale.length], 0.13);
  }

  // ---- hits on every cut, whoosh into each caption -------------------------
  for (const c of cuts) {
    if (c <= 0 || c >= SLAM - 0.5) continue; // keep the pre-slam silence clean
    taiko(c, 1.2, 0.7);
    whoosh(c - 0.3, 0.3, 0.25);
  }

  // ---- riser into the title, silence, SLAM ---------------------------------
  {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx, 2.5);
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.setValueAtTime(200, SLAM - 2.2);
    f.frequency.exponentialRampToValueAtTime(8000, SLAM - 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, SLAM - 2.2);
    g.gain.exponentialRampToValueAtTime(0.45, SLAM - 0.32);
    g.gain.exponentialRampToValueAtTime(0.0001, SLAM - 0.28);
    n.connect(f).connect(g).connect(master);
    n.start(SLAM - 2.2);
    n.stop(SLAM - 0.2);
    // rising pitch sweep
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(110, SLAM - 2.0);
    o.frequency.exponentialRampToValueAtTime(880, SLAM - 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, SLAM - 2.0);
    og.gain.exponentialRampToValueAtTime(0.08, SLAM - 0.35);
    og.gain.exponentialRampToValueAtTime(0.0001, SLAM - 0.28);
    o.connect(og).connect(master);
    o.start(SLAM - 2.0);
    o.stop(SLAM - 0.2);
  }
  // the slam: stacked taiko + sub drop + crash
  taiko(SLAM, 1.6, 0.6);
  taiko(SLAM + 0.012, 1.2, 1.0);
  {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(90, SLAM);
    o.frequency.exponentialRampToValueAtTime(28, SLAM + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, SLAM);
    g.gain.exponentialRampToValueAtTime(0.0001, SLAM + 2.2);
    o.connect(g).connect(master);
    o.start(SLAM);
    o.stop(SLAM + 2.3);
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 2500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, SLAM);
    ng.gain.exponentialRampToValueAtTime(0.0001, SLAM + 1.8);
    n.connect(f).connect(ng);
    ng.connect(master);
    ng.connect(verb);
    n.start(SLAM);
    n.stop(SLAM + 2);
  }
  // "PLAY NOW" accent + closing koto phrase
  const REL = SLAM + BEAT * 3;
  taiko(REL, 1.0, 0.9);
  [REL, REL + BEAT * 0.5, REL + BEAT, REL + BEAT * 2].forEach((t, i) => koto(t + 0.02, scale[[5, 4, 3, 0][i]], 0.18));
  taiko(SLAM + BEAT * 5, 0.6, 0.8);

  const buf = await ctx.startRendering();
  return wavBase64(buf);
}

function wavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  data.setUint32(4, 36 + len * ch * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, SR, true);
  data.setUint32(28, SR * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  w(36, "data");
  data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  const bytes = new Uint8Array(data.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
