/**
 * Public entry point for the sleep audio system.
 *
 * Import the singleton:
 *   import { audioEngine } from "./audio/index.js";
 *
 * Or create an isolated engine (useful for tests):
 *   import { createSleepAudioEngine } from "./audio/index.js";
 *
 * See docs/audio-engine.md for the AI voice integration contract.
 */

import { SleepAudioEngine } from "./engine.js";

export const audioEngine = new SleepAudioEngine();

export function createSleepAudioEngine(options) {
  return new SleepAudioEngine(options);
}

export { SleepAudioEngine };
export { SOUNDS, CORE_SOUNDS, EXTRA_SOUNDS, SOUND_BY_ID, SOUND_LABEL, resolveSoundId, getSound } from "./catalog.js";
export { FADE_OUT_CHOICES } from "./engine.js";
