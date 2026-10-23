/**
 * Sleep-experience feedback store (local demo only).
 *
 * The feedback object is intentionally independent from the AI plan module so
 * it can later be sent to a backend / analyzed by another model without
 * changing the UI.
 *
 * Privacy:
 * - stored only in this browser's localStorage
 * - never includes the raw "how are you feeling" description or its tags
 * - no automatic upload, no cross-device sync
 */

export const FEEDBACK_STORAGE_KEY = "asc.feedback.v1";
export const FEEDBACK_MAX_ENTRIES = 100;
export const FEEDBACK_COMMENT_MAX = 400;

export const SOUND_COMFORT_OPTIONS = [
  { value: "too-loud", label: "太大" },
  { value: "too-soft", label: "太小" },
  { value: "just-right", label: "合适" },
  { value: "too-noisy", label: "太吵" },
  { value: "other", label: "其他" },
];

export const PLAN_MATCH_OPTIONS = [
  { value: "matches", label: "符合" },
  { value: "partial", label: "部分符合" },
  { value: "no", label: "不符合" },
];

export const REUSE_INTENT_OPTIONS = [
  { value: "yes", label: "愿意" },
  { value: "unsure", label: "不确定" },
  { value: "no", label: "不愿意" },
];

const SOUND_VALUES = new Set(SOUND_COMFORT_OPTIONS.map((item) => item.value));
const MATCH_VALUES = new Set(PLAN_MATCH_OPTIONS.map((item) => item.value));
const REUSE_VALUES = new Set(REUSE_INTENT_OPTIONS.map((item) => item.value));
const SOURCE_TYPES = new Set(["plan", "preset", "custom", "none"]);

export class FeedbackError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FeedbackError";
    this.code = code;
  }
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function newFeedbackId() {
  return `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeRating(value) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new FeedbackError("INVALID_RATING", "请选择一个 1—5 分的整体体验评分。");
  }
  return rating;
}

function normalizeOptionalEnum(value, allowed) {
  if (value === undefined || value === null || value === "") return null;
  return allowed.has(value) ? value : null;
}

function normalizeSource(input) {
  const sourceType = SOURCE_TYPES.has(input.sourceType) ? input.sourceType : "custom";
  let planId = typeof input.planId === "string" && input.planId ? input.planId : null;
  let presetId = typeof input.presetId === "string" && input.presetId ? input.presetId : null;

  if (sourceType === "plan") {
    if (!planId) throw new FeedbackError("MISSING_PLAN", "请选择今晚使用的方案。");
    presetId = null;
  } else if (sourceType === "preset") {
    if (!presetId) throw new FeedbackError("MISSING_PRESET", "请选择今晚使用的预设。");
    planId = null;
  } else {
    planId = null;
    presetId = null;
  }

  const sourceName =
    typeof input.sourceName === "string" ? input.sourceName.trim().slice(0, 80) : null;

  return { sourceType, planId, presetId, sourceName };
}

export function createFeedback(input = {}) {
  const rating = normalizeRating(input.rating);
  const source = normalizeSource(input);
  const comment =
    typeof input.comment === "string"
      ? input.comment.trim().slice(0, FEEDBACK_COMMENT_MAX)
      : "";

  const now = new Date().toISOString();
  return {
    feedbackId: input.feedbackId || newFeedbackId(),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || null,
    sourceType: source.sourceType,
    planId: source.planId,
    presetId: source.presetId,
    sourceName: source.sourceName,
    rating,
    soundComfort: normalizeOptionalEnum(input.soundComfort, SOUND_VALUES),
    planMatch: normalizeOptionalEnum(input.planMatch, MATCH_VALUES),
    reuseIntent: normalizeOptionalEnum(input.reuseIntent, REUSE_VALUES),
    comment,
  };
}

function readEntries() {
  const store = storage();
  if (!store) return { ok: false, entries: [], error: "storage-unavailable" };
  try {
    const raw = store.getItem(FEEDBACK_STORAGE_KEY);
    if (!raw) return { ok: true, entries: [] };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false, entries: [], error: "corrupt" };
    const entries = parsed
      .map((entry) => {
        try {
          return createFeedback(entry);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return { ok: true, entries };
  } catch {
    return { ok: false, entries: [], error: "corrupt" };
  }
}

function writeEntries(entries) {
  const store = storage();
  if (!store) return { ok: false, error: "storage-unavailable" };
  try {
    store.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(entries.slice(0, FEEDBACK_MAX_ENTRIES)));
    return { ok: true };
  } catch {
    return { ok: false, error: "storage-failed" };
  }
}

export function saveFeedback(input) {
  const feedback = createFeedback(input);
  const current = readEntries();
  if (!current.ok && current.error === "storage-unavailable") {
    return { ok: false, error: current.error };
  }
  const entries = [feedback, ...current.entries].slice(0, FEEDBACK_MAX_ENTRIES);
  const written = writeEntries(entries);
  if (!written.ok) return written;
  return { ok: true, feedback, entries };
}

export function updateFeedback(feedbackId, patch = {}) {
  if (!feedbackId) return { ok: false, error: "missing-id" };
  const current = readEntries();
  if (!current.ok) return { ok: false, error: current.error };

  const index = current.entries.findIndex((entry) => entry.feedbackId === feedbackId);
  if (index === -1) return { ok: false, error: "not-found" };

  const existing = current.entries[index];
  let feedback;
  try {
    feedback = createFeedback({
      ...existing,
      ...patch,
      feedbackId: existing.feedbackId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return { ok: false, error: error.code || "invalid" };
  }

  const entries = [...current.entries];
  entries[index] = feedback;
  const written = writeEntries(entries);
  if (!written.ok) return written;
  return { ok: true, feedback, entries };
}

export function loadFeedback() {
  const result = readEntries();
  if (!result.ok) return { ok: false, entries: [], error: result.error };
  return { ok: true, entries: result.entries, error: null };
}

export function getFeedbackCount() {
  const result = loadFeedback();
  return result.ok ? result.entries.length : 0;
}
