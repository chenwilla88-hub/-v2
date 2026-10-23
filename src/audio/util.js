/**
 * Small shared helpers for the sleep audio engine.
 * Everything here is side-effect free and safe to import before any user gesture.
 */

const NOISE_CACHE = new WeakMap();

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fillNoise(type, length) {
  const data = new Float32Array(length);

  if (type === "white") {
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return data;
  }

  if (type === "pink") {
    // Paul Kellet's refined pink noise filter.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return data;
  }

  // Brown / red noise: leaky integration of white noise.
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return data;
}

function normalize(data, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < data.length; i += 1) {
    const abs = Math.abs(data[i]);
    if (abs > max) max = abs;
  }
  if (max <= 0.0001) return data;
  const scale = peak / max;
  for (let i = 0; i < data.length; i += 1) data[i] *= scale;
  return data;
}

/**
 * Build a seamlessly looping noise buffer.
 *
 * The first `fade` samples cross-fade the tail into the head so `buffer[N - 1]`
 * continues naturally into `buffer[0]`. Without this, brown noise produces an
 * audible low "thump" on every loop.
 */
export function createNoiseBuffer(ctx, type = "white", seconds = 5) {
  let cache = NOISE_CACHE.get(ctx);
  if (!cache) {
    cache = new Map();
    NOISE_CACHE.set(ctx, cache);
  }
  const key = `${type}:${seconds}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const sampleRate = ctx.sampleRate;
  const total = Math.floor(seconds * sampleRate);
  const fade = Math.min(Math.floor(sampleRate * 0.4), Math.floor(total / 4));
  const buffer = ctx.createBuffer(2, total, sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const raw = normalize(fillNoise(type, total + fade));
    const out = buffer.getChannelData(channel);
    for (let i = 0; i < total; i += 1) {
      if (i < fade) {
        const mix = i / fade;
        out[i] = raw[i] * mix + raw[total + i] * (1 - mix);
      } else {
        out[i] = raw[i];
      }
    }
  }

  cache.set(key, buffer);
  return buffer;
}

/**
 * Smoothly ramp an AudioParam. Using cancelAndHoldAtTime keeps repeated
 * volume changes from producing zipper noise or jumps.
 */
export function rampParam(param, target, seconds = 0.2, ctx = null) {
  if (!param) return;
  const now = ctx ? ctx.currentTime : 0;

  try {
    if (seconds <= 0.01) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(target, now);
      return;
    }
    if (typeof param.cancelAndHoldAtTime === "function") {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.linearRampToValueAtTime(target, now + seconds);
  } catch {
    try {
      param.value = target;
    } catch {
      /* AudioParam is already gone with its context. */
    }
  }
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return `${Math.round(minutes * 60)} 秒`;
  return `${minutes} 分钟`;
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
