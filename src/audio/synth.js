/**
 * Procedural sleep sounds built with the Web Audio API.
 *
 * Every layer is generated locally, so the site is fully usable before any
 * mp3/ogg files exist. The engine prefers a real file when one is registered
 * in assets/audio/manifest.json and falls back to these generators otherwise.
 *
 * Each generator receives a Builder that tracks its nodes so the engine can
 * tear a layer down cleanly when the user switches it off.
 */

import { createNoiseBuffer } from "./util.js";

const CRACKLE_CACHE = new WeakMap();

class Builder {
  constructor(ctx, output) {
    this.ctx = ctx;
    this.output = output;
    this.nodes = [];
    this.timers = new Set();
    this.stopped = false;
  }

  keep(node) {
    this.nodes.push(node);
    return node;
  }

  noise(type) {
    const source = this.keep(this.ctx.createBufferSource());
    source.buffer = createNoiseBuffer(this.ctx, type);
    source.loop = true;
    source.start();
    return source;
  }

  gain(value = 1) {
    const node = this.keep(this.ctx.createGain());
    node.gain.value = value;
    return node;
  }

  filter(type, frequency, q = 0.707) {
    const node = this.keep(this.ctx.createBiquadFilter());
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  pan(value = 0) {
    if (typeof this.ctx.createStereoPanner !== "function") return this.gain(1);
    const node = this.keep(this.ctx.createStereoPanner());
    node.pan.value = value;
    return node;
  }

  chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  /** Additive LFO: param.value stays the offset, the LFO adds movement. */
  lfo(frequency, depth, offset, param) {
    const osc = this.keep(this.ctx.createOscillator());
    osc.type = "sine";
    osc.frequency.value = frequency;
    const amp = this.keep(this.ctx.createGain());
    amp.gain.value = depth;
    osc.connect(amp);
    amp.connect(param);
    if (Number.isFinite(offset)) param.value = offset;
    osc.start();
    return osc;
  }

  /** Run a short one-shot generator at a random interval. */
  every(minMs, maxMs, callback) {
    const schedule = () => {
      if (this.stopped) return;
      const wait = minMs + Math.random() * Math.max(1, maxMs - minMs);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.stopped) return;
        try {
          callback(this.ctx.currentTime + 0.06);
        } catch {
          /* A single failed accent must never stop the ambience. */
        }
        schedule();
      }, wait);
      this.timers.add(timer);
    };
    schedule();
  }

  dispose() {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    try {
      this.output.disconnect();
    } catch {
      /* already disconnected */
    }
    for (const node of this.nodes) {
      try {
        if (typeof node.stop === "function") node.stop();
      } catch {
        /* one-shot sources may already be finished */
      }
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.nodes.length = 0;
  }
}

function crackleBuffer(ctx) {
  const cached = CRACKLE_CACHE.get(ctx);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * 0.16);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const env = Math.pow(1 - i / length, 3.2);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  CRACKLE_CACHE.set(ctx, buffer);
  return buffer;
}

function addCrackles(builder) {
  const buffer = crackleBuffer(builder.ctx);
  builder.every(90, 620, (time) => {
    const source = builder.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.7 + Math.random() * 0.8;

    const filter = builder.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 700 + Math.random() * 2600;
    filter.Q.value = 0.8;

    const gain = builder.ctx.createGain();
    gain.gain.value = 0.12 + Math.random() * 0.32;

    const pan = builder.ctx.createStereoPanner
      ? builder.ctx.createStereoPanner()
      : builder.ctx.createGain();
    if (pan.pan) pan.pan.value = Math.random() * 1.6 - 0.8;

    source.connect(filter).connect(gain).connect(pan).connect(builder.output);
    source.start(time);
    source.onended = () => {
      try {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
        pan.disconnect();
      } catch {
        /* nodes already released */
      }
    };
  });
}

function addBird(builder, time) {
  const { ctx } = builder;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  if (pan.pan) pan.pan.value = Math.random() * 1.4 - 0.7;
  const bus = ctx.createGain();
  bus.gain.value = 1;
  pan.connect(bus).connect(builder.output);

  const base = 1900 + Math.random() * 1500;
  const notes = 2 + Math.floor(Math.random() * 3);

  for (let i = 0; i < notes; i += 1) {
    const start = time + i * 0.17;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(base * (1 + Math.random() * 0.08), start);
    osc.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.2), start + 0.07);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.028, start + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);

    osc.connect(env).connect(bus);
    osc.start(start);
    osc.stop(start + 0.18);
    osc.onended = () => {
      try {
        osc.disconnect();
        env.disconnect();
      } catch {
        /* released */
      }
    };
  }

  setTimeout(() => {
    try {
      pan.disconnect();
      bus.disconnect();
    } catch {
      /* released */
    }
  }, 1800);
}

const BUILDERS = {
  rain(b) {
    const body = b.noise("pink");
    const highpass = b.filter("highpass", 620, 0.5);
    const lowpass = b.filter("lowpass", 5600, 0.35);
    const shape = b.gain(0.45);
    b.chain(body, highpass, lowpass, shape, b.output);
    b.lfo(0.045, 1300, 4800, lowpass.frequency);
    b.lfo(0.09, 0.06, 0.42, shape.gain);

    const rumble = b.noise("brown");
    const rumbleFilter = b.filter("lowpass", 170, 0.8);
    const rumbleGain = b.gain(0.24);
    b.chain(rumble, rumbleFilter, rumbleGain, b.output);
  },

  ocean(b) {
    const surf = b.noise("brown");
    const lowpass = b.filter("lowpass", 520, 0.9);
    const swell = b.gain(0.32);
    b.chain(surf, lowpass, swell, b.output);
    b.lfo(0.072, 240, 470, lowpass.frequency);
    b.lfo(0.072, 0.19, 0.3, swell.gain);

    const spray = b.noise("white");
    const bandpass = b.filter("bandpass", 2400, 0.8);
    const sprayGain = b.gain(0.018);
    b.chain(spray, bandpass, sprayGain, b.output);
    b.lfo(0.072, 1200, 2300, bandpass.frequency);
  },

  forest(b) {
    const air = b.noise("pink");
    const lowpass = b.filter("lowpass", 2100, 0.5);
    const airGain = b.gain(0.42);
    b.chain(air, lowpass, airGain, b.output);
    b.lfo(0.035, 600, 1700, lowpass.frequency);

    const leaves = b.noise("white");
    const bandpass = b.filter("bandpass", 3200, 0.6);
    const leafGain = b.gain(0.014);
    b.chain(leaves, bandpass, leafGain, b.output);
    b.lfo(0.6, 0.008, 0.014, leafGain.gain);

    b.every(5200, 14000, (time) => addBird(b, time));
  },

  fireplace(b) {
    const fire = b.noise("brown");
    const lowpass = b.filter("lowpass", 720, 0.7);
    const fireGain = b.gain(0.3);
    b.chain(fire, lowpass, fireGain, b.output);
    b.lfo(0.12, 0.06, 0.3, fireGain.gain);

    const hiss = b.noise("white");
    const bandpass = b.filter("bandpass", 2300, 0.9);
    const hissGain = b.gain(0.01);
    b.chain(hiss, bandpass, hissGain, b.output);

    addCrackles(b);
  },

  "white-noise"(b) {
    const source = b.noise("white");
    const lowpass = b.filter("lowpass", 9000, 0.4);
    const gain = b.gain(0.3);
    b.chain(source, lowpass, gain, b.output);
  },

  "pink-noise"(b) {
    const source = b.noise("pink");
    const lowpass = b.filter("lowpass", 6200, 0.4);
    const gain = b.gain(0.38);
    b.chain(source, lowpass, gain, b.output);
  },

  "brown-noise"(b) {
    const source = b.noise("brown");
    const lowpass = b.filter("lowpass", 420, 0.6);
    const gain = b.gain(0.42);
    b.chain(source, lowpass, gain, b.output);
  },

  wind(b) {
    const source = b.noise("pink");
    const bandpass = b.filter("bandpass", 520, 0.7);
    const gain = b.gain(0.55);
    b.chain(source, bandpass, gain, b.output);
    b.lfo(0.05, 240, 460, bandpass.frequency);
    b.lfo(0.07, 0.1, 0.3, gain.gain);
  },

  stream(b) {
    const source = b.noise("white");
    const bandpass = b.filter("bandpass", 2400, 0.8);
    const gain = b.gain(0.3);
    b.chain(source, bandpass, gain, b.output);
    b.lfo(0.5, 700, 2100, bandpass.frequency);
    b.lfo(1.1, 0.02, 0.15, gain.gain);

    const body = b.noise("brown");
    const lowpass = b.filter("lowpass", 600, 0.6);
    const bodyGain = b.gain(0.14);
    b.chain(body, lowpass, bodyGain, b.output);
  },

  fan(b) {
    const source = b.noise("brown");
    const lowpass = b.filter("lowpass", 380, 0.5);
    const gain = b.gain(0.3);
    b.chain(source, lowpass, gain, b.output);

    const hum = b.keep(b.ctx.createOscillator());
    hum.type = "sine";
    hum.frequency.value = 92;
    const humGain = b.gain(0.006);
    hum.connect(humGain).connect(b.output);
    hum.start();
  },

  "distant-train"(b) {
    const source = b.noise("brown");
    const lowpass = b.filter("lowpass", 230, 0.7);
    const gain = b.gain(0.3);
    b.chain(source, lowpass, gain, b.output);
    b.lfo(0.018, 0.07, 0.3, gain.gain);

    const rumble = b.keep(b.ctx.createOscillator());
    rumble.type = "sine";
    rumble.frequency.value = 58;
    const rumbleGain = b.gain(0.006);
    rumble.connect(rumbleGain).connect(b.output);
    rumble.start();
  },

  "soft-music"(b) {
    const bus = b.gain(1);
    const lowpass = b.filter("lowpass", 900, 0.4);
    b.chain(bus, lowpass, b.output);
    b.lfo(0.011, 260, 780, lowpass.frequency);

    // Dm7 and Bbmaj7, slowly morphing into each other.
    const chords = [
      { notes: [146.83, 174.61, 220.0, 261.63], pan: -0.22, phase: 1 },
      { notes: [116.54, 174.61, 220.0, 293.66], pan: 0.22, phase: -1 },
    ];

    for (const chord of chords) {
      const chordGain = b.gain(0.7);
      const pan = b.pan(chord.pan);
      b.chain(chordGain, pan, bus);
      b.lfo(0.016, 0.15 * chord.phase, 0.7, chordGain.gain);

      for (const frequency of chord.notes) {
        for (const detune of [-5, 5]) {
          const osc = b.keep(b.ctx.createOscillator());
          osc.type = "sine";
          osc.frequency.value = frequency;
          osc.detune.value = detune;
          const noteGain = b.gain(0.05);
          b.chain(osc, noteGain, chordGain);
          osc.start();
        }
      }
    }

    const shimmer = b.keep(b.ctx.createOscillator());
    shimmer.type = "sine";
    shimmer.frequency.value = 587.33;
    const shimmerGain = b.gain(0.012);
    shimmer.connect(shimmerGain).connect(b.output);
    b.lfo(0.03, 0.006, 0.012, shimmerGain.gain);
    shimmer.start();
  },
};

export function createSynthLayer(ctx, sound) {
  if (!sound || sound.reserved) return null;
  const build = BUILDERS[sound.synth || sound.id];
  if (!build) return null;

  const output = ctx.createGain();
  output.gain.value = Number.isFinite(sound.trim) ? sound.trim : 0.9;
  const builder = new Builder(ctx, output);

  try {
    build(builder);
  } catch (error) {
    builder.dispose();
    throw error;
  }

  return {
    kind: "synth",
    output,
    start() {},
    stop() {
      builder.dispose();
    },
  };
}

export function hasSynth(soundId) {
  return Boolean(BUILDERS[soundId]);
}
