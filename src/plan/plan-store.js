/**
 * Local persistence for the last generated sleep plan.
 *
 * Only structured plan data is stored (name, summary, mix, timer). The raw
 * description and selected tags are intentionally not persisted here.
 */

import { SOUND_BY_ID } from "../audio/catalog.js";

export const PLAN_STORAGE_KEY = "asc.sleepPlan.v1";

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidPlan(plan) {
  if (!plan || typeof plan !== "object") return false;
  if (typeof plan.id !== "string" || !plan.id) return false;
  if (typeof plan.title !== "string" || typeof plan.titleZh !== "string") return false;
  if (!Array.isArray(plan.sounds) || plan.sounds.length === 0) return false;
  if (!plan.sounds.every((sound) => SOUND_BY_ID.has(sound?.id))) return false;
  if (!Number.isFinite(Number(plan.durationMinutes))) return false;
  return true;
}

export function savePlan(plan) {
  const store = storage();
  if (!store) return { ok: false, error: "storage-unavailable" };
  if (!isValidPlan(plan)) return { ok: false, error: "invalid-plan" };
  try {
    store.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
    return { ok: true };
  } catch {
    return { ok: false, error: "storage-failed" };
  }
}

export function loadPlan() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(PLAN_STORAGE_KEY);
    if (!raw) return null;
    const plan = JSON.parse(raw);
    return isValidPlan(plan) ? plan : null;
  } catch {
    return null;
  }
}

export function clearPlan() {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(PLAN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
