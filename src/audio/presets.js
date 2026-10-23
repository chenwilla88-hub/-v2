/**
 * Sleep Presets
 *
 * Initial mixes only: the percentages are starting volumes for the mixer,
 * not sound-pressure levels and not clinical sleep advice. Everything here
 * can be tuned later without touching the audio engine.
 *
 * `sounds` are the enabled tracks after applying the preset. Any track that is
 * not listed is switched off (the preset replaces the previous mix instead of
 * layering on top of it). `off` only exists so the card can show an explicit
 * "关闭" item for a sound that the design calls out.
 */
export const SLEEP_PRESETS = [
  {
    id: "deep-sleep",
    name: "Deep Sleep",
    nameZh: "深度放松",
    description: "适合想快点沉下去、不想再思考的夜晚。",
    timerMinutes: 60,
    sounds: [
      { id: "rain", volume: 0.4 },
      { id: "forest", volume: 0.15 },
      { id: "soft-music", volume: 0.1 },
    ],
  },
  {
    id: "ocean-calm",
    name: "Ocean Calm",
    nameZh: "海洋放松",
    description: "适合呼吸偏浅、身体还停留在白天节奏里的时候。",
    timerMinutes: 45,
    sounds: [
      { id: "ocean", volume: 0.35 },
      { id: "rain", volume: 0.1 },
      { id: "soft-music", volume: 0.15 },
    ],
  },
  {
    id: "nature-retreat",
    name: "Nature Retreat",
    nameZh: "自然疗愈",
    description: "适合想离开房间、回到自然里的夜晚。",
    timerMinutes: 60,
    sounds: [
      { id: "forest", volume: 0.35 },
      { id: "rain", volume: 0.2 },
      { id: "soft-music", volume: 0.1 },
    ],
  },
  {
    id: "cozy-night",
    name: "Cozy Night",
    nameZh: "温暖陪伴",
    description: "适合房间太安静、需要一点温度和安全感的时候。",
    timerMinutes: 45,
    sounds: [
      { id: "fireplace", volume: 0.3 },
      { id: "rain", volume: 0.2 },
      { id: "soft-music", volume: 0.1 },
    ],
  },
  {
    id: "quiet-mind",
    name: "Quiet Mind",
    nameZh: "安静思绪",
    description: "适合脑子停不下来、需要均匀遮蔽的时候。",
    timerMinutes: 45,
    sounds: [
      { id: "white-noise", volume: 0.2 },
      { id: "rain", volume: 0.25 },
    ],
    off: ["soft-music"],
  },
];

export const PRESET_BY_ID = new Map(SLEEP_PRESETS.map((preset) => [preset.id, preset]));
