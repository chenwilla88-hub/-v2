import { navItems, soundAssets, sessionPhases } from "./data.js";
import { audioEngine, CORE_SOUNDS, EXTRA_SOUNDS, FADE_OUT_CHOICES, getSound, resolveSoundId } from "./audio/index.js";
import { SLEEP_PRESETS, PRESET_BY_ID } from "./audio/presets.js";
import { formatDuration } from "./audio/util.js";
import {
  DURATION_OPTIONS,
  FEELING_TAGS,
  SLEEP_PLAN_DISCLAIMER,
  TAG_BY_ID,
  generateSleepPlan,
} from "./plan/sleep-plan.js";
import { loadPlan, savePlan } from "./plan/plan-store.js";
import {
  FEEDBACK_COMMENT_MAX,
  PLAN_MATCH_OPTIONS,
  REUSE_INTENT_OPTIONS,
  SOUND_COMFORT_OPTIONS,
  loadFeedback,
  saveFeedback,
  updateFeedback,
} from "./feedback/feedback-store.js";

const appState = {
  route: "home",
  selectedState: "脑子停不下来",
  journal: "",
  inputTags: [],
  inputDuration: 60,
  generating: false,
  generateError: "",
  currentPlan: null,
  planInput: null,
  planApplied: false,
  applyingPlan: false,
  regenerating: false,
  sleepMode: false,
  activePresetId: null,
  feedbackDraft: null,
  feedbackEditingId: null,
  feedbackSuccess: null,
  feedbackError: "",
  feedbackSubmitting: false,
  feedbackEntries: [],
  feedbackStorageError: false,
  feedbackLoadError: "",
};

const routes = {
  home: renderHome,
  coach: renderCoach,
  plan: renderPlan,
  analysis: renderAnalysis,
  recommendation: renderRecommendation,
  session: renderSession,
  feedback: renderFeedback,
  mixer: renderMixer,
  records: renderRecords,
  profile: renderProfile,
  settings: renderSettings,
};

const SOUND_LABEL = new Map(
  [...CORE_SOUNDS, ...EXTRA_SOUNDS].map((sound) => [sound.id, sound.label]),
);

const icons = {
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.4v13.2L19 12z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.4" height="14" rx="1.2" fill="currentColor"/><rect x="13.6" y="5" width="3.4" height="14" rx="1.2" fill="currentColor"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function stateScores() {
  const label = appState.selectedState;
  const text = appState.journal;
  const hasPressure = /压力|工作|论文|答辩|考试|焦虑|紧张/.test(`${label}${text}`);
  const hasTired = /累|疲惫|困|身体/.test(`${label}${text}`);
  const hasActiveMind = /脑子|停不下来|想|担心|明天/.test(`${label}${text}`);

  return {
    anxiety: hasPressure ? 8 : label.includes("焦虑") ? 7 : 4,
    fatigue: hasTired ? 7 : 5,
    mental: hasActiveMind ? 9 : 5,
    mood: label.includes("情绪") ? 4 : 6,
  };
}

function coachReply() {
  const scores = stateScores();
  if (scores.mental >= 8) {
    return "你的大脑今晚可能还在处理很多事情。我们先把节奏放慢，用几分钟让注意力从问题里退出来。";
  }
  if (scores.anxiety >= 7) {
    return "今晚不用急着解决所有事情。先让呼吸稳定下来，声音会帮你把注意力慢慢放回身体。";
  }
  if (scores.fatigue >= 7) {
    return "身体已经很累了，今晚适合少一点引导、多一点稳定的环境声音。";
  }
  return "今晚状态不错。我们保持简单安静，让声音轻轻陪你入睡。";
}

function recommendedTracks() {
  const scores = stateScores();
  if (scores.mental >= 8) {
    return [
      { id: "light-rain", weight: 50 },
      { id: "wind", weight: 20 },
      { id: "brown-noise", weight: 20 },
      { id: "ambient-pad", weight: 10 },
    ];
  }
  if (scores.anxiety >= 7) {
    return [
      { id: "stream", weight: 40 },
      { id: "pink-noise", weight: 25 },
      { id: "ambient-pad", weight: 25 },
      { id: "fireplace", weight: 10 },
    ];
  }
  if (scores.fatigue >= 7) {
    return [
      { id: "fan", weight: 45 },
      { id: "brown-noise", weight: 35 },
      { id: "distant-train", weight: 20 },
    ];
  }
  return [
    { id: "ocean", weight: 45 },
    { id: "forest", weight: 30 },
    { id: "ambient-pad", weight: 25 },
  ];
}

function assetById(id) {
  return soundAssets.find((asset) => asset.id === id);
}

function engineState() {
  return audioEngine.getState();
}

function activeLabels(state) {
  return state.active.map((id) => SOUND_LABEL.get(id)).filter(Boolean);
}

function timerText(state) {
  if (!state.timer) {
    if (state.pendingTimerMinutes) return `推荐 ${state.pendingTimerMinutes} 分钟`;
    return "未设定计时";
  }
  if (state.timer.fading) return "正在淡出 · 晚安";
  return `剩余 ${formatDuration(state.timer.remainingMs)}`;
}

function tagLabels(tags = []) {
  return tags.map((id) => TAG_BY_ID.get(id)?.label).filter(Boolean);
}

function feedbackSourceOptions() {
  const options = [];
  if (appState.currentPlan) {
    options.push({
      value: `plan:${appState.currentPlan.id}`,
      label: `今晚的方案 · ${appState.currentPlan.titleZh} / ${appState.currentPlan.title}`,
    });
  }
  for (const preset of SLEEP_PRESETS) {
    options.push({
      value: `preset:${preset.id}`,
      label: `预设 · ${preset.name} / ${preset.nameZh}`,
    });
  }
  options.push({ value: "custom", label: "自定义混音" });
  options.push({ value: "none", label: "没有使用声音 / 跳过方案" });

  // Keep an older saved plan selectable when editing an existing entry.
  const draftSource = appState.feedbackDraft?.source;
  if (draftSource?.startsWith("plan:") && !options.some((item) => item.value === draftSource)) {
    options.unshift({ value: draftSource, label: "已保存的方案" });
  }

  return options;
}

function defaultFeedbackSource() {
  if (appState.planApplied && appState.currentPlan) {
    return `plan:${appState.currentPlan.id}`;
  }
  if (appState.activePresetId) return `preset:${appState.activePresetId}`;
  return engineState().activeCount > 0 ? "custom" : "none";
}

function ensureFeedbackDraft(force = false) {
  if (!appState.feedbackDraft || force) {
    appState.feedbackDraft = {
      source: defaultFeedbackSource(),
      rating: 0,
      soundComfort: "",
      planMatch: "",
      reuseIntent: "",
      comment: "",
    };
  }

  const allowed = new Set(feedbackSourceOptions().map((item) => item.value));
  if (!allowed.has(appState.feedbackDraft.source)) {
    appState.feedbackDraft.source = defaultFeedbackSource();
  }
  return appState.feedbackDraft;
}

function resolveFeedbackSource(value) {
  const [type, id] = String(value || "").split(":");

  if (type === "plan" && id) {
    const plan = appState.currentPlan?.id === id ? appState.currentPlan : null;
    return {
      sourceType: "plan",
      planId: id,
      presetId: null,
      sourceName: plan ? `${plan.titleZh} / ${plan.title}` : "已保存的方案",
    };
  }

  if (type === "preset" && id) {
    const preset = PRESET_BY_ID.get(id);
    return {
      sourceType: "preset",
      planId: null,
      presetId: id,
      sourceName: preset ? `${preset.nameZh} / ${preset.name}` : "预设",
    };
  }

  if (value === "none") {
    return { sourceType: "none", planId: null, presetId: null, sourceName: "没有使用声音" };
  }

  return { sourceType: "custom", planId: null, presetId: null, sourceName: "自定义混音" };
}

function sessionTitle(state) {
  if (state.fadingOut) return "声音正在慢慢淡出。";
  return state.playing ? "声音正在陪你入睡。" : "准备开始今晚的睡眠。";
}

function sessionCopy(state) {
  if (state.fadingOut) return "计时结束，所有声音会在设定时间内平滑淡出，然后停止。";
  if (state.playing) {
    return "把屏幕放远一点。你可以随时调整音量，或者设定一个睡眠计时。";
  }
  return "点击开始后，声音会从无声慢慢淡入。所有声音都在本地生成，不会上传任何内容。";
}

function trackStatusText(sound, track) {
  if (sound.reserved) return "下一阶段";
  if (!track || !track.enabled) return "关闭";
  if (track.status === "loading") return "载入中";
  if (track.status === "error") return "不可用";
  if (track.status === "fading") return "淡出中";
  if (track.status === "playing") return track.sourceKind === "file" ? "真实音频" : "合成音色";
  return "待播放";
}

function navigate(route) {
  if (!routes[route]) return;
  appState.route = route;
  if (window.location.hash !== `#${route}`) {
    pendingHash = `#${route}`;
    window.location.hash = route;
  }
  window.scrollTo(0, 0);
  render();
}

function shell(content) {
  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <div>
            <div class="brand-title">AI Sleep Companion</div>
            <div class="brand-subtitle">今晚我已经为你准备好了</div>
          </div>
        </div>
        <nav class="nav" aria-label="Primary">
          ${navItems
            .map(
              (item) => `
                <button class="${appState.route === item.route ? "active" : ""}" data-route="${item.route}">
                  ${item.label}
                </button>
              `,
            )
            .join("")}
        </nav>
        <div class="sidebar-note">
          声音系统已接入：多轨混合、淡入淡出、睡眠计时。AI 语音通道已预留，下一步接入状态分析。
        </div>
      </aside>
      <main class="main">
        ${content}
      </main>
      <nav class="mobile-nav" aria-label="Mobile primary">
        ${navItems
          .slice(0, 6)
          .map(
            (item) => `
              <button class="${appState.route === item.route ? "active" : ""}" data-route="${item.route}">
                ${item.shortLabel}
              </button>
            `,
          )
          .join("")}
      </nav>
    </div>
  `;
}

function renderHome() {
  const state = engineState();
  const labels = activeLabels(state);
  return shell(`
    <section class="view home-grid">
      <div>
        <div class="kicker">AI 睡眠陪伴</div>
        <h1>今晚感觉怎么样？</h1>
        <p class="lead">告诉我一点点现在的状态，我会为今晚生成一段更适合你的睡眠声音流程。你也可以直接打开声音，先让房间安静下来。</p>
        <div class="home-actions">
          <button class="button" data-route="coach">开始今晚的睡眠</button>
          <button class="button secondary" data-route="session">直接听声音</button>
          ${appState.currentPlan ? `<button class="button ghost" data-route="plan">查看今晚方案</button>` : ""}
          <button class="button ghost" data-route="records">查看睡眠记录</button>
        </div>
      </div>
      <aside class="tonight-panel">
        <div>
          <div class="small-label">Tonight</div>
          <h3>${state.playing ? "声音已开启" : "安静模式"}</h3>
          <div class="moon-meter" aria-hidden="true"></div>
        </div>
        <div class="quiet-list">
          <div class="quiet-row"><span>当前声音</span><span>${labels.length ? labels.slice(0, 2).join(" + ") : "尚未开始"}</span></div>
          <div class="quiet-row"><span>声音层数</span><span>${state.activeCount} 层已选择</span></div>
          <div class="quiet-row"><span>睡眠计时</span><span>${state.timer || state.pendingTimerMinutes ? timerText(state) : "30 / 60 / 90"}</span></div>
        </div>
      </aside>
    </section>
  `);
}

function renderCoach() {
  const selected = new Set(appState.inputTags);
  return shell(`
    <section class="view feel-view">
      <div class="page-head">
        <div>
          <div class="kicker">AI Sleep Coach</div>
          <h2 class="feel-title">How are you feeling tonight?</h2>
          <p class="feel-sub">Tell us about your day. Let's prepare a sleep session for you.</p>
        </div>
      </div>
      <div class="coach-layout feel-layout">
        <form class="panel feel-form" data-feel-form ${appState.generating ? 'aria-busy="true"' : ""}>
          <label class="small-label" for="feelText">今晚的状态</label>
          <textarea class="journal" id="feelText" data-journal maxlength="500" placeholder="例如：今天工作压力很大，脑子停不下来。">${escapeHtml(appState.journal)}</textarea>

          <div class="feel-tags" role="group" aria-label="可选状态标签">
            ${FEELING_TAGS.map(
              (tag) => `
                <button type="button" class="feel-tag ${selected.has(tag.id) ? "selected" : ""}" data-feel-tag="${tag.id}" aria-pressed="${selected.has(tag.id)}">
                  <span>${tag.label}</span>
                  <em>${tag.labelZh}</em>
                </button>
              `,
            ).join("")}
          </div>

          <div class="feel-duration">
            <span class="small-label">希望多久？</span>
            <div class="chips">
              ${DURATION_OPTIONS.map(
                (minutes) => `
                  <button type="button" class="chip ${appState.inputDuration === minutes ? "selected" : ""}" data-feel-duration="${minutes}">
                    ${minutes} 分钟
                  </button>
                `,
              ).join("")}
            </div>
          </div>

          ${appState.generateError ? `<p class="form-error" role="alert">${appState.generateError}</p>` : ""}

          <div class="home-actions">
            <button class="button" type="submit" data-generate-plan ${appState.generating ? "disabled" : ""}>
              ${appState.generating ? "正在生成方案…" : "生成我的助眠方案"}
            </button>
            <button class="button ghost" type="button" data-route="mixer">直接使用预设</button>
          </div>
          <p class="privacy-note">这些内容只用于生成本次方案，不会写入反馈记录；不需要填写完整。</p>
        </form>

        <aside class="panel feel-aside">
          <div class="small-label">What you'll get</div>
          <ul class="feel-steps">
            <li>根据今晚状态生成一段声音组合</li>
            <li>每种声音的初始音量和推荐时长</li>
            <li>一句放松提示，应用后仍可自由调整</li>
          </ul>
          <p class="hint">不选标签也可以，写一句就够了。方案只是产品原型里的规则推荐，不是医疗建议。</p>
          ${appState.currentPlan ? `<button class="button ghost small" type="button" data-route="plan">查看上次生成的方案</button>` : ""}
        </aside>
      </div>
    </section>
  `);
}

function renderPlan() {
  const plan = appState.currentPlan;
  if (!plan) {
    return shell(`
      <section class="view">
        <div class="page-head">
          <div>
            <div class="kicker">Your Sleep Plan</div>
            <h2>还没有今晚的方案。</h2>
            <p>先简单描述今晚的状态，我们会生成一段适合你的声音组合。</p>
          </div>
        </div>
        <div class="panel empty-panel">
          <button class="button" data-route="coach">描述今晚的状态</button>
        </div>
      </section>
    `);
  }

  const state = engineState();
  const applied = appState.planApplied;
  const labels = tagLabels(plan.basedOn);

  return shell(`
    <section class="view plan-view">
      <div class="page-head plan-head">
        <div>
          <div class="kicker">Your Sleep Plan</div>
          <h2>${plan.titleZh}<span class="plan-en">${plan.title}</span></h2>
          <p>${plan.summary}</p>
        </div>
        <div class="plan-head-actions">
          <span class="pill ${applied ? "" : "ghost"}">${applied ? "已应用" : "未应用"}</span>
          <button class="button ghost small" type="button" data-route="coach">修改状态</button>
        </div>
      </div>

      <div class="plan-toolbar">
        ${
          applied
            ? `<button class="button" type="button" data-start-plan>开始播放</button>`
            : `<button class="button" type="button" data-apply-plan ${appState.applyingPlan ? "disabled" : ""}>${appState.applyingPlan ? "正在应用…" : "Apply Plan"}</button>`
        }
        <button class="button secondary" type="button" data-edit-plan>Edit Mix</button>
        <button class="button ghost" type="button" data-regenerate-plan ${appState.regenerating ? "disabled" : ""}>
          ${appState.regenerating ? "正在重新生成…" : "Regenerate"}
        </button>
        <p class="hint">应用方案不会自动播放；应用后仍可自由调整音量、开关和定时器。</p>
      </div>

      <div class="plan-layout">
        <div class="panel plan-main">
          <div class="small-label">Tonight's mix</div>
          <div class="track-list plan-track-list">
            ${plan.sounds
              .map((item) => {
                const sound = getSound(item.id);
                return `
                  <div class="track-row plan-track-row">
                    <div>
                      <div class="track-name">${sound?.label ?? item.id}<span class="sound-en">${sound?.name ?? ""}</span></div>
                      <div class="track-meta">${sound?.category ?? "声音"} · ${sound?.role ?? ""}</div>
                      <div class="bar" style="margin-top: 10px;"><span style="--value: ${Math.round(item.volume * 100)}%"></span></div>
                    </div>
                    <div class="track-weight">${Math.round(item.volume * 100)}%</div>
                  </div>
                `;
              })
              .join("")}
          </div>

          <div class="plan-reason">
            <div class="small-label">Why this plan</div>
            <p>${plan.reason}</p>
          </div>

          ${
            labels.length
              ? `<div class="plan-tags">${labels.map((label) => `<span class="preset-sound">${label}</span>`).join("")}</div>`
              : ""
          }

          <p class="plan-disclaimer">${plan.disclaimer || SLEEP_PLAN_DISCLAIMER}</p>
        </div>

        <aside class="plan-aside">
          <div class="panel">
            <div class="small-label">Recommended</div>
            <div class="plan-meta-row"><span>时长</span><strong>${plan.durationMinutes} 分钟</strong></div>
            <div class="plan-meta-row"><span>声音层数</span><strong>${plan.sounds.length}</strong></div>
            <div class="plan-meta-row"><span>定时器</span><strong data-plan-timer>${timerText(state)}</strong></div>
            <p class="hint">${
              applied
                ? state.timer
                  ? "正在计时。"
                  : "开始播放后自动开始计时。"
                : "应用方案不会自动播放声音。"
            }</p>
          </div>

          <div class="panel">
            <div class="small-label">Relax tip</div>
            <p class="plan-tip">${plan.tip}</p>
          </div>

          <div class="panel">
            <div class="small-label">Adjustable</div>
            <ul class="plan-adjust">
              ${(plan.adjustable || [])
                .map((item) => `<li>${item}</li>`)
                .join("")}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  `);
}

function renderAnalysis() {
  const scores = stateScores();
  return shell(`
    <section class="view">
      <div class="page-head">
        <div>
          <div class="kicker">睡眠状态分析</div>
          <h2>今晚先把大脑慢下来。</h2>
          <p>${coachReply()}</p>
        </div>
      </div>
      <div class="two-col">
        <div class="panel">
          <h3>状态模型</h3>
          <div class="metrics" style="margin-top: 22px;">
            ${metric("焦虑程度", scores.anxiety)}
            ${metric("疲劳程度", scores.fatigue)}
            ${metric("思维活跃度", scores.mental)}
            ${metric("情绪稳定度", scores.mood)}
          </div>
        </div>
        <div class="panel">
          <h3>今晚策略</h3>
          <div class="timeline">
            <div class="phase">
              <div class="phase-time">前 5 分钟</div>
              <div>
                <div class="phase-title">少量 AI 引导</div>
                <div class="phase-copy">帮助注意力从工作、学习或担心中退出。</div>
              </div>
            </div>
            <div class="phase">
              <div class="phase-time">之后</div>
              <div>
                <div class="phase-title">稳定环境声音</div>
                <div class="phase-copy">减少变化，保留低亮度、低刺激的声音层。</div>
              </div>
            </div>
          </div>
          <div class="home-actions">
            <button class="button" data-route="recommendation">查看声音推荐</button>
          </div>
        </div>
      </div>
    </section>
  `);
}

function renderRecommendation() {
  const tracks = recommendedTracks();
  return shell(`
    <section class="view">
      <div class="page-head">
        <div>
          <div class="kicker">AI 声音推荐</div>
          <h2>今晚的声音组合已经准备好。</h2>
          <p>第一版使用规则推荐和偏好权重。开始后会直接淡入播放，并同步到声音混音器。</p>
        </div>
        <button class="button" data-apply-recommendation>用这个组合开始</button>
      </div>
      <div class="recommendation-grid">
        <div class="panel">
          <h3>Sound Profile</h3>
          <div class="track-list" style="margin-top: 18px;">
            ${tracks
              .map((track) => {
                const asset = assetById(track.id);
                return `
                  <div class="track-row">
                    <div>
                      <div class="track-name">${asset.name}</div>
                      <div class="track-meta">${asset.category} · ${asset.role}</div>
                      <div class="bar" style="margin-top: 10px;"><span style="--value: ${track.weight}%"></span></div>
                    </div>
                    <div class="track-weight">${track.weight}%</div>
                  </div>
                `;
              })
              .join("")}
          </div>
          <p class="hint">这些权重会直接映射为每层声音的初始音量，你仍然可以在混音器里单独调整。</p>
        </div>
        <aside class="panel">
          <h3>Session Timeline</h3>
          <div class="timeline">
            ${sessionPhases
              .map(
                (phase) => `
                  <div class="phase">
                    <div class="phase-time">${phase.time}</div>
                    <div>
                      <div class="phase-title">${phase.title}</div>
                      <div class="phase-copy">${phase.copy}</div>
                    </div>
                  </div>
                `,
              )
              .join("")}
          </div>
        </aside>
      </div>
    </section>
  `);
}

function renderSession() {
  const state = engineState();
  const labels = activeLabels(state);
  return shell(`
    <section class="view session-view">
      <div class="session-panel">
        <div class="kicker">Sleep Session</div>
        <h2 data-session-title>${sessionTitle(state)}</h2>
        <div class="breath-circle ${state.playing ? "is-live" : ""}" aria-hidden="true"></div>
        <p class="session-copy" data-session-copy>${sessionCopy(state)}</p>
        <div class="session-pills">
          <span class="pill" data-session-state>${state.fadingOut ? "正在淡出" : state.playing ? "正在播放" : "已暂停"}</span>
          <span class="pill ghost" data-session-layers>${labels.length ? labels.join(" · ") : "尚无声音"}</span>
          <span class="pill ghost" data-session-timer>${timerText(state)}</span>
        </div>
        <div class="player-controls">
          <button class="button" data-audio-toggle data-session-play>${state.playing ? "暂停" : "开始播放"}</button>
          <button class="button secondary" data-sleep-toggle>睡眠模式</button>
          <button class="button ghost" data-route="mixer">调整混音</button>
          <button class="button ghost" data-route="feedback">使用反馈</button>
        </div>
        <div class="session-controls">
          ${masterControl(state)}
          ${timerControl(state)}
        </div>
      </div>
    </section>
  `);
}

function feedbackChoiceGroup(field, label, options, current) {
  return `
    <div class="feedback-group">
      <div class="small-label">${label} <span class="feedback-optional">可选</span></div>
      <div class="feedback-choices">
        ${options
          .map(
            (option) => `
              <button type="button" class="feedback-choice ${current === option.value ? "selected" : ""}" data-feedback-field="${field}" data-feedback-value="${option.value}" aria-pressed="${current === option.value}">
                ${option.label}
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function feedbackEntrySource(entry) {
  if (entry.sourceName) return entry.sourceName;
  if (entry.planId) return "已保存的方案";
  if (entry.presetId) return "预设";
  return "自定义混音";
}

function renderFeedbackSuccess(entry) {
  return `
    <div class="panel feedback-success">
      <div class="feedback-success-mark" aria-hidden="true">✓</div>
      <h3>反馈已保存在当前浏览器。</h3>
      <p class="feedback-success-meta">${escapeHtml(feedbackEntrySource(entry))} · ${entry.rating}/5${entry.updatedAt ? " · 已更新" : ""}</p>
      ${entry.comment ? `<p class="feedback-success-comment">${escapeHtml(entry.comment)}</p>` : ""}
      <div class="home-actions">
        <button class="button" type="button" data-edit-feedback="${entry.feedbackId}">修改这条反馈</button>
        <button class="button secondary" type="button" data-new-feedback>再提交一条</button>
        <button class="button ghost" type="button" data-route="session">返回播放</button>
      </div>
      <p class="privacy-note">反馈只保存在当前浏览器；不会被产品运营者自动收集，也不能跨设备查看。</p>
    </div>
  `;
}

function renderSavedFeedback() {
  if (!appState.feedbackEntries.length) return "";
  return `
    <div class="panel feedback-history">
      <div class="feedback-history-head">
        <h3>本机保存的反馈</h3>
        <span>${appState.feedbackEntries.length} 条</span>
      </div>
      <div class="feedback-list">
        ${appState.feedbackEntries
          .slice(0, 3)
          .map((entry) => {
            const date = new Date(entry.createdAt);
            const dateLabel = Number.isNaN(date.getTime())
              ? ""
              : date.toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });
            return `
              <div class="feedback-entry">
                <div class="feedback-entry-head">
                  <div>
                    <strong>${escapeHtml(feedbackEntrySource(entry))}</strong>
                    <span class="feedback-entry-date">${dateLabel}</span>
                  </div>
                  <div class="feedback-entry-side">
                    <span>${entry.rating}/5</span>
                    <button type="button" class="feedback-edit-link" data-edit-feedback="${entry.feedbackId}">修改</button>
                  </div>
                </div>
                ${entry.comment ? `<p>${escapeHtml(entry.comment)}</p>` : ""}
              </div>
            `;
          })
          .join("")}
      </div>
      <p class="privacy-note">只保存在本浏览器；原始状态描述不会写入反馈记录。</p>
    </div>
  `;
}

function renderFeedback() {
  ensureFeedbackDraft();
  const draft = appState.feedbackDraft;
  const sourceOptions = feedbackSourceOptions();
  const storageBlocked = appState.feedbackStorageError;

  const form = `
    <form class="panel feedback-form" data-feedback-form>
      <label class="feedback-field">
        <span class="small-label">今晚使用的方案</span>
        <select class="feedback-select" data-feedback-source>
          ${sourceOptions
            .map(
              (option) =>
                `<option value="${option.value}" ${draft.source === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
            )
            .join("")}
        </select>
      </label>

      <div class="feedback-group">
        <div class="small-label">整体体验评分 <span class="feedback-optional">必选</span></div>
        <div class="feedback-rating" role="group" aria-label="整体体验评分">
          ${[1, 2, 3, 4, 5]
            .map(
              (rating) => `
                <button type="button" class="feedback-rating-button ${draft.rating === rating ? "selected" : ""}" data-feedback-rating="${rating}" aria-pressed="${draft.rating === rating}">
                  ${rating}
                </button>
              `,
            )
            .join("")}
        </div>
        <p class="feedback-scale-hint">1 = 很差 · 5 = 很好</p>
      </div>

      ${feedbackChoiceGroup("soundComfort", "声音是否舒适", SOUND_COMFORT_OPTIONS, draft.soundComfort)}
      ${feedbackChoiceGroup("planMatch", "方案是否符合今晚需求", PLAN_MATCH_OPTIONS, draft.planMatch)}
      ${feedbackChoiceGroup("reuseIntent", "是否愿意再次使用", REUSE_INTENT_OPTIONS, draft.reuseIntent)}

      <label class="feedback-field">
        <span class="small-label">想补充什么？ <span class="feedback-optional">可选</span></span>
        <textarea class="journal feedback-comment" data-feedback-comment maxlength="${FEEDBACK_COMMENT_MAX}" placeholder="例如：雨声很舒服，但音乐可以再轻一点。">${escapeHtml(draft.comment)}</textarea>
      </label>

      ${appState.feedbackError ? `<p class="form-error" role="alert">${escapeHtml(appState.feedbackError)}</p>` : ""}
      ${storageBlocked ? `<p class="storage-warning" role="alert">浏览器本地存储不可用，本次反馈无法保存。你仍然可以跳过。</p>` : ""}

      <div class="home-actions">
        <button class="button" type="submit" data-feedback-submit ${appState.feedbackSubmitting || storageBlocked ? "disabled" : ""}>
          ${appState.feedbackSubmitting ? "正在保存…" : "提交反馈"}
        </button>
        <button class="button ghost" type="button" data-feedback-skip>跳过反馈</button>
      </div>
      <p class="privacy-note">反馈只保存在当前浏览器，不会自动上传，也不能跨设备查看。请不要填写敏感信息；原始状态描述不会被保存。</p>
    </form>
  `;

  return shell(`
    <section class="view feedback-view">
      <div class="page-head">
        <div>
          <div class="kicker">Sleep Experience</div>
          <h2>今晚的体验，怎么样？</h2>
          <p>两分钟就好。反馈只保存在当前浏览器，不会自动上传。</p>
        </div>
        ${appState.feedbackSuccess ? "" : `<button class="button ghost small" type="button" data-feedback-skip>跳过</button>`}
      </div>

      ${appState.feedbackLoadError ? `<p class="storage-warning" role="alert">${escapeHtml(appState.feedbackLoadError)}</p>` : ""}
      ${appState.feedbackSuccess ? renderFeedbackSuccess(appState.feedbackSuccess) : form}
      ${renderSavedFeedback()}
    </section>
  `);
}

function soundRow(sound, state) {
  const track = state.tracks[sound.id] ?? { enabled: false, volume: sound.defaultVolume, status: "idle" };
  const pct = Math.round(track.volume * 100);
  const reserved = Boolean(sound.reserved);
  return `
    <div class="sound-row ${track.enabled ? "is-on" : ""} ${reserved ? "is-reserved" : ""}" data-sound-row="${sound.id}">
      <div class="sound-main">
        <button class="switch ${track.enabled ? "on" : ""}" type="button" role="switch" aria-checked="${track.enabled}" ${reserved ? 'aria-disabled="true"' : ""} data-track-toggle="${sound.id}" aria-label="${sound.label}开关">
          <span aria-hidden="true"></span>
        </button>
        <div class="sound-copy">
          <div class="sound-title">${sound.label}<span class="sound-en">${sound.name}</span></div>
          <div class="sound-meta">${sound.category} · ${sound.role}${reserved ? " · 通道已预留" : ""}</div>
        </div>
        <div class="sound-value" data-track-value="${sound.id}">${pct}%</div>
      </div>
      <div class="sound-slider">
        <input class="range" type="range" min="0" max="100" step="1" value="${pct}" style="--value: ${pct}%" data-track-volume="${sound.id}" aria-label="${sound.label}音量" ${reserved ? "disabled" : ""} />
        <span class="sound-status" data-track-status="${sound.id}">${trackStatusText(sound, track)}</span>
      </div>
      ${reserved ? `<p class="sound-hint">${sound.hint}</p>` : ""}
    </div>
  `;
}

function masterControl(state) {
  const pct = Math.round(state.masterVolume * 100);
  return `
    <div class="volume-block">
      <div class="volume-head">
        <span class="small-label">Master Volume</span>
        <span class="volume-value" data-master-value>${pct}%</span>
      </div>
      <input class="range" type="range" min="0" max="100" step="1" value="${pct}" style="--value: ${pct}%" data-master-volume aria-label="主音量" />
    </div>
  `;
}

function timerControl(state) {
  const currentMinutes = state.timer?.minutes ?? state.pendingTimerMinutes ?? null;
  const preset = currentMinutes !== null && [30, 60, 90].includes(currentMinutes);
  const custom = currentMinutes !== null && !preset;
  const pending = Boolean(state.pendingTimerMinutes && !state.timer);
  const showClear = Boolean(state.timer || state.pendingTimerMinutes);
  return `
    <div class="timer-block">
      <div class="volume-head">
        <span class="small-label">Sleep Timer</span>
        <span class="timer-readout" data-timer-display>${timerText(state)}</span>
      </div>
      <div class="timer-chips">
        ${[30, 60, 90]
          .map(
            (minutes) => `
              <button type="button" class="chip ${preset && currentMinutes === minutes && !state.timer?.fading ? "selected" : ""}" data-timer="${minutes}">
                ${minutes} min
              </button>
            `,
          )
          .join("")}
        <button type="button" class="chip ${custom && !state.timer?.fading ? "selected" : ""}" data-timer-custom>Custom</button>
      </div>
      <p class="timer-note" data-timer-note ${pending ? "" : "hidden"}>开始播放后自动开始计时</p>
      <form class="timer-custom" data-timer-form hidden>
        <input type="number" min="1" max="720" step="1" value="45" data-timer-input aria-label="自定义计时分钟数" />
        <button class="button small" type="submit">开始计时</button>
      </form>
      <button type="button" class="timer-clear" data-timer-clear ${showClear ? "" : "hidden"}>取消计时</button>
    </div>
  `;
}

function presetMixLabel(id, volume) {
  const sound = getSound(id);
  return `${sound?.label ?? id} ${Math.round(volume * 100)}%`;
}

function presetCard(preset, active) {
  const chips = preset.sounds.map(
    (item) => `<span class="preset-sound">${presetMixLabel(item.id, item.volume)}</span>`,
  );
  for (const id of preset.off ?? []) {
    const sound = getSound(id);
    chips.push(`<span class="preset-sound is-off">${sound?.label ?? id} 关闭</span>`);
  }

  return `
    <article class="preset-card ${active ? "is-active" : ""}" data-preset-card="${preset.id}">
      <div class="preset-head">
        <div>
          <div class="preset-en">${preset.name}</div>
          <h3 class="preset-zh">${preset.nameZh}</h3>
        </div>
        ${active ? `<span class="preset-badge">使用中</span>` : ""}
      </div>
      <p class="preset-desc">${preset.description}</p>
      <div class="preset-mix">${chips.join("")}</div>
      <div class="preset-foot">
        <span class="preset-duration">${preset.timerMinutes} min</span>
        <button class="preset-apply" type="button" data-apply-preset="${preset.id}">${active ? "重新应用" : "应用"}</button>
      </div>
    </article>
  `;
}

function renderPresets() {
  const active = appState.activePresetId;
  const current = active ? PRESET_BY_ID.get(active) : null;
  return `
    <section class="presets" aria-labelledby="presetsTitle">
      <div class="presets-head">
        <div>
          <div class="small-label">Sleep Presets</div>
          <h3 id="presetsTitle">一键助眠方案</h3>
          <p class="presets-sub">先应用一套混音，再开始播放。应用后仍可继续调整每一种声音。</p>
        </div>
        <span class="preset-current" data-preset-current>${current ? `当前：${current.name}` : "当前：自定义混音"}</span>
      </div>
      <div class="preset-grid">
        ${SLEEP_PRESETS.map((preset) => presetCard(preset, preset.id === active)).join("")}
      </div>
      <p class="presets-note">百分比是初始混音比例，不代表声压或临床建议；时长只是推荐值。</p>
    </section>
  `;
}

function renderMixer() {
  const state = engineState();
  const extraOpen = EXTRA_SOUNDS.some((sound) => state.tracks[sound.id]?.enabled);
  return shell(`
    <section class="view">
      <div class="page-head">
        <div>
          <div class="kicker">声音混音器</div>
          <h2>今晚的声音，由你决定。</h2>
          <p>每个声音都有独立音量，可以叠加播放。主音量统一控制所有声音，淡入淡出会避免声音突然出现或突然停止。</p>
        </div>
        <button class="button" data-audio-toggle data-play-label>${state.playing ? "暂停" : "开始播放"}</button>
      </div>
      ${renderPresets()}
      <div class="mixer-layout">
        <div class="panel">
          <div class="mixer-head">
            <h3>核心声音</h3>
            <span class="mixer-hint" data-manifest-note>${state.manifestStatus === "loaded" ? "真实音频已接入" : "内置合成音色"}</span>
          </div>
          <div class="sound-list">
            ${CORE_SOUNDS.map((sound) => soundRow(sound, state)).join("")}
          </div>
          <details class="more-sounds" ${extraOpen ? "open" : ""}>
            <summary>更多环境声（${EXTRA_SOUNDS.length}）</summary>
            <div class="sound-list">
              ${EXTRA_SOUNDS.map((sound) => soundRow(sound, state)).join("")}
            </div>
          </details>
        </div>
        <aside class="mixer-aside">
          <div class="panel">
            ${masterControl(state)}
            ${timerControl(state)}
          </div>
          <div class="panel">
            <div class="small-label">Fade Out</div>
            <label class="field">
              <span>计时结束后的淡出时长</span>
              <select data-fade-out aria-label="淡出时长">
                ${FADE_OUT_CHOICES.map(
                  (seconds) =>
                    `<option value="${seconds}" ${state.fadeOutSeconds === seconds ? "selected" : ""}>${seconds} 秒</option>`,
                ).join("")}
              </select>
            </label>
            <p class="hint">计时结束时，所有声音会在设定时间内平滑淡出，然后自动停止，不会突然静音。</p>
          </div>
          <div class="panel">
            <div class="small-label">AI Voice</div>
            <p class="hint">AI 睡眠引导通道已预留。接入 AI 后，生成的语音会进入独立声道，播放时自动压低环境声音，结束后再慢慢恢复。</p>
            <button class="button ghost small" type="button" disabled>AI 语音 · 即将接入</button>
          </div>
        </aside>
      </div>
    </section>
  `);
}

function renderRecords() {
  return shell(`
    <section class="view">
      <div class="page-head">
        <div>
          <div class="kicker">睡眠记录</div>
          <h2>记录会让推荐越来越像你。</h2>
          <p>第一版只使用用户主动输入和 App 内行为，不伪装成医疗级睡眠监测。</p>
        </div>
      </div>
      <div class="panel">
        <h3>最近记录</h3>
        <div class="stat-grid">
          <div class="stat"><strong>8.3</strong><span>平均反馈评分</span></div>
          <div class="stat"><strong>26m</strong><span>平均睡前使用</span></div>
          <div class="stat"><strong>雨声</strong><span>常用声音</span></div>
        </div>
      </div>
    </section>
  `);
}

function renderProfile() {
  return shell(`
    <section class="view">
      <div class="page-head">
        <div>
          <div class="kicker">Sleep Profile</div>
          <h2>个人睡眠画像正在形成。</h2>
          <p>偏好权重会根据反馈逐渐调整，未来可替换为推荐模型。</p>
        </div>
      </div>
      <div class="two-col">
        <div class="panel">
          <h3>声音偏好</h3>
          <div class="metrics" style="margin-top: 22px;">
            ${metric("雨声", 9)}
            ${metric("棕噪声", 7)}
            ${metric("海浪", 6)}
            ${metric("钢琴", 2)}
          </div>
        </div>
        <div class="panel">
          <h3>睡前状态</h3>
          <div class="timeline">
            <div class="phase"><div class="phase-time">敏感</div><div><div class="phase-title">工作压力</div><div class="phase-copy">压力相关输入会触发更短的引导和更稳定的底噪。</div></div></div>
            <div class="phase"><div class="phase-time">常见</div><div><div class="phase-title">思维活跃</div><div class="phase-copy">更适合雨声、风声、棕噪声的低变化组合。</div></div></div>
          </div>
        </div>
      </div>
    </section>
  `);
}

function renderSettings() {
  return shell(`
    <section class="view">
      <div class="page-head">
        <div>
          <div class="kicker">设置</div>
          <h2>保持简单。</h2>
          <p>只保留 MVP 必要设置，复杂会员、社交和医疗数据不进入第一版。</p>
        </div>
      </div>
      <div class="panel">
        <div class="settings-list">
          <div class="setting-row"><span>默认 30 分钟后降低音量</span><span class="toggle" aria-hidden="true"></span></div>
          <div class="setting-row"><span>明早反馈提醒</span><span class="toggle" aria-hidden="true"></span></div>
          <div class="setting-row"><span>低亮度播放页</span><span class="toggle" aria-hidden="true"></span></div>
        </div>
      </div>
    </section>
  `);
}

function metric(label, value) {
  return `
    <div class="metric">
      <div class="metric-top"><span>${label}</span><span>${value}/10</span></div>
      <div class="bar"><span style="--value: ${value * 10}%"></span></div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Player dock                                                         */
/* ------------------------------------------------------------------ */

function buildDock() {
  const existing = document.getElementById("playerDock");
  if (existing) return existing;

  const dock = document.createElement("section");
  dock.id = "playerDock";
  dock.className = "player-dock";
  dock.setAttribute("aria-label", "睡眠声音播放器");
  dock.innerHTML = `
    <button class="dock-play" type="button" data-audio-toggle aria-label="播放">
      <span class="dock-icon" data-dock-icon>${icons.play}</span>
    </button>
    <div class="dock-info">
      <div class="dock-title">今晚的声音</div>
      <div class="dock-meta" data-dock-meta>已暂停</div>
    </div>
    <div class="dock-volume">
      <span class="dock-label">Master</span>
      <input class="range" type="range" min="0" max="100" step="1" data-master-volume aria-label="主音量" />
      <span class="dock-value" data-master-value>70%</span>
    </div>
    <div class="dock-timer" data-dock-timer>未设定计时</div>
    <button class="dock-action" type="button" data-sleep-toggle aria-label="进入睡眠模式">
      ${icons.moon}<span class="dock-action-label">睡眠模式</span>
    </button>
    <button class="dock-action" type="button" data-route="mixer" aria-label="打开混音器">
      ${icons.sliders}<span class="dock-action-label">混音</span>
    </button>
  `;
  document.body.appendChild(dock);
  return dock;
}

function syncDock(state) {
  const dock = document.getElementById("playerDock");
  if (!dock) return;

  dock.dataset.playing = String(state.playing);
  const icon = dock.querySelector("[data-dock-icon]");
  if (icon) icon.innerHTML = state.playing ? icons.pause : icons.play;

  const playButton = dock.querySelector("[data-audio-toggle]");
  playButton?.setAttribute("aria-label", state.playing ? "暂停声音" : "播放声音");

  const labels = activeLabels(state);
  const meta = dock.querySelector("[data-dock-meta]");
  if (meta) {
    if (state.fadingOut) meta.textContent = "正在淡出…";
    else if (state.playing) {
      meta.textContent = labels.length ? `正在播放 · ${labels.slice(0, 3).join(" + ")}` : "正在播放";
    } else {
      meta.textContent = labels.length ? `已暂停 · ${labels.slice(0, 3).join(" + ")}` : "已暂停";
    }
  }

  const timer = dock.querySelector("[data-dock-timer]");
  if (timer) timer.textContent = timerText(state);
}

/* ------------------------------------------------------------------ */
/* Sleep mode                                                          */
/* ------------------------------------------------------------------ */

function buildSleepLayer() {
  const existing = document.getElementById("sleepLayer");
  if (existing) return existing;

  const layer = document.createElement("div");
  layer.id = "sleepLayer";
  layer.className = "sleep-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = `
    <div class="sleep-orb" aria-hidden="true"></div>
    <div class="sleep-content">
      <div class="sleep-kicker">Sleep Mode</div>
      <h2 class="sleep-title">晚安。</h2>
      <p class="sleep-copy" data-sleep-copy>声音会继续播放，屏幕已经安静下来。</p>
      <div class="sleep-timer" data-sleep-timer>未设定计时</div>
      <div class="sleep-controls">
        <button class="sleep-play" type="button" data-audio-toggle aria-label="播放或暂停">
          <span data-sleep-icon>${icons.pause}</span>
        </button>
        <button class="sleep-exit" type="button" data-sleep-exit>退出睡眠模式</button>
      </div>
      <p class="sleep-hint">点击暂停键可以停止声音 · 按 Esc 退出</p>
    </div>
  `;
  document.body.appendChild(layer);
  return layer;
}

function syncSleepLayer(state) {
  const layer = document.getElementById("sleepLayer");
  if (!layer) return;

  const icon = layer.querySelector("[data-sleep-icon]");
  if (icon) icon.innerHTML = state.playing ? icons.pause : icons.play;

  const labels = activeLabels(state);
  const copy = layer.querySelector("[data-sleep-copy]");
  if (copy) {
    copy.textContent = state.playing
      ? `正在播放 ${labels.slice(0, 2).join(" + ") || "安静的声音"}。把屏幕放远一点。`
      : "声音已暂停。点击播放继续。";
  }

  const timer = layer.querySelector("[data-sleep-timer]");
  if (timer) {
    timer.textContent =
      state.timer || state.pendingTimerMinutes ? timerText(state) : "未设定睡眠计时";
  }
}

function setSleepMode(enabled) {
  const next = Boolean(enabled);
  appState.sleepMode = next;
  document.documentElement.dataset.sleepMode = next ? "on" : "off";

  const layer = buildSleepLayer();
  layer.classList.toggle("is-on", next);
  layer.setAttribute("aria-hidden", String(!next));

  if (next) syncSleepLayer(engineState());
}

/* ------------------------------------------------------------------ */
/* State -> DOM                                                        */
/* ------------------------------------------------------------------ */

function syncAudioUi(state) {
  const masterPct = Math.round(state.masterVolume * 100);

  document.querySelectorAll("[data-master-value]").forEach((el) => {
    el.textContent = `${masterPct}%`;
  });
  document.querySelectorAll("[data-master-volume]").forEach((el) => {
    if (document.activeElement !== el) el.value = String(masterPct);
    el.style.setProperty("--value", `${masterPct}%`);
  });

  document.querySelectorAll("[data-track-toggle]").forEach((el) => {
    const track = state.tracks[el.dataset.trackToggle];
    if (!track) return;
    el.classList.toggle("on", track.enabled);
    el.setAttribute("aria-checked", String(track.enabled));
    el.closest("[data-sound-row]")?.classList.toggle("is-on", track.enabled);
  });

  document.querySelectorAll("[data-track-volume]").forEach((el) => {
    const track = state.tracks[el.dataset.trackVolume];
    if (!track) return;
    const pct = Math.round(track.volume * 100);
    if (document.activeElement !== el) el.value = String(pct);
    el.style.setProperty("--value", `${pct}%`);
  });

  document.querySelectorAll("[data-track-value]").forEach((el) => {
    const track = state.tracks[el.dataset.trackValue];
    if (track) el.textContent = `${Math.round(track.volume * 100)}%`;
  });

  document.querySelectorAll("[data-track-status]").forEach((el) => {
    const id = el.dataset.trackStatus;
    const track = state.tracks[id];
    const sound = getSound(id);
    if (track && sound) el.textContent = trackStatusText(sound, track);
  });

  document.querySelectorAll("[data-session-title]").forEach((el) => {
    el.textContent = sessionTitle(state);
  });
  document.querySelectorAll("[data-session-copy]").forEach((el) => {
    el.textContent = sessionCopy(state);
  });
  document.querySelectorAll("[data-session-state]").forEach((el) => {
    el.textContent = state.fadingOut ? "正在淡出" : state.playing ? "正在播放" : "已暂停";
  });
  document.querySelectorAll("[data-session-layers]").forEach((el) => {
    const labels = activeLabels(state);
    el.textContent = labels.length ? labels.join(" · ") : "尚无声音";
  });
  document.querySelectorAll("[data-session-timer]").forEach((el) => {
    el.textContent = timerText(state);
  });
  document.querySelectorAll("[data-plan-timer]").forEach((el) => {
    el.textContent = timerText(state);
  });
  document.querySelectorAll("[data-session-play]").forEach((el) => {
    el.textContent = state.playing ? "暂停" : "开始播放";
  });
  document.querySelectorAll("[data-play-label]").forEach((el) => {
    el.textContent = state.playing ? "暂停" : "开始播放";
  });
  document.querySelectorAll("[data-timer-display]").forEach((el) => {
    el.textContent = timerText(state);
  });
  document.querySelectorAll("[data-dock-timer]").forEach((el) => {
    el.textContent = timerText(state);
  });

  const currentMinutes = state.timer?.minutes ?? state.pendingTimerMinutes ?? null;
  document.querySelectorAll("[data-timer]").forEach((el) => {
    const minutes = Number(el.dataset.timer);
    const active = currentMinutes === minutes && !state.timer?.fading;
    el.classList.toggle("selected", active);
  });
  document.querySelectorAll("[data-timer-custom]").forEach((el) => {
    const custom =
      currentMinutes !== null && ![30, 60, 90].includes(currentMinutes) && !state.timer?.fading;
    el.classList.toggle("selected", custom);
  });
  document.querySelectorAll("[data-timer-clear]").forEach((el) => {
    el.hidden = !state.timer && !state.pendingTimerMinutes;
  });
  document.querySelectorAll("[data-timer-note]").forEach((el) => {
    el.hidden = !(state.pendingTimerMinutes && !state.timer);
  });

  document.querySelectorAll("[data-manifest-note]").forEach((el) => {
    el.textContent = state.manifestStatus === "loaded" ? "真实音频已接入" : "内置合成音色";
  });

  document.querySelectorAll("[data-fade-out]").forEach((el) => {
    if (document.activeElement !== el) el.value = String(state.fadeOutSeconds);
  });

  document.querySelectorAll(".breath-circle").forEach((el) => {
    el.classList.toggle("is-live", state.playing);
  });

  syncDock(state);
  if (appState.sleepMode) syncSleepLayer(state);
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

function toast(message, tone = "info") {
  if (!message) return;
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }

  while (host.firstElementChild) host.firstElementChild.remove();

  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.textContent = message;
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add("is-visible"));
  setTimeout(() => {
    node.classList.remove("is-visible");
    setTimeout(() => node.remove(), 320);
  }, 3800);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function paintRange(input) {
  input.style.setProperty("--value", `${input.value}%`);
}

async function handleAudioToggle() {
  const state = engineState();
  if (!state.supported) {
    toast("当前浏览器不支持 Web Audio API，请换一个浏览器试试。", "warn");
    return;
  }
  try {
    if (state.playing) {
      audioEngine.pause();
      return;
    }
    const started = await audioEngine.play();
    if (!started) toast("声音启动失败，请再点一次或刷新页面。", "warn");
  } catch (error) {
    console.error("[SleepAudio] play failed", error);
    toast("声音启动失败，请检查浏览器音量设置。", "warn");
  }
}

async function handleTrackToggle(id) {
  const sound = getSound(id);
  if (!sound) return;
  if (sound.reserved) {
    toast(sound.hint || "这个声音会在下一阶段接入。", "calm");
    return;
  }

  markCustomMix();
  const state = engineState();
  const enabled = Boolean(state.tracks[id]?.enabled);
  try {
    const result = await audioEngine.setTrackEnabled(id, !enabled);
    if (result?.ok === false && result.reason !== "reserved") {
      toast("这个声音暂时无法开启，请稍后重试。", "warn");
    }
  } catch (error) {
    console.error("[SleepAudio] toggle failed", error);
    toast("声音切换失败，请刷新页面后重试。", "warn");
  }
}

function clearPresetSelection() {
  if (!appState.activePresetId) return;
  appState.activePresetId = null;
  document.querySelectorAll("[data-preset-card]").forEach((card) => {
    card.classList.remove("is-active");
  });
  document.querySelectorAll(".preset-badge").forEach((badge) => badge.remove());
  document.querySelectorAll("[data-apply-preset]").forEach((button) => {
    button.textContent = "应用";
  });
  const current = document.querySelector("[data-preset-current]");
  if (current) current.textContent = "当前：自定义混音";
}

function markCustomMix() {
  clearPresetSelection();
  if (appState.planApplied) appState.planApplied = false;
  appState.feedbackDraft = null;
}

async function applyPreset(id) {
  const preset = PRESET_BY_ID.get(id);
  if (!preset) return;

  const wasPlaying = engineState().playing;
  try {
    const ok = await audioEngine.applyMix(preset.sounds, {
      autoplay: false,
      timerMinutes: preset.timerMinutes,
      fade: 2.2,
    });
    if (!ok) {
      toast("这个预设暂时无法应用，请稍后再试。", "warn");
      return;
    }

    appState.activePresetId = preset.id;
    appState.planApplied = false;
    appState.feedbackDraft = null;
    render();
    toast(
      wasPlaying
        ? `已平滑切换到「${preset.name}」· ${preset.timerMinutes} 分钟计时。`
        : `已应用「${preset.name}」· ${preset.timerMinutes} 分钟，点击开始播放。`,
      "calm",
    );
  } catch (error) {
    console.error("[SleepAudio] applyPreset failed", error);
    toast("预设应用失败，请重试。", "warn");
  }
}

async function applyPlanConfiguration(plan) {
  const ok = await audioEngine.applyMix(plan.sounds, {
    autoplay: false,
    timerMinutes: plan.durationMinutes,
    fade: 2.2,
  });
  if (!ok) return false;
  appState.planApplied = true;
  appState.activePresetId = null;
  appState.feedbackDraft = null;
  return true;
}

async function handleApplyPlan() {
  const plan = appState.currentPlan;
  if (!plan || appState.applyingPlan) return;

  appState.applyingPlan = true;
  render();
  try {
    const ok = await applyPlanConfiguration(plan);
    appState.applyingPlan = false;
    render();
    if (!ok) {
      toast("方案暂时无法应用，请稍后再试。", "warn");
      return;
    }
    toast(
      `已应用「${plan.title}」· ${plan.durationMinutes} 分钟，点击开始播放。`,
      "calm",
    );
  } catch (error) {
    appState.applyingPlan = false;
    console.error("[SleepAudio] applyPlan failed", error);
    toast("方案应用失败，请重试。", "warn");
    render();
  }
}

async function handleEditPlan() {
  const plan = appState.currentPlan;
  if (!plan) return;

  try {
    if (!appState.planApplied) {
      const ok = await applyPlanConfiguration(plan);
      if (!ok) {
        toast("方案暂时无法应用，请稍后再试。", "warn");
        render();
        return;
      }
    }
    navigate("mixer");
    toast("方案已应用到混音器，可以继续调整。", "calm");
  } catch (error) {
    console.error("[SleepAudio] editPlan failed", error);
    toast("方案应用失败，请重试。", "warn");
  }
}

async function handleStartPlan() {
  const plan = appState.currentPlan;
  if (!plan) return;

  try {
    if (!appState.planApplied) {
      const ok = await applyPlanConfiguration(plan);
      if (!ok) {
        toast("方案暂时无法应用，请稍后再试。", "warn");
        render();
        return;
      }
    }
    const started = await audioEngine.play();
    if (!started) {
      toast("声音启动失败，请再点一次。", "warn");
      render();
      return;
    }
    navigate("session");
  } catch (error) {
    console.error("[SleepAudio] startPlan failed", error);
    toast("声音启动失败，请检查浏览器设置。", "warn");
  }
}

async function handleRegeneratePlan() {
  if (appState.regenerating) return;
  const input = appState.planInput;
  if (!input) {
    toast("请先重新描述今晚的状态，再生成方案。", "calm");
    navigate("coach");
    return;
  }

  appState.regenerating = true;
  render();
  try {
    const plan = await generateSleepPlan(input);
    appState.currentPlan = plan;
    appState.planApplied = false;
    appState.feedbackDraft = null;
    appState.regenerating = false;
    const saved = savePlan(plan);
    render();
    toast("已重新生成今晚的方案。", "calm");
    if (!saved.ok) toast("方案已生成，但浏览器无法保存它。", "warn");
  } catch (error) {
    appState.regenerating = false;
    console.error("[SleepPlan] regenerate failed", error);
    toast("重新生成失败，请稍后再试。", "warn");
    render();
  }
}

async function handleGeneratePlan() {
  if (appState.generating) return;

  const description = appState.journal.trim();
  const tags = [...appState.inputTags];
  if (!description && tags.length === 0) {
    appState.generateError = "写一句今晚的状态，或选择一个标签。";
    render();
    return;
  }

  appState.generating = true;
  appState.generateError = "";
  render();

  try {
    const plan = await generateSleepPlan({
      description,
      tags,
      durationMinutes: appState.inputDuration,
    });
    appState.currentPlan = plan;
    appState.planInput = {
      description,
      tags,
      durationMinutes: appState.inputDuration,
    };
    appState.planApplied = false;
    appState.feedbackDraft = null;
    appState.generating = false;

    const saved = savePlan(plan);
    navigate("plan");
    if (!saved.ok) toast("方案已生成，但浏览器无法保存它。", "warn");
  } catch (error) {
    appState.generating = false;
    appState.generateError =
      error?.code === "EMPTY_INPUT"
        ? error.message
        : "方案生成失败，请稍后再试。";
    console.error("[SleepPlan] generate failed", error);
    render();
  }
}

async function handleFeedbackSubmit(event) {
  event?.preventDefault();
  if (appState.feedbackSubmitting) return;

  const draft = ensureFeedbackDraft();
  if (!draft.rating) {
    appState.feedbackError = "请选择一个 1—5 分的整体体验评分。";
    render();
    return;
  }

  appState.feedbackSubmitting = true;
  appState.feedbackError = "";
  render();

  const source = resolveFeedbackSource(draft.source);
  const payload = {
    ...source,
    rating: draft.rating,
    soundComfort: draft.soundComfort || null,
    planMatch: draft.planMatch || null,
    reuseIntent: draft.reuseIntent || null,
    comment: draft.comment,
  };

  const result = appState.feedbackEditingId
    ? updateFeedback(appState.feedbackEditingId, payload)
    : saveFeedback(payload);

  appState.feedbackSubmitting = false;

  if (!result.ok) {
    appState.feedbackError =
      result.error === "storage-unavailable"
        ? "浏览器本地存储不可用，反馈没有保存。"
        : "保存失败，请稍后再试。";
    if (result.error === "storage-unavailable") appState.feedbackStorageError = true;
    render();
    return;
  }

  appState.feedbackSuccess = result.feedback;
  appState.feedbackEditingId = null;
  appState.feedbackDraft = null;
  appState.feedbackError = "";
  appState.feedbackStorageError = false;
  appState.feedbackLoadError = "";
  appState.feedbackEntries = result.entries ?? loadFeedback().entries;
  render();
  toast("反馈已保存在当前浏览器。", "calm");
}

function handleEditFeedback(feedbackId) {
  const entry = appState.feedbackEntries.find((item) => item.feedbackId === feedbackId);
  if (!entry) return;

  const source =
    entry.sourceType === "plan" && entry.planId
      ? `plan:${entry.planId}`
      : entry.sourceType === "preset" && entry.presetId
        ? `preset:${entry.presetId}`
        : entry.sourceType === "none"
          ? "none"
          : "custom";

  appState.feedbackDraft = {
    source,
    rating: entry.rating,
    soundComfort: entry.soundComfort ?? "",
    planMatch: entry.planMatch ?? "",
    reuseIntent: entry.reuseIntent ?? "",
    comment: entry.comment ?? "",
  };
  appState.feedbackEditingId = feedbackId;
  appState.feedbackSuccess = null;
  appState.feedbackError = "";
  render();
}

function handleNewFeedback() {
  appState.feedbackSuccess = null;
  appState.feedbackEditingId = null;
  appState.feedbackDraft = null;
  appState.feedbackError = "";
  render();
}

function applyRecommendedMix() {
  const entries = recommendedTracks()
    .map((track) => ({
      id: resolveSoundId(track.id),
      volume: Math.min(0.9, Math.max(0.15, track.weight / 100)),
    }))
    .filter((entry) => entry.id);

  markCustomMix();
  audioEngine
    .applyMix(entries)
    .then((ok) => {
      if (!ok) toast("无法启动声音，请再试一次。", "warn");
    })
    .catch((error) => {
      console.error("[SleepAudio] applyMix failed", error);
    });

  navigate("session");
}

function initEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const routeButton = target.closest("button[data-route]");
    if (routeButton) {
      event.preventDefault();
      navigate(routeButton.dataset.route);
      return;
    }

    const audioToggle = target.closest("[data-audio-toggle]");
    if (audioToggle) {
      event.preventDefault();
      handleAudioToggle();
      return;
    }

    const trackToggle = target.closest("[data-track-toggle]");
    if (trackToggle) {
      event.preventDefault();
      handleTrackToggle(trackToggle.dataset.trackToggle);
      return;
    }

    const sleepToggle = target.closest("[data-sleep-toggle]");
    if (sleepToggle) {
      event.preventDefault();
      setSleepMode(!appState.sleepMode);
      return;
    }

    const sleepExit = target.closest("[data-sleep-exit]");
    if (sleepExit) {
      event.preventDefault();
      setSleepMode(false);
      return;
    }

    const timerChip = target.closest("[data-timer]");
    if (timerChip) {
      event.preventDefault();
      markCustomMix();
      audioEngine.startTimer(Number(timerChip.dataset.timer));
      return;
    }

    const customTimer = target.closest("[data-timer-custom]");
    if (customTimer) {
      event.preventDefault();
      const form = document.querySelector("[data-timer-form]");
      if (form) {
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector("[data-timer-input]")?.focus();
      }
      return;
    }

    const clearTimer = target.closest("[data-timer-clear]");
    if (clearTimer) {
      event.preventDefault();
      markCustomMix();
      audioEngine.clearTimer();
      return;
    }

    const presetButton = target.closest("[data-apply-preset]");
    if (presetButton) {
      event.preventDefault();
      applyPreset(presetButton.dataset.applyPreset);
      return;
    }

    const feelTag = target.closest("[data-feel-tag]");
    if (feelTag) {
      event.preventDefault();
      if (appState.generating) return;
      const id = feelTag.dataset.feelTag;
      appState.inputTags = appState.inputTags.includes(id)
        ? appState.inputTags.filter((item) => item !== id)
        : [...appState.inputTags, id];
      appState.generateError = "";
      render();
      return;
    }

    const feelDuration = target.closest("[data-feel-duration]");
    if (feelDuration) {
      event.preventDefault();
      if (appState.generating) return;
      appState.inputDuration = Number(feelDuration.dataset.feelDuration);
      render();
      return;
    }

    const applyPlan = target.closest("[data-apply-plan]");
    if (applyPlan) {
      event.preventDefault();
      handleApplyPlan();
      return;
    }

    const editPlan = target.closest("[data-edit-plan]");
    if (editPlan) {
      event.preventDefault();
      handleEditPlan();
      return;
    }

    const startPlan = target.closest("[data-start-plan]");
    if (startPlan) {
      event.preventDefault();
      handleStartPlan();
      return;
    }

    const regeneratePlan = target.closest("[data-regenerate-plan]");
    if (regeneratePlan) {
      event.preventDefault();
      handleRegeneratePlan();
      return;
    }

    const feedbackRating = target.closest("[data-feedback-rating]");
    if (feedbackRating) {
      event.preventDefault();
      ensureFeedbackDraft().rating = Number(feedbackRating.dataset.feedbackRating);
      appState.feedbackError = "";
      render();
      return;
    }

    const feedbackField = target.closest("[data-feedback-field]");
    if (feedbackField) {
      event.preventDefault();
      const draft = ensureFeedbackDraft();
      draft[feedbackField.dataset.feedbackField] = feedbackField.dataset.feedbackValue;
      appState.feedbackError = "";
      render();
      return;
    }

    const editFeedback = target.closest("[data-edit-feedback]");
    if (editFeedback) {
      event.preventDefault();
      handleEditFeedback(editFeedback.dataset.editFeedback);
      return;
    }

    const newFeedback = target.closest("[data-new-feedback]");
    if (newFeedback) {
      event.preventDefault();
      handleNewFeedback();
      return;
    }

    const skipFeedback = target.closest("[data-feedback-skip]");
    if (skipFeedback) {
      event.preventDefault();
      navigate("session");
      return;
    }

    const applyMix = target.closest("[data-apply-recommendation]");
    if (applyMix) {
      event.preventDefault();
      applyRecommendedMix();
      return;
    }
  });

  document.addEventListener("input", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const master = target.closest("[data-master-volume]");
    if (master) {
      paintRange(master);
      audioEngine.setMasterVolume(Number(master.value) / 100);
      return;
    }

    const volume = target.closest("[data-track-volume]");
    if (volume) {
      markCustomMix();
      paintRange(volume);
      audioEngine.setTrackVolume(volume.dataset.trackVolume, Number(volume.value) / 100);
      return;
    }

    const journal = target.closest("[data-journal]");
    if (journal) {
      appState.journal = journal.value;
      if (appState.generateError) appState.generateError = "";
      return;
    }

    const feedbackComment = target.closest("[data-feedback-comment]");
    if (feedbackComment) {
      ensureFeedbackDraft().comment = feedbackComment.value;
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const fadeOut = target.closest("[data-fade-out]");
    if (fadeOut) {
      audioEngine.setFadeOutSeconds(Number(fadeOut.value));
      toast(`淡出时长已设为 ${fadeOut.value} 秒。`, "info");
      return;
    }

    const feedbackSource = target.closest("[data-feedback-source]");
    if (feedbackSource) {
      ensureFeedbackDraft().source = feedbackSource.value;
    }
  });

  document.addEventListener("submit", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("[data-feel-form]")) {
      event.preventDefault();
      handleGeneratePlan();
      return;
    }

    if (target.closest("[data-feedback-form]")) {
      event.preventDefault();
      handleFeedbackSubmit(event);
      return;
    }

    const form = target.closest("[data-timer-form]");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("[data-timer-input]");
    const minutes = Math.min(720, Math.max(1, Number(input?.value) || 30));
    markCustomMix();
    audioEngine.startTimer(minutes);
    form.hidden = true;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && appState.sleepMode) setSleepMode(false);
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

let pendingHash = null;

function render() {
  const renderRoute = routes[appState.route] || routes.home;
  const app = document.querySelector("#app");
  if (app) app.innerHTML = renderRoute();
  document.body.dataset.page = appState.route;
  syncAudioUi(engineState());
}

function init() {
  buildDock();
  buildSleepLayer();
  document.documentElement.dataset.sleepMode = "off";
  initEvents();

  audioEngine.subscribe((state) => syncAudioUi(state));
  audioEngine.onNotice(({ message, tone }) => toast(message, tone));

  // Debug hook and the entry point the future AI module can use.
  window.sleepAudio = audioEngine;

  appState.currentPlan = loadPlan();

  const feedbackResult = loadFeedback();
  appState.feedbackEntries = feedbackResult.entries;
  if (!feedbackResult.ok) {
    if (feedbackResult.error === "storage-unavailable") {
      appState.feedbackStorageError = true;
      appState.feedbackLoadError = "浏览器禁止本地存储，反馈无法保存；你仍然可以跳过。";
    } else {
      appState.feedbackLoadError = "本地反馈数据读取失败；新的提交会从空记录开始。";
    }
  }

  const route = window.location.hash.replace("#", "");
  if (routes[route]) appState.route = route;

  window.addEventListener("hashchange", () => {
    if (pendingHash === window.location.hash) {
      pendingHash = null;
      return;
    }
    const nextRoute = window.location.hash.replace("#", "");
    if (routes[nextRoute]) {
      appState.route = nextRoute;
      window.scrollTo(0, 0);
      render();
    }
  });

  render();
}

init();
