/**
 * Simulated sleep-plan generator.
 *
 * This is deliberately a local rule engine so the prototype never needs an API
 * key. `generateSleepPlan()` is the seam for a real backend later: keep the
 * same input/output shape and replace the body with a fetch() call.
 *
 * Privacy: the generated plan only keeps a short summary of the need. It never
 * stores the raw description. Feedback entries reference the plan id, not the
 * text the user typed.
 */

import { SOUND_BY_ID } from "../audio/catalog.js";

export const DURATION_OPTIONS = [30, 60, 90];
export const DEFAULT_DURATION = 60;
export const MAX_DESCRIPTION_LENGTH = 500;
export const SLEEP_PLAN_VERSION = 1;
export const SLEEP_PLAN_DISCLAIMER =
  "这是产品原型中的规则推荐，不是医疗建议，也不代表经过临床验证的助眠效果。";

export const FEELING_TAGS = [
  {
    id: "stressed",
    label: "Stressed",
    labelZh: "压力大",
    pattern: /压力|工作|加班|论文|答辩|考试|截止|紧张|stress|deadline/i,
  },
  {
    id: "anxious",
    label: "Anxious",
    labelZh: "焦虑或烦躁",
    pattern: /焦虑|烦躁|烦|不安|心慌|anxious|panic|overwhelm/i,
  },
  {
    id: "overthinking",
    label: "Overthinking",
    labelZh: "思绪停不下来",
    pattern: /脑子|停不下来|想太多|思绪|胡思乱想|overthink|racing mind/i,
  },
  {
    id: "tired",
    label: "Physically Tired",
    labelZh: "身体疲惫",
    pattern: /累|疲惫|困|身体|tired|exhaust|fatigue/i,
  },
  {
    id: "relaxation",
    label: "Relaxation",
    labelZh: "单纯想放松",
    pattern: /放松|享受|安静|睡前时光|relax|calm|quiet/i,
  },
];

export const TAG_BY_ID = new Map(FEELING_TAGS.map((tag) => [tag.id, tag]));

export class SleepPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SleepPlanError";
    this.code = code;
  }
}

const TEMPLATES = {
  "rain-anchor": {
    title: "Rain Anchor",
    titleZh: "雨声锚点",
    summary: "先把工作压力放下来，让注意力从脑子里慢慢退出来。",
    reason:
      "你提到压力大或思绪停不下来。雨声和森林声的变化很少，先占住注意力；柔和音乐只保留一点，避免额外刺激。",
    tip: "把屏幕亮度调低，做三次慢呼吸，不用强迫自己马上睡着。",
    sounds: [
      { id: "rain", volume: 0.36 },
      { id: "forest", volume: 0.14 },
      { id: "soft-music", volume: 0.08 },
    ],
  },
  "quiet-shield": {
    title: "Quiet Shield",
    titleZh: "静音屏障",
    summary: "减少环境里的突发声音，让今晚更均匀一点。",
    reason:
      "你提到需要减少干扰，或思绪本身很吵。白噪声提供均匀的遮蔽，雨声保留一点自然感；如果觉得白噪声太硬，可以随时调低或关闭。",
    tip: "先听两分钟；如果白噪声显得太亮，把它调到 10% 以下。",
    sounds: [
      { id: "white-noise", volume: 0.18 },
      { id: "rain", volume: 0.25 },
    ],
  },
  "slow-tide": {
    title: "Slow Tide",
    titleZh: "慢潮",
    summary: "让呼吸跟着海浪慢下来，不需要刻意做什么。",
    reason:
      "你提到焦虑或烦躁。海浪的起伏比较慢，配合少量雨声和柔和音乐，适合把节奏放下来。",
    tip: "跟着海浪的起伏呼吸，不需要数秒。",
    sounds: [
      { id: "ocean", volume: 0.34 },
      { id: "rain", volume: 0.1 },
      { id: "soft-music", volume: 0.12 },
    ],
  },
  "deep-rest": {
    title: "Deep Rest",
    titleZh: "沉静休息",
    summary: "身体已经很累，今晚减少变化，让声音稳定地托住你。",
    reason:
      "你提到身体疲惫。棕噪声提供低频稳定层，雨声和少量柔和音乐让声音不单调。",
    tip: "不用再安排任何事情，把手机放远一点。",
    sounds: [
      { id: "rain", volume: 0.3 },
      { id: "brown-noise", volume: 0.16 },
      { id: "soft-music", volume: 0.08 },
    ],
  },
  "soft-landing": {
    title: "Soft Landing",
    titleZh: "柔软落地",
    summary: "今晚不需要处理什么，只留一点自然声和柔和音乐。",
    reason:
      "你只是想放松。海浪、森林和柔和音乐的变化都比较慢，适合作为睡前背景。",
    tip: "允许自己只是躺着，什么都不完成。",
    sounds: [
      { id: "ocean", volume: 0.3 },
      { id: "forest", volume: 0.18 },
      { id: "soft-music", volume: 0.12 },
    ],
  },
  "rain-drift": {
    title: "Rain Drift",
    titleZh: "雨夜漂流",
    summary: "没有明确偏好时，先用一个稳定、温和的默认组合。",
    reason:
      "目前没有足够明确的偏好，所以先用雨声、海浪和少量柔和音乐作为默认组合；随时可以换成森林、壁炉或预设。",
    tip: "先听一会儿，再决定要不要加入森林或壁炉。",
    sounds: [
      { id: "rain", volume: 0.32 },
      { id: "ocean", volume: 0.14 },
      { id: "soft-music", volume: 0.1 },
    ],
  },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeSleepInput(input = {}) {
  const description =
    typeof input.description === "string"
      ? input.description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
      : "";

  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.filter((id) => TAG_BY_ID.has(id)))]
    : [];

  const durationValue = Number(input.durationMinutes);
  const durationMinutes = DURATION_OPTIONS.includes(durationValue)
    ? durationValue
    : DEFAULT_DURATION;

  if (!description && tags.length === 0) {
    throw new SleepPlanError("EMPTY_INPUT", "写一句今晚的状态，或选择一个标签。");
  }

  return { description, tags, durationMinutes };
}

function detectSignals(description, tags) {
  const signals = new Set(tags);
  for (const tag of FEELING_TAGS) {
    if (tag.pattern.test(description)) signals.add(tag.id);
  }
  const noiseSensitive = /吵|噪音|干扰|噪声|noise|traffic|street/i.test(description);
  return { signals, noiseSensitive };
}

function chooseTemplateId(signals, noiseSensitive) {
  if (noiseSensitive && !signals.has("stressed") && !signals.has("tired")) {
    return "quiet-shield";
  }
  if (signals.has("stressed") || signals.has("overthinking")) return "rain-anchor";
  if (signals.has("anxious")) return "slow-tide";
  if (signals.has("tired")) return "deep-rest";
  if (signals.has("relaxation")) return "soft-landing";
  return "rain-drift";
}

function validSounds(sounds) {
  return sounds
    .filter((item) => SOUND_BY_ID.has(item.id) && !SOUND_BY_ID.get(item.id).reserved)
    .map((item) => ({
      id: item.id,
      volume: Number(clamp(item.volume, 0.05, 0.8).toFixed(2)),
    }));
}

function planId() {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Build a plan synchronously. Useful for tests and for a future worker that
 * receives an already-analyzed result.
 */
export function buildSleepPlan(input) {
  const normalized = normalizeSleepInput(input);
  const { signals, noiseSensitive } = detectSignals(
    normalized.description,
    normalized.tags,
  );
  const templateId = chooseTemplateId(signals, noiseSensitive);
  const template = TEMPLATES[templateId];
  const sounds = validSounds(template.sounds);

  if (sounds.length === 0) {
    throw new SleepPlanError("NO_SOUNDS", "当前没有可用的声音，请稍后再试。");
  }

  return {
    id: planId(),
    createdAt: new Date().toISOString(),
    version: SLEEP_PLAN_VERSION,
    source: "simulated-rules-v1",
    title: template.title,
    titleZh: template.titleZh,
    summary: template.summary,
    reason: template.reason,
    sounds,
    durationMinutes: normalized.durationMinutes,
    tip: template.tip,
    adjustable: [
      "每一种声音的音量",
      "打开或关闭任意声音",
      "定时器与淡出时长",
      "主音量",
      "随时切换到五套预设或手动混音",
    ],
    basedOn: [...signals],
    disclaimer: SLEEP_PLAN_DISCLAIMER,
  };
}

/**
 * Async seam for a future AI backend.
 *
 * Replace the body with something like:
 *   const response = await fetch("/api/sleep-plan", { method: "POST", ... });
 *   return response.json();
 *
 * The UI only depends on the returned plan shape. API keys must stay on the
 * server, never in this file.
 */
export async function generateSleepPlan(input, { delayMs = 650 } = {}) {
  const normalized = normalizeSleepInput(input);
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return buildSleepPlan(normalized);
}

export function getTemplateTitle(templateId) {
  return TEMPLATES[templateId]?.title ?? null;
}
