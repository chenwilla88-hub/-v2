/**
 * SleepAudioEngine
 *
 * Owns the Web Audio graph and all playback state. It is deliberately
 * independent from the DOM: pages can be re-rendered freely while a session
 * keeps playing, and a future AI layer can drive it through the same API.
 *
 * Rules:
 * - No AudioContext is created until a user gesture calls play()/setTrackEnabled().
 * - Every track has its own gain, fades in/out independently, and can be mixed.
 * - Master volume sits on top of everything, followed by a soft limiter.
 * - AI voice will use the dedicated `voice` bus and `playGuidance()`.
 */

import { SOUNDS, resolveSoundId } from "./catalog.js";
import { createSynthLayer } from "./synth.js";
import { createFileLayer, loadManifest } from "./loader.js";
import { clamp, delay, rampParam } from "./util.js";

const STORAGE_KEY = "asc.audio.v1";
const MASTER_DEFAULT = 0.7;
export const FADE_OUT_CHOICES = [10, 20, 30, 45, 60];

function readStorage(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private mode or storage full: settings simply will not persist. */
  }
}

export class SleepAudioEngine {
  constructor({ storageKey = STORAGE_KEY } = {}) {
    this.storageKey = storageKey;
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.voice = null;
    this.limiter = null;

    this.playing = false;
    this.fadingOut = false;
    this.masterVolume = MASTER_DEFAULT;
    this.fadeOutSeconds = 20;
    this.manifestStatus = "unknown";

    this.timer = null;
    this.timerInterval = null;
    this.pendingTimerMinutes = null;
    this._suspendTimer = null;
    this._autoPauseTimer = null;
    this._saveTimer = null;
    this._fadeToken = 0;
    this._noticeShown = new Set();
    this._synthNoticeShown = false;
    this.guidanceSource = null;

    this._listeners = { state: new Set(), notice: new Set() };

    this.tracks = new Map(
      SOUNDS.map((def) => [
        def.id,
        {
          def,
          enabled: Boolean(def.defaultEnabled),
          volume: Number.isFinite(def.defaultVolume) ? def.defaultVolume : 0.4,
          gain: null,
          layer: null,
          status: "idle",
          sourceKind: null,
          connected: false,
          token: 0,
          error: null,
        },
      ]),
    );

    this._applyPreferences(readStorage(this.storageKey));
  }

  get supported() {
    return (
      typeof window !== "undefined" &&
      Boolean(window.AudioContext || window.webkitAudioContext)
    );
  }

  /* ------------------------------------------------------------------ */
  /* Subscriptions                                                       */
  /* ------------------------------------------------------------------ */

  subscribe(listener) {
    this._listeners.state.add(listener);
    return () => this._listeners.state.delete(listener);
  }

  onNotice(listener) {
    this._listeners.notice.add(listener);
    return () => this._listeners.notice.delete(listener);
  }

  _emit() {
    const state = this.getState();
    for (const listener of this._listeners.state) {
      try {
        listener(state);
      } catch (error) {
        console.error("[SleepAudio] state listener failed", error);
      }
    }
  }

  _notice(message, tone = "info") {
    if (!message || this._noticeShown.has(message)) return;
    this._noticeShown.add(message);
    for (const listener of this._listeners.notice) {
      try {
        listener({ message, tone });
      } catch {
        /* A broken toast must not break audio. */
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Preferences                                                         */
  /* ------------------------------------------------------------------ */

  _applyPreferences(prefs) {
    if (!prefs || typeof prefs !== "object") return;
    if (Number.isFinite(prefs.masterVolume)) {
      this.masterVolume = clamp(prefs.masterVolume, 0, 1);
    }
    if (Number.isFinite(prefs.fadeOutSeconds)) {
      this.fadeOutSeconds = clamp(prefs.fadeOutSeconds, 5, 120);
    }
    const tracks = prefs.tracks;
    if (tracks && typeof tracks === "object") {
      for (const [id, value] of Object.entries(tracks)) {
        const track = this.tracks.get(id);
        if (!track || track.def.reserved || !value) continue;
        if (typeof value.enabled === "boolean") track.enabled = value.enabled;
        if (Number.isFinite(value.volume)) track.volume = clamp(value.volume, 0, 1);
      }
    }
  }

  _savePreferences() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      const tracks = {};
      for (const [id, track] of this.tracks) {
        if (track.def.reserved) continue;
        tracks[id] = { enabled: track.enabled, volume: track.volume };
      }
      writeStorage(this.storageKey, {
        version: 1,
        masterVolume: this.masterVolume,
        fadeOutSeconds: this.fadeOutSeconds,
        tracks,
      });
    }, 180);
  }

  /* ------------------------------------------------------------------ */
  /* Audio graph                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Create the graph synchronously so it happens inside the user gesture.
   * iOS Safari is strict about resuming an AudioContext outside a gesture.
   */
  _ensureContext() {
    if (!this.supported) throw new Error("WEB_AUDIO_UNSUPPORTED");
    if (this.ctx) return this.ctx;

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtor({ latencyHint: "playback" });

    const master = ctx.createGain();
    master.gain.value = 0;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.4;

    const ambient = ctx.createGain();
    ambient.gain.value = 1;

    const voice = ctx.createGain();
    voice.gain.value = 1;

    ambient.connect(master);
    voice.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.limiter = limiter;
    this.ambient = ambient;
    this.voice = voice;

    ctx.onstatechange = () => this._emit();
    return ctx;
  }

  _cancelSuspend() {
    if (this._suspendTimer) {
      clearTimeout(this._suspendTimer);
      this._suspendTimer = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Playback                                                            */
  /* ------------------------------------------------------------------ */

  async play() {
    if (!this.supported) {
      this._notice("当前浏览器不支持 Web Audio API，暂时无法播放声音。", "warn");
      return false;
    }

    let ctx;
    try {
      ctx = this._ensureContext();
    } catch (error) {
      console.error("[SleepAudio] AudioContext failed", error);
      this._notice("声音启动失败，请刷新页面后重试。", "warn");
      return false;
    }

    this._cancelSuspend();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* The gesture may have been lost; play() is retried on the next click. */
      }
    }

    this._fadeToken += 1;
    this.playing = true;
    this.fadingOut = false;

    const pendingMinutes = this.pendingTimerMinutes;
    this.pendingTimerMinutes = null;

    for (const track of this.tracks.values()) {
      if (track.enabled && track.status !== "loading") {
        this._startTrack(track).catch((error) => {
          console.error("[SleepAudio] track start failed", error);
        });
      }
    }

    rampParam(this.master.gain, this.masterVolume, 1.8, ctx);
    if (pendingMinutes) this.startTimer(pendingMinutes, { silent: true });
    this._emit();
    return true;
  }

  pause({ fade = 1.4 } = {}) {
    if (!this.ctx) {
      this.playing = false;
      this._emit();
      return;
    }

    this.playing = false;
    this.fadingOut = false;
    this._cancelSuspend();
    rampParam(this.master.gain, 0, fade, this.ctx);

    this._suspendTimer = setTimeout(() => {
      if (this.playing || !this.ctx) return;
      this.ctx.suspend().catch(() => {});
    }, fade * 1000 + 120);

    this._emit();
  }

  async toggle() {
    if (this.playing) {
      this.pause();
      return false;
    }
    return this.play();
  }

  setMasterVolume(value) {
    this.masterVolume = clamp(Number(value) || 0, 0, 1);
    if (this.ctx && this.playing) {
      rampParam(this.master.gain, this.masterVolume, 0.2, this.ctx);
    }
    this._savePreferences();
    this._emit();
  }

  setTrackVolume(id, value) {
    const track = this.tracks.get(id);
    if (!track) return;
    track.volume = clamp(Number(value) || 0, 0, 1);
    if (this.ctx && track.gain) {
      const target = track.enabled ? this._trackLevel(track) : 0;
      rampParam(track.gain.gain, target, 0.18, this.ctx);
    }
    this._savePreferences();
    this._emit();
  }

  async setTrackEnabled(id, enabled) {
    const track = this.tracks.get(id);
    if (!track) return { ok: false, reason: "unknown" };
    if (track.def.reserved) return { ok: false, reason: "reserved" };
    if (!this.supported) {
      this._notice("当前浏览器不支持 Web Audio API，暂时无法播放声音。", "warn");
      return { ok: false, reason: "unsupported" };
    }

    const next = Boolean(enabled);
    if (track.enabled === next) return { ok: true };
    track.enabled = next;
    this._savePreferences();

    if (next) {
      if (!this.playing) {
        const started = await this.play();
        if (!started) {
          track.enabled = false;
          this._savePreferences();
          this._emit();
          return { ok: false, reason: "unsupported" };
        }
      } else {
        this._startTrack(track).catch((error) => {
          console.error("[SleepAudio] track start failed", error);
        });
      }
      this._cancelAutoPause();
    } else {
      this._stopTrack(track);
      this._scheduleAutoPause();
    }

    this._emit();
    return { ok: true };
  }

  _trackLevel(track) {
    const trim = Number.isFinite(track.def.trim) ? track.def.trim : 1;
    return clamp(track.volume * trim, 0, 1);
  }

  _cancelAutoPause() {
    if (this._autoPauseTimer) {
      clearTimeout(this._autoPauseTimer);
      this._autoPauseTimer = null;
    }
  }

  _scheduleAutoPause() {
    this._cancelAutoPause();
    this._autoPauseTimer = setTimeout(() => {
      this._autoPauseTimer = null;
      if (!this.playing) return;
      const anyEnabled = [...this.tracks.values()].some((track) => track.enabled);
      if (!anyEnabled) this.pause({ fade: 1.2 });
    }, 1900);
  }

  async _startTrack(track) {
    if (!this.ctx || track.def.reserved) return;
    if (track.status === "loading" || track.status === "playing") return;

    if (track.layer) {
      track.token += 1; // cancel a fade-out that may still be scheduled
      if (track.gain) {
        rampParam(track.gain.gain, this._trackLevel(track), track.def.fadeIn ?? 2.4, this.ctx);
      }
      track.status = "playing";
      this._emit();
      return;
    }

    const token = ++track.token;
    track.status = "loading";
    track.error = null;
    this._emit();

    let layer = null;
    try {
      layer = await this._buildLayer(track);
    } catch (error) {
      track.error = error?.message ?? "unknown";
    }

    if (token !== track.token || !track.enabled) {
      try {
        layer?.stop?.();
      } catch {
        /* the layer never started */
      }
      return;
    }

    if (!layer) {
      track.status = "error";
      this._notice(`「${track.def.label}」暂时无法播放，可以先使用其他声音。`, "warn");
      this._emit();
      return;
    }

    if (!track.gain) {
      track.gain = this.ctx.createGain();
      track.gain.gain.value = 0;
    }
    if (!track.connected) {
      track.gain.connect(this.ambient);
      track.connected = true;
    }

    track.layer = layer;
    layer.output.connect(track.gain);
    try {
      layer.start?.();
    } catch (error) {
      console.error("[SleepAudio] layer start failed", error);
    }

    rampParam(track.gain.gain, this._trackLevel(track), track.def.fadeIn ?? 2.4, this.ctx);
    track.status = "playing";
    this._emit();
  }

  async _buildLayer(track) {
    const sound = track.def;
    const manifest = await loadManifest();
    this.manifestStatus = manifest.status;

    const entry = manifest.sounds?.[sound.file || sound.id];
    if (entry?.src) {
      try {
        const layer = await createFileLayer(this.ctx, entry, manifest.baseUrl);
        track.sourceKind = "file";
        return layer;
      } catch {
        this._notice(`「${sound.label}」音频文件加载失败，已切换为内置合成音色。`, "warn");
      }
    }

    const layer = createSynthLayer(this.ctx, sound);
    track.sourceKind = layer ? "synth" : null;
    if (layer && !this._synthNoticeShown) {
      this._synthNoticeShown = true;
      this._notice("当前使用内置合成音色，无需音频文件即可播放。", "info");
    }
    return layer;
  }

  _stopTrack(track, { fade = 1.6 } = {}) {
    track.token += 1;
    if (!track.gain || !this.ctx || !track.layer) {
      track.status = "idle";
      this._destroyLayer(track);
      return;
    }

    rampParam(track.gain.gain, 0, fade, this.ctx);
    track.status = "fading";
    const token = track.token;
    setTimeout(() => {
      if (track.token !== token) return;
      this._destroyLayer(track);
      this._emit();
    }, fade * 1000 + 140);
  }

  _destroyLayer(track) {
    track.token += 1;
    try {
      track.layer?.stop?.();
    } catch {
      /* already stopped */
    }
    try {
      track.layer?.output?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      track.gain?.disconnect();
    } catch {
      /* already disconnected */
    }
    track.layer = null;
    track.gain = null;
    track.connected = false;
    track.sourceKind = null;
    track.status = "idle";
  }

  /* ------------------------------------------------------------------ */
  /* Sleep timer                                                         */
  /* ------------------------------------------------------------------ */

  startTimer(minutes, { silent = false } = {}) {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) return null;

    this.clearTimer({ silent: true });
    this.pendingTimerMinutes = null;
    const duration = value * 60 * 1000;
    this.timer = {
      minutes: value,
      endsAt: Date.now() + duration,
      remainingMs: duration,
      fading: false,
    };

    this.timerInterval = setInterval(() => this._tickTimer(), 500);
    if (!silent) {
      this._notice(`已设定 ${value < 1 ? `${Math.round(value * 60)} 秒` : `${value} 分钟`}睡眠计时，到时会自动淡出。`, "calm");
    }
    this._emit();
    return this.timer;
  }

  _tickTimer() {
    if (!this.timer || this.timer.fading) return;
    const remaining = this.timer.endsAt - Date.now();
    this.timer.remainingMs = Math.max(0, remaining);
    if (remaining <= 0) {
      this._finishTimer();
      return;
    }
    this._emit();
  }

  _clearTimerInterval() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  clearTimer({ silent = false } = {}) {
    this._clearTimerInterval();
    this.timer = null;
    this.pendingTimerMinutes = null;
    if (!silent) {
      this._notice("已取消睡眠计时。", "info");
      this._emit();
    }
  }

  async _finishTimer() {
    this._clearTimerInterval();
    const timer = this.timer;
    if (!timer) return;
    timer.fading = true;
    timer.remainingMs = 0;
    this._emit();

    if (!this.playing) {
      for (const track of this.tracks.values()) this._destroyLayer(track);
      this.timer = null;
      this._notice("睡眠计时结束，声音已停止。晚安。", "calm");
      this._emit();
      return;
    }

    this._notice(`睡眠计时结束，声音会在 ${this.fadeOutSeconds} 秒内淡出。`, "calm");
    await this.fadeOutAndStop(this.fadeOutSeconds);
    this.timer = null;
    this._notice("今晚的声音已经结束。晚安。", "calm");
    this._emit();
  }

  setFadeOutSeconds(seconds) {
    this.fadeOutSeconds = clamp(Number(seconds) || 20, 5, 120);
    this._savePreferences();
    this._emit();
  }

  async fadeOutAndStop(seconds = this.fadeOutSeconds) {
    const duration = clamp(Number(seconds) || 0, 0, 180);
    const token = ++this._fadeToken;
    this._cancelSuspend();
    this.playing = false;
    this.fadingOut = true;
    this._emit();

    if (this.ctx) {
      rampParam(this.master.gain, 0, duration, this.ctx);
      await delay(duration * 1000 + 120);
    }

    if (token !== this._fadeToken) return;

    for (const track of this.tracks.values()) this._destroyLayer(track);
    if (this.master) this.master.gain.value = 0;

    if (this.ctx) {
      try {
        await this.ctx.suspend();
      } catch {
        /* ignore */
      }
    }

    this.fadingOut = false;
    this._emit();
  }

  /* ------------------------------------------------------------------ */
  /* Mixing plan (used by the recommendation page and, later, by AI)     */
  /* ------------------------------------------------------------------ */

  async applyMix(entries = [], { autoplay = true, timerMinutes = null, fade = 0.8 } = {}) {
    const wanted = new Map();

    for (const entry of entries) {
      const id = resolveSoundId(entry?.id);
      if (!id) continue;
      const track = this.tracks.get(id);
      if (!track || track.def.reserved) continue;
      const raw = Number.isFinite(entry.volume)
        ? entry.volume
        : Number.isFinite(entry.weight)
          ? entry.weight / 100
          : track.volume;
      wanted.set(id, clamp(raw, 0.02, 1));
    }

    if (wanted.size === 0) return false;

    const transitionFade = clamp(Number(fade) || 0.8, 0.05, 10);

    for (const track of this.tracks.values()) {
      if (track.def.reserved) continue;

      const level = wanted.get(track.def.id);
      if (level !== undefined) {
        track.volume = level;
        track.enabled = true;

        if (track.gain && this.ctx) {
          rampParam(track.gain.gain, this._trackLevel(track), transitionFade, this.ctx);
        }
        if (this.playing && !track.layer) {
          this._startTrack(track).catch((error) => {
            console.error("[SleepAudio] preset track start failed", error);
          });
        } else if (this.playing && track.layer) {
          track.token += 1; // cancel a pending fade-out from the previous preset
          track.status = "playing";
        }
      } else if (track.enabled) {
        track.enabled = false;
        this._stopTrack(track, { fade: Math.max(1.4, transitionFade) });
      }
    }

    if (Number.isFinite(Number(timerMinutes)) && Number(timerMinutes) > 0) {
      if (this.playing) {
        this.startTimer(Number(timerMinutes), { silent: true });
      } else {
        this.clearTimer({ silent: true });
        this.pendingTimerMinutes = Number(timerMinutes);
      }
    }

    this._savePreferences();
    this._cancelAutoPause();

    let started = true;
    if (autoplay) {
      started = await this.play();
    } else {
      this._emit();
    }

    return started;
  }

  /* ------------------------------------------------------------------ */
  /* Reserved AI voice channel                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Play an AI generated guidance clip.
   * @param {{ buffer?: AudioBuffer, url?: string }} source
   * Future AI module: build the clip, call this, and the ambient mix is ducked
   * automatically while the voice plays.
   */
  async playGuidance(source) {
    if (!this.supported) return { ok: false, reason: "unsupported" };

    const ctx = this._ensureContext();
    if (!this.playing) await this.play();

    let buffer = source?.buffer ?? null;
    if (!buffer && source?.url) {
      try {
        const response = await fetch(source.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      } catch {
        return { ok: false, reason: "load-failed" };
      }
    }
    if (!buffer) return { ok: false, reason: "no-source" };

    this.stopGuidance();

    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    sourceNode.connect(gain).connect(this.voice);

    rampParam(gain.gain, 1, 0.5, ctx);
    this.duck(0.45, 0.6);

    const finish = () => {
      this.duck(1, 1.6);
      try {
        gain.disconnect();
        sourceNode.disconnect();
      } catch {
        /* already released */
      }
      if (this.guidanceSource?.sourceNode === sourceNode) this.guidanceSource = null;
    };

    sourceNode.onended = finish;
    sourceNode.start();
    this.guidanceSource = { sourceNode, gain };
    return { ok: true, duration: buffer.duration };
  }

  stopGuidance() {
    if (!this.guidanceSource) return;
    const { sourceNode } = this.guidanceSource;
    try {
      sourceNode.stop();
    } catch {
      /* already stopped */
    }
    this.guidanceSource = null;
    this.duck(1, 0.8);
  }

  duck(factor = 0.5, seconds = 0.6) {
    if (!this.ctx || !this.ambient) return;
    rampParam(this.ambient.gain, clamp(factor, 0, 1), seconds, this.ctx);
  }

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  getState() {
    const now = Date.now();
    const tracks = {};
    let activeCount = 0;

    for (const [id, track] of this.tracks) {
      if (track.enabled) activeCount += 1;
      tracks[id] = {
        enabled: track.enabled,
        volume: track.volume,
        status: track.status,
        sourceKind: track.sourceKind,
        error: track.error,
        reserved: Boolean(track.def.reserved),
      };
    }

    return {
      supported: this.supported,
      ready: Boolean(this.ctx),
      contextState: this.ctx?.state ?? "closed",
      playing: this.playing,
      fadingOut: this.fadingOut,
      masterVolume: this.masterVolume,
      fadeOutSeconds: this.fadeOutSeconds,
      activeCount,
      active: [...this.tracks.values()]
        .filter((track) => track.enabled)
        .map((track) => track.def.id),
      timer: this.timer
        ? {
            minutes: this.timer.minutes,
            remainingMs: Math.max(0, this.timer.endsAt - now),
            fading: this.timer.fading,
          }
        : null,
      pendingTimerMinutes: this.pendingTimerMinutes,
      tracks,
      manifestStatus: this.manifestStatus,
      hasGuidance: Boolean(this.guidanceSource),
    };
  }

  async dispose() {
    this.clearTimer({ silent: true });
    this._cancelSuspend();
    this._cancelAutoPause();
    for (const track of this.tracks.values()) this._destroyLayer(track);
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* ignore */
      }
    }
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.voice = null;
    this.playing = false;
    this._emit();
  }
}
