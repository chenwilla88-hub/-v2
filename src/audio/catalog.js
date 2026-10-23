/**
 * Sound catalog for the sleep mixer.
 *
 * This is the single source of truth for the UI and the audio engine.
 * Add or reorder sounds here; every page reads from this list.
 *
 * The 7 core sounds requested for the sleep experience live at the top.
 * `synth` selects the built-in procedural generator so the site works without
 * any audio files. `file` is the key looked up in assets/audio/manifest.json;
 * when a real file is registered there it automatically takes priority.
 */
export const SOUNDS = [
  {
    id: "rain",
    label: "雨声",
    name: "Rain",
    category: "自然环境",
    role: "稳定背景层",
    core: true,
    defaultVolume: 0.55,
    defaultEnabled: true,
    trim: 0.95,
    fadeIn: 2.6,
    synth: "rain",
    file: "rain",
  },
  {
    id: "ocean",
    label: "海浪",
    name: "Ocean",
    category: "自然环境",
    role: "缓慢周期感",
    core: true,
    defaultVolume: 0.5,
    defaultEnabled: false,
    trim: 0.95,
    fadeIn: 2.8,
    synth: "ocean",
    file: "ocean",
  },
  {
    id: "forest",
    label: "森林",
    name: "Forest",
    category: "自然环境",
    role: "低亮度环境",
    core: true,
    defaultVolume: 0.45,
    defaultEnabled: false,
    trim: 1,
    fadeIn: 3,
    synth: "forest",
    file: "forest",
  },
  {
    id: "fireplace",
    label: "壁炉",
    name: "Fireplace",
    category: "室内环境",
    role: "安全感纹理",
    core: true,
    defaultVolume: 0.42,
    defaultEnabled: false,
    trim: 1,
    fadeIn: 2.6,
    synth: "fireplace",
    file: "fireplace",
  },
  {
    id: "white-noise",
    label: "白噪声",
    name: "White Noise",
    category: "噪声",
    role: "均匀遮蔽",
    core: true,
    defaultVolume: 0.32,
    defaultEnabled: false,
    trim: 0.85,
    fadeIn: 2.2,
    synth: "white-noise",
    file: "white-noise",
  },
  {
    id: "soft-music",
    label: "柔和音乐",
    name: "Soft Music",
    category: "音乐",
    role: "柔和情绪层",
    core: true,
    defaultVolume: 0.4,
    defaultEnabled: false,
    trim: 0.9,
    fadeIn: 4,
    synth: "soft-music",
    file: "soft-music",
  },
  {
    id: "ai-guidance",
    label: "AI 睡眠引导",
    name: "AI Sleep Guidance",
    category: "语音",
    role: "入睡引导",
    core: true,
    reserved: true,
    defaultVolume: 0.6,
    defaultEnabled: false,
    trim: 1,
    hint: "AI 语音通道已预留。接入 AI 后，这里会播放为你生成的引导语音。",
  },
  {
    id: "brown-noise",
    label: "棕噪声",
    name: "Brown Noise",
    category: "噪声",
    role: "低频稳定层",
    defaultVolume: 0.38,
    defaultEnabled: false,
    trim: 0.85,
    fadeIn: 2.2,
    synth: "brown-noise",
    file: "brown-noise",
  },
  {
    id: "pink-noise",
    label: "粉红噪声",
    name: "Pink Noise",
    category: "噪声",
    role: "温和遮蔽",
    defaultVolume: 0.34,
    defaultEnabled: false,
    trim: 0.85,
    fadeIn: 2.2,
    synth: "pink-noise",
    file: "pink-noise",
  },
  {
    id: "wind",
    label: "风声",
    name: "Wind",
    category: "自然环境",
    role: "空气感与遮蔽",
    defaultVolume: 0.3,
    defaultEnabled: false,
    trim: 0.9,
    fadeIn: 3.2,
    synth: "wind",
    file: "wind",
  },
  {
    id: "stream",
    label: "溪流",
    name: "Stream",
    category: "自然环境",
    role: "轻微流动感",
    defaultVolume: 0.35,
    defaultEnabled: false,
    trim: 0.9,
    fadeIn: 2.8,
    synth: "stream",
    file: "stream",
  },
  {
    id: "fan",
    label: "风扇",
    name: "Fan",
    category: "室内环境",
    role: "恒定机械声",
    defaultVolume: 0.28,
    defaultEnabled: false,
    trim: 0.85,
    fadeIn: 2,
    synth: "fan",
    file: "fan",
  },
  {
    id: "distant-train",
    label: "远处火车",
    name: "Distant Train",
    category: "室内环境",
    role: "低变化陪伴",
    defaultVolume: 0.28,
    defaultEnabled: false,
    trim: 0.9,
    fadeIn: 3.4,
    synth: "distant-train",
    file: "distant-train",
  },
];

export const CORE_SOUNDS = SOUNDS.filter((sound) => sound.core);
export const EXTRA_SOUNDS = SOUNDS.filter((sound) => !sound.core);

export const SOUND_BY_ID = new Map(SOUNDS.map((sound) => [sound.id, sound]));

/** Older recommendation/UI ids that predate the catalog. */
export const LEGACY_ALIASES = {
  "light-rain": "rain",
  "ambient-pad": "soft-music",
};

export function resolveSoundId(id) {
  if (!id) return null;
  if (SOUND_BY_ID.has(id)) return id;
  return LEGACY_ALIASES[id] ?? null;
}

export function getSound(id) {
  const resolved = resolveSoundId(id);
  return resolved ? SOUND_BY_ID.get(resolved) : null;
}

export const SOUND_LABEL = new Map(SOUNDS.map((sound) => [sound.id, sound.label]));
