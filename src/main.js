import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronDown,
  createIcons,
  Download,
  History,
  ImagePlus,
  LogIn,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Send,
  SlidersHorizontal,
  Sun,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users,
  Wand2,
  X,
} from "lucide";
import "./styles.css";
import "./mobile.css";
import { getModelsForProvider, getParamOptions, normalizeModelState } from "./config.js";
import { bindMobileAppEvents, renderMobileApp } from "./mobileApp.js";
import { getTheme, toggleTheme } from "./theme.js";
import { appConfig } from "./appConfig.js";

const maxEditImages = 6;
const maxPromptLength = 32000;
const pollIntervalMs = 3000;
const pollTimeoutMs = 1000 * 60 * 12;

// 主状态树：当前项目仍是 Vanilla JS 全量重渲染模式，所有界面都从这里派生。
const state = {
  route: window.location.pathname.startsWith("/admin") ? "admin" : window.location.pathname.startsWith("/login") ? "login" : "app",
  mode: "generate",
  providerId: "panghu",
  model: "gpt-image-2",
  size: "auto",
  quality: "auto",
  count: 1,
  prompt: "",
  history: [],
  selectedId: null,
  editFiles: [],
  isGenerating: false,
  generationStartedAt: null,
  elapsedSeconds: 0,
  activeJobId: null,
  activeJobStatus: "",
  activeJobAttempts: 0,
  leftCollapsed: false,
  showBackendNotice: false,
  apiError: "",
  authReady: false,
  currentUser: null,
  loginError: "",
  loginLoading: false,
  mobileUI: {
    loginOpen: false,
    composerOpen: false,
    activeSetting: "",
    subroute: "feed",
    managingHistory: false,
    selectedHistoryIds: [],
    toast: "",
    batchActionText: "",
  },
  admin: {
    ready: false,
    user: null,
    loginError: "",
    loginLoading: false,
    view: "dashboard",
    dashboard: null,
    users: [],
    logs: [],
    logTotal: 0,
    logPage: 1,
    notice: "",
    error: "",
    form: {
      username: "",
      displayName: "",
      password: "",
      quotaRemaining: 10,
    },
  },
};

const app = document.querySelector("#app");
let generationTimer = null;
let adminRefreshTimer = null;
let mobileToastTimer = null;
const mobileQuery = window.matchMedia("(max-width: 768px)");
state.leftCollapsed = mobileQuery.matches;

function isMobileAppViewport() {
  return mobileQuery.matches;
}

function resetMobileHistorySelection() {
  state.mobileUI.managingHistory = false;
  state.mobileUI.selectedHistoryIds = [];
  state.mobileUI.batchActionText = "";
}

function showMobileToast(message) {
  state.mobileUI.toast = message;
  if (mobileToastTimer) window.clearTimeout(mobileToastTimer);
  render();
  mobileToastTimer = window.setTimeout(() => {
    state.mobileUI.toast = "";
    render();
  }, 2200);
}

function promptMobileLogin() {
  state.mobileUI.loginOpen = true;
  state.loginError = "";
  render();
}

function syncMobileModeFromFiles() {
  if (isMobileAppViewport() && state.route === "app") {
    state.mode = state.editFiles.length ? "edit" : "generate";
  }
}

const icons = {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronDown,
  Download,
  History,
  ImagePlus,
  LogIn,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Send,
  SlidersHorizontal,
  Sun,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users,
  Wand2,
  X,
};

function routeTo(path) {
  window.history.pushState({}, "", path);
  state.route = path.startsWith("/admin") ? "admin" : path.startsWith("/login") ? "login" : "app";
  if (state.route === "app" && mobileQuery.matches) {
    state.leftCollapsed = true;
  }
  render();
  if (state.route === "admin") loadAdminSession();
  syncAdminRefresh();
}

window.addEventListener("popstate", () => {
  state.route = window.location.pathname.startsWith("/admin") ? "admin" : window.location.pathname.startsWith("/login") ? "login" : "app";
  render();
  syncAdminRefresh();
});

mobileQuery.addEventListener("change", (event) => {
  if (state.route !== "app") return;
  state.leftCollapsed = event.matches;
  render();
});

function optionList(options, selectedId) {
  return options
    .map((option) => `<option value="${option.id}" ${option.id === selectedId ? "selected" : ""}>${option.name}</option>`)
    .join("");
}

function selectedItem() {
  return state.history.find((item) => item.id === state.selectedId) ?? null;
}

function restoreFromHistory(item) {
  state.selectedId = item.id;
  state.providerId = item.providerId ?? "panghu";
  state.model = item.model ?? "gpt-image-2";
  state.size = item.size ?? "auto";
  state.quality = item.quality ?? "auto";
  state.count = item.count ?? 1;
  state.prompt = item.prompt ?? "";
  state.mode = item.mode ?? "generate";
  normalizeModelState(state);
  normalizeCount();
}

function formatTime(dateString) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));
}

function formatDateTime(dateString) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));
}

function formatShanghaiTimestamp(dateString) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(dateString));

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}-${value.hour}${value.minute}${value.second}`;
}

function formatElapsed(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function jobStatusText(status) {
  if (status === "queued") return "排队中";
  if (status === "processing") return "处理中";
  if (status === "retrying") return "等待重试";
  if (status === "done") return "已完成";
  if (status === "failed") return "失败";
  return "处理中";
}

function generationTip() {
  if (state.activeJobStatus === "retrying") return "上游暂时不可用，10 秒后会自动重试";
  if (state.activeJobStatus === "queued") return "任务已提交，正在进入处理队列";
  if (state.elapsedSeconds < 20) return "正在提交任务，请稍候片刻";
  if (state.elapsedSeconds < 90) return "图片正在生成中，复杂画面可能需要更久";
  if (state.elapsedSeconds < 210) return "仍在等待模型返回，请耐心等待";
  return "接近完成了，请保持页面打开";
}

function previewRatioSource(item) {
  return item?.size && item.size !== "auto" ? item.size : state.size;
}

function previewStyle(item) {
  const size = previewRatioSource(item);
  const match = /^(\d+)x(\d+)$/.exec(size || "");
  if (!match) return "aspect-ratio: 1 / 1; --preview-ratio: 1;";
  const width = Number(match[1]);
  const height = Number(match[2]);
  return `aspect-ratio: ${width} / ${height}; --preview-ratio: ${width / height};`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeCount() {
  state.count = 1;
}

function currentRequestShape() {
  syncMobileModeFromFiles();
  normalizeCount();
  return {
    providerId: state.providerId,
    model: state.model,
    prompt: state.prompt.trim(),
    size: state.size,
    quality: state.quality,
    count: Number(state.count),
    mode: state.mode,
  };
}

function canGenerate() {
  return Boolean(state.currentUser) && state.currentUser.quotaRemaining > 0 && !state.isGenerating;
}

function clearEditFiles() {
  // 预览图使用了 Object URL，不主动释放的话浏览器会一直占用内存。
  for (const item of state.editFiles) {
    URL.revokeObjectURL(item.previewUrl);
  }
  state.editFiles = [];
}

function buildPreviewFiles(files) {
  return files.map((file) => ({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    name: file.name,
    size: file.size,
    type: file.type,
  }));
}

function appendEditFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;

  const available = maxEditImages - state.editFiles.length;
  const picked = incoming.slice(0, Math.max(0, available));
  if (!picked.length) {
    state.apiError = `最多只能上传 ${maxEditImages} 张参考图。`;
    return;
  }

  state.editFiles = [...state.editFiles, ...buildPreviewFiles(picked)];
  if (incoming.length > picked.length) {
    state.apiError = `最多只能上传 ${maxEditImages} 张参考图。`;
  }
}

function removeEditFile(fileId) {
  const file = state.editFiles.find((item) => item.id === fileId);
  if (file) URL.revokeObjectURL(file.previewUrl);
  state.editFiles = state.editFiles.filter((item) => item.id !== fileId);
}

function buildHistoryItem(result, request) {
  return {
    id: result.id || `hist-${Date.now()}`,
    userId: result.userId,
    createdAt: result.createdAt || new Date().toISOString(),
    prompt: result.prompt || request.prompt,
    revisedPrompt: result.revisedPrompt || null,
    providerId: result.providerId || request.providerId,
    model: result.model || request.model,
    size: result.size || request.size,
    quality: result.quality || request.quality,
    count: result.count || request.count,
    mode: result.mode || request.mode,
    imageUrl: result.imageUrl || result.previewUrl || null,
    previewUrl: result.previewUrl || result.imageUrl || null,
    thumbnailUrl: result.thumbnailUrl || result.previewUrl || result.imageUrl || null,
    downloadUrl: result.downloadUrl || (result.id ? `/api/images/history/${result.id}/download` : null),
    status: result.status || "done",
    usage: result.usage || null,
    request: result.request || null,
  };
}

function upsertHistoryItem(nextItem) {
  state.history = [nextItem, ...state.history.filter((item) => item.id !== nextItem.id)];
  state.selectedId = nextItem.id;
}

function editPreviewStage() {
  if (!state.editFiles.length) return "";
  return `
    <div class="edit-preview-grid">
      ${state.editFiles
        .slice(0, 4)
        .map(
          (file) => `
            <figure class="edit-preview-card">
              <img src="${escapeHtml(file.previewUrl)}" alt="${escapeHtml(file.name)}" />
            </figure>
          `,
        )
        .join("")}
    </div>
  `;
}

function editUploadSection() {
  if (state.mode !== "edit") return "";
  return `
    <div class="field edit-upload-field">
      <span>参考图片</span>
      <input class="hidden-file-input" data-role="edit-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple />
      <div class="upload-toolbar compact">
        <span class="upload-meta"><i data-lucide="wand2"></i> ${state.editFiles.length}/${maxEditImages}</span>
        <div class="upload-actions">
          <button class="tool-button" type="button" data-action="clear-edit-files" ${state.editFiles.length ? "" : "disabled"}><i data-lucide="x"></i><span>清空</span></button>
        </div>
      </div>
      <button class="upload-dropzone compact" type="button" data-action="select-edit-images">
        <i data-lucide="image-plus"></i>
        <strong>上传参考图</strong>
        <span>最多 ${maxEditImages} 张，单张 10MB</span>
      </button>
      ${
        state.editFiles.length
          ? `
            <div class="upload-square-grid">
              ${state.editFiles
                .map(
                  (file) => `
                    <div class="upload-square-card">
                      <button class="upload-square-thumb" type="button" data-action="preview-edit-file" data-preview-src="${escapeHtml(file.previewUrl)}" data-preview-name="${escapeHtml(file.name)}" aria-label="查看参考图">
                        <img src="${escapeHtml(file.previewUrl)}" alt="${escapeHtml(file.name)}" />
                      </button>
                      <button class="thumb-remove" type="button" data-action="remove-edit-file" data-file-id="${file.id}" aria-label="删除参考图">
                        <i data-lucide="x"></i>
                      </button>
                    </div>
                  `,
                )
                .join("")}
            </div>
          `
          : ""
      }
    </div>
  `;
}

function promptMetaText() {
  return `${state.prompt.trim().length}/${maxPromptLength}`;
}

function render() {
  const mobileAppActive = state.route === "app" && isMobileAppViewport();
  document.body.classList.toggle("is-mobile-app", mobileAppActive);
  app.classList.toggle("is-mobile-app", mobileAppActive);

  if (state.route === "login") {
    renderLogin();
    return;
  }
  if (state.route === "admin") {
    renderAdmin();
    return;
  }
  if (mobileAppActive) {
    renderMobileRoot();
    return;
  }
  renderApp();
}

function applyIcons() {
  createIcons({ icons });
}

function renderMobileRoot() {
  normalizeModelState(state);
  syncMobileModeFromFiles();
  app.innerHTML = renderMobileApp({
    state,
    selectedItem: selectedItem(),
    formatDateTime,
  });
  bindMobileEvents();
  applyIcons();
}

function renderApp() {
  normalizeModelState(state);
  const item = selectedItem();
  const theme = getTheme();
  const providerModels = getModelsForProvider(state.providerId);
  const sizeOptions = getParamOptions(state.providerId, state.model, "size");
  const qualityOptions = getParamOptions(state.providerId, state.model, "quality");
  const user = state.currentUser;
  const sendDisabled = !canGenerate();
  const sendTitle = !user ? "请先登录" : user.quotaRemaining <= 0 ? "可用次数不足" : state.mode === "edit" ? "开始图生图" : "生成图片";

  app.innerHTML = `
    <main class="shell ${state.leftCollapsed ? "is-left-collapsed" : ""}">
      ${!state.leftCollapsed && mobileQuery.matches ? `<button class="mobile-sidebar-backdrop" data-action="toggle-left" aria-label="关闭参数面板"></button>` : ""}
      <section class="sidebar settings-panel" aria-label="生成参数">
        <div class="brand-row">
          <div class="brand-mark">胖</div>
          <div>
            <h1>胖狐生图</h1>
            <p>你贴心的图像生成工作台</p>
          </div>
          <button class="icon-button ghost only-compact" data-action="expand-left" aria-label="展开参数">
            <i data-lucide="panel-left-open"></i>
          </button>
        </div>

        <div class="panel-toolbar">
          <span class="section-kicker"><i data-lucide="sliders-horizontal"></i> 参数</span>
          <button class="icon-button ghost" data-action="toggle-left" aria-label="收起参数">
            <i data-lucide="panel-left-close"></i>
          </button>
        </div>

        <label class="field">
          <span>提供商</span>
          <div class="select-wrap">
            <select data-field="providerId">${optionList(
              appConfig.providers.map((provider) => ({ id: provider.id, name: provider.name })),
              state.providerId,
            )}</select>
            <i data-lucide="chevron-down"></i>
          </div>
        </label>

        <label class="field">
          <span>模型</span>
          <div class="select-wrap">
            <select data-field="model">${optionList(providerModels, state.model)}</select>
            <i data-lucide="chevron-down"></i>
          </div>
        </label>

        <label class="field">
          <span>图片尺寸</span>
          <div class="select-wrap">
            <select data-field="size">${optionList(sizeOptions, state.size)}</select>
            <i data-lucide="chevron-down"></i>
          </div>
        </label>

        <label class="field">
          <span>质量</span>
          <div class="select-wrap">
            <select data-field="quality">${optionList(qualityOptions, state.quality)}</select>
            <i data-lucide="chevron-down"></i>
          </div>
        </label>

        <label class="field">
          <span>生成数量</span>
          <input data-field="count" type="number" min="1" max="1" step="1" value="1" inputmode="numeric" />
        </label>

        ${editUploadSection()}

        <div class="user-card">
          ${
            user
              ? `<strong>${escapeHtml(user.displayName)}</strong><span>剩余可生成 ${Number(user.quotaRemaining)} 次</span>`
              : `<strong>未登录</strong><span>登录后可以生成并查看个人历史</span>`
          }
        </div>
      </section>

      <section class="workspace" aria-label="图片生成区">
        <header class="topbar">
          <button class="icon-button ghost compact-toggle" data-action="toggle-left" aria-label="参数面板">
            <i data-lucide="panel-left-open"></i>
          </button>
          <div class="topbar-center">
            <div class="mode-switch" role="tablist" aria-label="模式">
              <button class="${state.mode === "generate" ? "active" : ""}" data-mode="generate" role="tab">文生图</button>
              <button class="${state.mode === "edit" ? "active" : ""}" data-mode="edit" role="tab">图生图</button>
            </div>
            <button class="download-main" data-action="download-selected" type="button" ${item ? "" : "disabled"} aria-label="下载原图">
              <i data-lucide="download"></i>
              <span>下载原图</span>
            </button>
          </div>
          <div class="topbar-actions">
            ${
              user
                ? `<button class="theme-button" data-action="logout" aria-label="退出登录"><i data-lucide="log-out"></i><span>退出登录</span></button>`
                : `<button class="theme-button" data-action="go-login" aria-label="登录"><i data-lucide="log-in"></i><span>登录</span></button>`
            }
            <button class="theme-button" data-action="toggle-theme" aria-label="切换主题">
              <i data-lucide="${theme === "dark" ? "sun" : "moon"}"></i>
              <span>${theme === "dark" ? "亮色" : "暗色"}</span>
            </button>
          </div>
        </header>

        <div class="canvas-wrap">
          <div class="canvas-stage ${state.isGenerating ? "is-loading" : ""} ${item && !state.isGenerating ? "has-image" : ""}" style="${previewStyle(item)}">
            ${
              state.isGenerating
                ? `
                  <div class="loading-card">
                    <div class="generation-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
                    <strong>正在生成，请耐心等待</strong>
                    <span>${generationTip()}</span>
                    <em>状态：${jobStatusText(state.activeJobStatus)} · 第 ${Math.max(1, state.activeJobAttempts || 1)} 次尝试 · 已等待 ${formatElapsed(state.elapsedSeconds)}</em>
                  </div>
                `
                : item
                  ? item.previewUrl
                    ? `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.prompt)}" data-action="fullscreen" />`
                    : `<div class="empty-state"><i data-lucide="image-plus"></i><strong>图片缺失</strong><span>当前仅找到了历史记录，展示图不可用。</span></div>`
                  : state.mode === "edit" && state.editFiles.length
                    ? editPreviewStage()
                    : `<div class="empty-state"><i data-lucide="image-plus"></i><strong>${user ? (state.mode === "edit" ? "上传参考图开始编辑" : "暂无图片") : "请先登录"}</strong><span>${user ? (state.mode === "edit" ? "支持多张参考图，上传后可继续输入修改描述" : "输入提示词，创造属于你的图片") : "登录后即可生成图片并查看个人历史"}</span></div>`
            }
          </div>
        </div>

        <form class="prompt-box" data-role="prompt-form">
          <div class="prompt-editor">
            <div class="prompt-input-wrap">
              <textarea
                data-field="prompt"
                rows="3"
                maxlength="${maxPromptLength}"
                placeholder="${user ? (state.mode === "edit" ? "描述你希望如何修改这些图片" : "输入你的图片描述，文本绘制用中文双引号 “” 包裹") : "请先登录后输入提示词"}"
              >${escapeHtml(state.prompt)}</textarea>
              <div class="prompt-overlay">
                <span class="prompt-meta inline">提示词长度 ${promptMetaText()}</span>
                <div class="prompt-actions inline">
                  <button type="submit" class="send-button" ${sendDisabled ? "disabled" : ""} title="${sendTitle}" aria-label="${sendTitle}">
                    <i data-lucide="send"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
        ${state.apiError ? `<div class="error-toast" role="alert">${escapeHtml(state.apiError)}</div>` : ""}
      </section>

      <aside class="history-panel" aria-label="历史图片">
        <div class="history-head">
          <span><i data-lucide="history"></i> 历史</span>
          <button class="thumb add" data-action="clear-selection" aria-label="新建图片" ${user ? "" : "disabled"}>
            <i data-lucide="image-plus"></i>
          </button>
        </div>
        <div class="history-list">
          ${
            !user
              ? `<div class="history-empty">登录后显示你的历史图片</div>`
              : state.history.length
                ? state.history
                    .map(
                      (historyItem) => `
                        <div class="thumb-card ${historyItem.id === state.selectedId ? "active" : ""}">
                          <button class="thumb history-select" data-history-id="${historyItem.id}" title="${escapeHtml(historyItem.prompt)}">
                            ${
                              historyItem.thumbnailUrl
                                ? `<img src="${escapeHtml(historyItem.thumbnailUrl)}" alt="${escapeHtml(historyItem.prompt)}" />`
                                : `<span>图片缺失</span>`
                            }
                            <span>${formatTime(historyItem.createdAt)}</span>
                            <em class="history-mode">${historyItem.mode === "edit" ? "图生图" : "文生图"}</em>
                          </button>
                          <button class="history-delete" type="button" data-action="delete-history" data-history-id="${historyItem.id}" aria-label="删除历史">
                            <i data-lucide="trash-2"></i>
                          </button>
                        </div>
                      `,
                    )
                    .join("")
                : `<div class="history-empty">暂未有历史图片</div>`
          }
        </div>
      </aside>

      ${noticeModal("showBackendNotice", "后端服务未启动", "当前无法连接生图服务，请联系管理员或先启动后端服务后再生成图片。", "close-backend-notice")}
    </main>
  `;

  bindAppEvents();
  applyIcons();
}

function noticeModal(flag, title, message, action) {
  return state[flag]
    ? `
      <div class="modal-backdrop" role="presentation">
        <section class="notice-dialog" role="dialog" aria-modal="true">
          <button class="icon-button ghost dialog-close" data-action="${action}" aria-label="关闭提示"><i data-lucide="x"></i></button>
          <div class="notice-icon"><i data-lucide="wand2"></i></div>
          <h2>${title}</h2>
          <p>${message}</p>
          <button class="primary-action" data-action="${action}" autofocus><i data-lucide="check"></i><span>OK</span></button>
        </section>
      </div>
    `
    : "";
}

function renderLogin() {
  const theme = getTheme();
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-panel">
        <div class="brand-row">
          <div class="brand-mark">胖</div>
          <div>
            <h1>胖狐生图</h1>
            <p>登录后继续生成图片</p>
          </div>
        </div>
        <form class="auth-form" data-role="login-form">
          <label class="field"><span>用户名</span><input name="username" autocomplete="username" autofocus /></label>
          <label class="field"><span>密码</span><input name="password" type="password" autocomplete="current-password" /></label>
          ${state.loginError ? `<div class="error-toast auth-error">${escapeHtml(state.loginError)}</div>` : ""}
          <button class="primary-action wide" type="submit" ${state.loginLoading ? "disabled" : ""}>
            <i data-lucide="log-in"></i><span>${state.loginLoading ? "登录中" : "登录"}</span>
          </button>
        </form>
        <div class="auth-actions">
          <button class="theme-button" data-action="go-home">返回主界面</button>
          <button class="theme-button" data-action="toggle-theme"><i data-lucide="${theme === "dark" ? "sun" : "moon"}"></i><span>${theme === "dark" ? "亮色" : "暗色"}</span></button>
        </div>
      </section>
    </main>
  `;
  bindLoginEvents();
  applyIcons();
}

function renderAdmin() {
  const admin = state.admin;
  if (!admin.ready || !admin.user) {
    app.innerHTML = `
      <main class="auth-shell">
        <section class="auth-panel">
          <div class="brand-row">
            <div class="brand-mark">管</div>
            <div>
              <h1>管理员后台</h1>
              <p>使用 .env 中配置的管理员账号登录</p>
            </div>
          </div>
          <form class="auth-form" data-role="admin-login-form">
            <label class="field"><span>管理员账号</span><input name="username" autocomplete="username" autofocus /></label>
            <label class="field"><span>管理员密码</span><input name="password" type="password" autocomplete="current-password" /></label>
            ${admin.loginError ? `<div class="error-toast auth-error">${escapeHtml(admin.loginError)}</div>` : ""}
            <button class="primary-action wide" type="submit" ${admin.loginLoading ? "disabled" : ""}>
              <i data-lucide="log-in"></i><span>${admin.loginLoading ? "登录中" : "登录后台"}</span>
            </button>
          </form>
          <div class="auth-actions"><button class="theme-button" data-action="go-home">返回主界面</button></div>
        </section>
      </main>
    `;
    bindAdminLoginEvents();
    applyIcons();
    return;
  }

  app.innerHTML = `
    <main class="admin-shell">
      <aside class="admin-sidebar">
        <div class="brand-row">
          <div class="brand-mark">胖</div>
          <div><h1>胖狐后台</h1><p>用户与调用管理</p></div>
        </div>
        <nav class="admin-nav">
          <button class="${admin.view === "dashboard" ? "active" : ""}" data-admin-view="dashboard"><i data-lucide="bar-chart-3"></i><span>仪表盘</span></button>
          <button class="${admin.view === "users" ? "active" : ""}" data-admin-view="users"><i data-lucide="users"></i><span>用户管理</span></button>
          <button class="${admin.view === "logs" ? "active" : ""}" data-admin-view="logs"><i data-lucide="history"></i><span>使用统计</span></button>
        </nav>
        <button class="theme-button admin-logout" data-action="admin-logout"><i data-lucide="log-out"></i><span>退出后台</span></button>
      </aside>
      <section class="admin-content">
        <header class="admin-header">
          <div><h2>${admin.view === "dashboard" ? "仪表盘" : admin.view === "users" ? "用户管理" : "使用统计日志"}</h2><p>管理员：${escapeHtml(admin.user.displayName || admin.user.username)}</p></div>
          <button class="theme-button" data-action="go-home">返回主界面</button>
        </header>
        ${admin.notice ? `<div class="success-toast">${escapeHtml(admin.notice)}</div>` : ""}
        ${admin.error ? `<div class="error-toast">${escapeHtml(admin.error)}</div>` : ""}
        ${admin.view === "dashboard" ? adminDashboardHtml() : admin.view === "users" ? adminUsersHtml() : adminLogsHtml()}
      </section>
    </main>
  `;
  bindAdminEvents();
  applyIcons();
}

function adminDashboardHtml() {
  const stats = state.admin.dashboard?.stats || {};
  const recent = state.admin.dashboard?.recentLogs || [];
  const cards = [
    ["用户总数", stats.users ?? 0],
    ["启用用户", stats.enabledUsers ?? 0],
    ["总调用数", stats.totalCalls ?? 0],
    ["成功调用", stats.successCalls ?? 0],
    ["今日调用", stats.todayCalls ?? 0],
    ["总剩余次数", stats.totalRemaining ?? 0],
  ];
  return `
    <div class="stat-grid">${cards.map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`).join("")}</div>
    <section class="admin-table-panel">
      <h3>最近调用</h3>
      <div class="admin-table">
        <div class="table-row table-head dashboard-row"><span>时间</span><span>用户</span><span>模型</span><span>状态</span><span>提示词</span></div>
        ${
          recent.length
            ? recent
                .map(
                  (log) =>
                    `<div class="table-row dashboard-row"><span>${formatDateTime(log.created_at)}</span><span>${escapeHtml(log.display_name || log.username || "-")}</span><span>${escapeHtml(log.model || "-")}</span><span>${escapeHtml(log.status)}</span><span>${escapeHtml(log.prompt || "-")}</span></div>`,
                )
                .join("")
            : `<div class="table-empty">暂无调用记录</div>`
        }
      </div>
    </section>
  `;
}

function adminUsersHtml() {
  const form = state.admin.form;
  const userOptions = state.admin.users
    .map((user) => `<option value="${user.id}">${escapeHtml(user.displayName)}（${escapeHtml(user.username)}）</option>`)
    .join("");
  return `
    <section class="admin-form-panel">
      <h3>添加用户</h3>
      <form class="admin-user-form" data-role="create-user-form">
        <input name="username" placeholder="用户名" value="${escapeHtml(form.username)}" />
        <input name="displayName" placeholder="显示名称" value="${escapeHtml(form.displayName)}" />
        <input name="password" type="password" placeholder="初始密码" value="${escapeHtml(form.password)}" />
        <input name="quotaRemaining" type="number" min="0" step="1" value="${Number(form.quotaRemaining)}" />
        <button class="primary-action" type="submit"><i data-lucide="user-plus"></i><span>添加</span></button>
      </form>
    </section>
    <section class="admin-form-panel">
      <h3>图片归属转移</h3>
      <form class="admin-transfer-form" data-role="transfer-generations-form">
        <div class="select-wrap">
          <select name="fromUserId"><option value="">来源用户</option>${userOptions}</select>
          <i data-lucide="chevron-down"></i>
        </div>
        <div class="select-wrap">
          <select name="toUserId"><option value="">目标用户</option>${userOptions}</select>
          <i data-lucide="chevron-down"></i>
        </div>
        <button class="primary-action" type="submit"><i data-lucide="history"></i><span>转移图片</span></button>
      </form>
    </section>
    <section class="admin-table-panel">
      <h3>用户列表</h3>
      <div class="admin-table user-table">
        <div class="table-row user-row table-head"><span>用户名</span><span>显示名称</span><span>剩余次数</span><span>状态</span><span>新密码</span><span>操作</span></div>
        ${
          state.admin.users.length
            ? state.admin.users
                .map(
                  (user) => `
                    <form class="table-row user-row" data-role="update-user-form" data-user-id="${user.id}">
                      <span>${escapeHtml(user.username)}</span>
                      <input name="displayName" value="${escapeHtml(user.displayName)}" />
                      <input name="quotaRemaining" type="number" min="0" step="1" value="${Number(user.quotaRemaining)}" />
                      <label class="switch-label"><input name="isEnabled" type="checkbox" ${user.isEnabled ? "checked" : ""} />启用</label>
                      <input name="password" type="password" placeholder="留空不变" />
                      <div class="row-actions">
                        <button class="tool-button" type="submit"><i data-lucide="save"></i><span>保存</span></button>
                        <button class="tool-button danger-button" type="button" data-action="delete-user" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}"><i data-lucide="x"></i><span>删除</span></button>
                      </div>
                    </form>
                  `,
                )
                .join("")
            : `<div class="table-empty">暂无用户</div>`
        }
      </div>
    </section>
  `;
}

function adminLogsHtml() {
  return `
    <section class="admin-table-panel">
      <h3>使用统计日志</h3>
      <div class="admin-table logs-table">
        <div class="table-row logs-row table-head"><span>时间</span><span>用户</span><span>模型</span><span>参数</span><span>状态</span><span>图片</span><span>提示词</span></div>
        ${
          state.admin.logs.length
            ? state.admin.logs
                .map(
                  (log) => `
                    <div class="table-row logs-row">
                      <span>${formatDateTime(log.created_at)}</span>
                      <span>${escapeHtml(log.display_name || log.username || "-")}</span>
                      <span>${escapeHtml(log.model || "-")}</span>
                      <span>${escapeHtml([log.size, log.quality].filter(Boolean).join(" / ") || "-")}</span>
                      <span title="${escapeHtml(log.error_message || "")}">${escapeHtml(`${log.status}${log.attempt_count ? ` · ${log.attempt_count}次` : ""}`)}</span>
                      <span>${log.thumbnail_url ? `<a class="admin-image-link" href="${escapeHtml(log.image_url || log.thumbnail_url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(log.thumbnail_url)}" alt="生成图片" /></a>` : `<em class="missing-image">无图</em>`}</span>
                      <span>${escapeHtml(log.prompt || "-")}</span>
                    </div>
                  `,
                )
                .join("")
            : `<div class="table-empty">暂无日志</div>`
        }
      </div>
    </section>
  `;
}

function bindAppEvents() {
  app.querySelectorAll("[data-field]").forEach((control) => {
    control.addEventListener("input", (event) => {
      const field = event.currentTarget.dataset.field;
      if (field === "count") {
        normalizeCount();
        event.currentTarget.value = "1";
      } else {
        state[field] = event.currentTarget.value;
        if (field === "providerId" || field === "model") normalizeModelState(state);
      }
      if (field !== "prompt") render();
    });
  });

  app.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      render();
    });
  });

  app.querySelectorAll("[data-history-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.history.find((historyItem) => historyItem.id === button.dataset.historyId);
      if (item) restoreFromHistory(item);
      render();
    });
  });

  const editInput = app.querySelector("[data-role='edit-file-input']");
  if (editInput) {
    editInput.addEventListener("change", (event) => {
      appendEditFiles(event.currentTarget.files);
      event.currentTarget.value = "";
      render();
    });
  }

  app.querySelector("[data-role='prompt-form']").addEventListener("submit", async (event) => {
    event.preventDefault();
    const textarea = app.querySelector("[data-field='prompt']");
    state.prompt = textarea.value.trim();
    if (!state.prompt || state.prompt.length > maxPromptLength) {
      textarea.focus();
      textarea.classList.add("is-invalid");
      window.setTimeout(() => textarea.classList.remove("is-invalid"), 900);
    }
    await triggerGenerationFromCurrentState();
  });

  app.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => handleAppAction(button, event));
  });
}

function bindMobileEvents() {
  bindMobileAppEvents({
    app,
    onAction: (action, payload) => {
      void handleMobileAction(action, payload);
    },
    onFieldInput: (field, value) => {
      if (field === "prompt") {
        state.prompt = value;
      }
    },
    onLogin: (formData) => {
      void submitUserLogin(formData);
    },
  });

  const editInput = app.querySelector("[data-role='edit-file-input']");
  if (editInput) {
    editInput.addEventListener("change", (event) => {
      appendEditFiles(event.currentTarget.files);
      syncMobileModeFromFiles();
      event.currentTarget.value = "";
      render();
    });
  }
}

async function submitUserLogin(formData) {
  state.loginLoading = true;
  state.loginError = "";
  render();
  try {
    const result = await apiJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: formData.get("username"), password: formData.get("password") }),
    });
    state.currentUser = result.user;
    state.history = [];
    state.selectedId = null;
    state.mobileUI.loginOpen = false;
    await loadStoredHistory();
    if (state.route === "login") {
      routeTo("/");
      return;
    }
  } catch (error) {
    state.loginError = error.message;
  } finally {
    state.loginLoading = false;
    render();
  }
}

async function triggerGenerationFromCurrentState() {
  if (!state.currentUser) {
    state.apiError = "请先登录后再生成图片。";
    if (isMobileAppViewport()) state.mobileUI.loginOpen = true;
    render();
    return;
  }
  if (state.currentUser.quotaRemaining <= 0) {
    state.apiError = "可用生图次数不足，请联系管理员增加次数。";
    render();
    return;
  }

  state.prompt = state.prompt.trim();
  if (!state.prompt || state.prompt.length > maxPromptLength) {
    state.apiError = `提示词长度需在 1 到 ${maxPromptLength} 个字符之间。`;
    render();
    return;
  }

  syncMobileModeFromFiles();
  if (state.mode === "edit" && !state.editFiles.length) {
    state.apiError = "请至少上传一张参考图。";
    render();
    return;
  }

  state.mobileUI.composerOpen = false;
  state.mobileUI.activeSetting = "";
  state.mobileUI.subroute = "feed";
  await generateImage();
}

async function handleMobileAction(action, payload = {}) {
  const requiresLoginActions = new Set([
    "open-history",
    "open-composer",
    "select-edit-images",
    "generate",
    "download-history",
    "copy-prompt",
    "edit-again",
    "toggle-history-manage",
    "toggle-history-select",
    "batch-download",
    "batch-delete",
  ]);

  if (!state.currentUser && requiresLoginActions.has(action)) {
    promptMobileLogin();
    return;
  }

  if (action === "toggle-theme") {
    toggleTheme();
    render();
    return;
  }
  if (action === "toggle-login") {
    state.mobileUI.loginOpen = !state.mobileUI.loginOpen;
    state.loginError = "";
    render();
    return;
  }
  if (action === "logout") {
    state.mobileUI.loginOpen = false;
    await logout();
    return;
  }
  if (action === "open-history") {
    state.mobileUI.subroute = "history";
    resetMobileHistorySelection();
    render();
    return;
  }
  if (action === "open-feed") {
    state.mobileUI.subroute = "feed";
    resetMobileHistorySelection();
    render();
    return;
  }
  if (action === "detail-back") {
    state.mobileUI.subroute = "history";
    render();
    return;
  }
  if (action === "open-detail") {
    state.selectedId = payload.historyId || state.selectedId;
    state.mobileUI.subroute = "detail";
    render();
    return;
  }
  if (action === "open-composer") {
    state.mobileUI.composerOpen = true;
    state.mobileUI.activeSetting = "";
    render();
    return;
  }
  if (action === "close-composer") {
    state.mobileUI.composerOpen = false;
    state.mobileUI.activeSetting = "";
    render();
    return;
  }
  if (action === "toggle-setting") {
    state.mobileUI.activeSetting = state.mobileUI.activeSetting === payload.setting ? "" : payload.setting;
    render();
    return;
  }
  if (action === "set-size" && payload.size) {
    state.size = payload.size;
    render();
    return;
  }
  if (action === "set-quality" && payload.quality) {
    state.quality = payload.quality;
    render();
    return;
  }
  if (action === "select-edit-images") {
    app.querySelector("[data-role='edit-file-input']")?.click();
    return;
  }
  if (action === "remove-reference" && payload.fileId) {
    removeEditFile(payload.fileId);
    syncMobileModeFromFiles();
    render();
    return;
  }
  if (action === "generate") {
    syncMobileModeFromFiles();
    await triggerGenerationFromCurrentState();
    return;
  }
  if (action === "download-history" && payload.historyId) {
    await downloadHistoryItemById(payload.historyId).catch((error) => {
      state.apiError = error?.message || "原图下载失败，请稍后重试。";
      render();
    });
    return;
  }
  if (action === "copy-prompt") {
    const item = state.history.find((entry) => entry.id === payload.historyId);
    if (item?.prompt) {
      const copied = await navigator.clipboard?.writeText(item.prompt).then(() => true).catch(() => false);
      showMobileToast(copied ? "提示词已复制" : "复制失败，请稍后重试");
    }
    return;
  }
  if (action === "edit-again" && payload.historyId) {
    const item = state.history.find((entry) => entry.id === payload.historyId);
    if (!item) return;
    restoreFromHistory(item);
    state.mobileUI.subroute = "feed";
    state.mobileUI.composerOpen = true;
    state.mobileUI.activeSetting = "";
    render();
    return;
  }
  if (action === "toggle-history-manage") {
    if (state.mobileUI.batchActionText) return;
    state.mobileUI.managingHistory = !state.mobileUI.managingHistory;
    state.mobileUI.selectedHistoryIds = [];
    render();
    return;
  }
  if (action === "toggle-history-select" && payload.historyId) {
    if (state.mobileUI.selectedHistoryIds.includes(payload.historyId)) {
      state.mobileUI.selectedHistoryIds = state.mobileUI.selectedHistoryIds.filter((id) => id !== payload.historyId);
    } else {
      state.mobileUI.selectedHistoryIds = [...state.mobileUI.selectedHistoryIds, payload.historyId];
    }
    render();
    return;
  }
  if (action === "batch-download") {
    if (!state.mobileUI.selectedHistoryIds.length || state.mobileUI.batchActionText) return;
    state.mobileUI.batchActionText = `正在下载 ${state.mobileUI.selectedHistoryIds.length} 张作品`;
    render();
    try {
      if (state.mobileUI.selectedHistoryIds.length === 1) {
        await downloadHistoryItemById(state.mobileUI.selectedHistoryIds[0]);
        showMobileToast("作品已开始下载");
      } else {
        await downloadHistoryArchive(state.mobileUI.selectedHistoryIds);
        showMobileToast(`已打包 ${state.mobileUI.selectedHistoryIds.length} 张作品`);
      }
      state.apiError = "";
    } catch (error) {
      state.apiError = error?.message || "批量打包下载失败，请稍后重试。";
    } finally {
      state.mobileUI.batchActionText = "";
      render();
    }
    return;
  }
  if (action === "batch-delete") {
    if (!state.mobileUI.selectedHistoryIds.length || state.mobileUI.batchActionText) return;
    const confirmed = window.confirm(`确定删除已选择的 ${state.mobileUI.selectedHistoryIds.length} 张历史图片吗？`);
    if (!confirmed) return;
    let removedCount = 0;
    state.mobileUI.batchActionText = `正在删除 ${state.mobileUI.selectedHistoryIds.length} 张作品`;
    render();
    for (const historyId of [...state.mobileUI.selectedHistoryIds]) {
      // eslint-disable-next-line no-await-in-loop
      const removed = await removeHistoryItem(historyId, { skipConfirm: true, skipRender: true });
      if (removed) removedCount += 1;
    }
    state.mobileUI.selectedHistoryIds = [];
    state.mobileUI.managingHistory = false;
    state.mobileUI.batchActionText = "";
    render();
    showMobileToast(removedCount ? `已删除 ${removedCount} 张作品` : "没有删除任何作品");
  }
}

function bindLoginEvents() {
  app.querySelector("[data-role='login-form']").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitUserLogin(new FormData(event.currentTarget));
  });
  app.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleSharedAction(button.dataset.action)));
}

function bindAdminLoginEvents() {
  app.querySelector("[data-role='admin-login-form']").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.admin.loginLoading = true;
    state.admin.loginError = "";
    render();
    try {
      const result = await apiJson("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      state.admin.user = result.user;
      await loadAdminData();
      render();
      syncAdminRefresh();
    } catch (error) {
      state.admin.loginError = error.message;
    } finally {
      state.admin.loginLoading = false;
      render();
    }
  });
  app.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleSharedAction(button.dataset.action)));
}

function bindAdminEvents() {
  app.querySelectorAll("[data-admin-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.admin.view = button.dataset.adminView;
      state.admin.notice = "";
      state.admin.error = "";
      await loadAdminData();
      render();
      syncAdminRefresh();
    });
  });
  const createForm = app.querySelector("[data-role='create-user-form']");
  if (createForm) {
    createForm.addEventListener("submit", createAdminUser);
  }
  const transferForm = app.querySelector("[data-role='transfer-generations-form']");
  if (transferForm) {
    transferForm.addEventListener("submit", transferGenerations);
  }
  app.querySelectorAll("[data-role='update-user-form']").forEach((form) => {
    form.addEventListener("submit", updateAdminUser);
  });
  app.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      if (action === "admin-logout") {
        await apiJson("/api/admin/logout", { method: "POST" });
        state.admin.user = null;
        state.admin.ready = true;
        clearAdminRefresh();
        render();
        return;
      }
      if (action === "delete-user") {
        await deleteAdminUser(button);
        return;
      }
      handleSharedAction(action);
    });
  });
}

function handleAppAction(button, event) {
  const action = button.dataset.action;
  if (handleSharedAction(action)) return;
  if (action === "toggle-left" || action === "expand-left") {
    state.leftCollapsed = !state.leftCollapsed;
    render();
  }
  if (action === "clear-selection") {
    state.selectedId = null;
    state.prompt = "";
    render();
  }
  if (action === "close-backend-notice") {
    state.showBackendNotice = false;
    render();
  }
  if (action === "download-selected") {
    void downloadSelectedImage().catch((error) => {
      state.apiError = error?.message || "原图下载失败，请稍后重试。";
      render();
    });
  }
  if (action === "fullscreen") openFullscreen(button.src);
  if (action === "logout") logout();
  if (action === "select-edit-images") {
    app.querySelector("[data-role='edit-file-input']")?.click();
  }
  if (action === "preview-edit-file") {
    openFullscreen(button.dataset.previewSrc, button.dataset.previewName);
  }
  if (action === "remove-edit-file") {
    removeEditFile(button.dataset.fileId);
    render();
  }
  if (action === "clear-edit-files") {
    clearEditFiles();
    render();
  }
  if (action === "delete-history") {
    event?.stopPropagation();
    void deleteHistoryItem(button.dataset.historyId);
  }
}

function handleSharedAction(action) {
  if (action === "toggle-theme") {
    toggleTheme();
    render();
    return true;
  }
  if (action === "go-login") {
    routeTo("/login");
    return true;
  }
  if (action === "go-home") {
    routeTo("/");
    return true;
  }
  return false;
}

async function apiJson(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || "请求失败，请稍后重试。");
  return result;
}

function openFullscreen(src, alt = "") {
  const overlay = document.createElement("div");
  overlay.className = "fullscreen-overlay";
  overlay.innerHTML = `<img src="${src}" alt="${escapeHtml(alt)}" />`;
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

async function downloadSelectedImage() {
  const item = selectedItem();
  if (!item) return;
  await downloadHistoryItem(item);
}

async function downloadHistoryItemById(historyId) {
  const item = state.history.find((entry) => entry.id === historyId);
  if (!item) return;
  await downloadHistoryItem(item);
}

async function downloadHistoryItem(item) {
  if (!item?.downloadUrl) return;
  const safeTime = formatShanghaiTimestamp(item.createdAt);
  const response = await fetch(item.downloadUrl, { credentials: "same-origin" });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result?.error || "原图下载失败，请稍后重试。");
  }
  const blob = await response.blob();
  const extension = extensionFromMime(blob.type) || extensionFromImageUrl(item.downloadUrl) || "png";
  const filename = `panghu-image-${safeTime}.${extension}`;
  await saveBlobWithPicker(blob, filename, [{ description: "图片文件", accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"], "image/svg+xml": [".svg"] } }]);
}

async function downloadHistoryArchive(historyIds) {
  if (!historyIds.length) return;
  const response = await fetch("/api/images/history/download-archive", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: historyIds }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result?.error || "批量打包下载失败，请稍后重试。");
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/i);
  const filename = filenameMatch?.[1] || `panghu-images-${formatShanghaiTimestamp(new Date().toISOString())}.zip`;
  await saveBlobWithPicker(blob, filename, [{ description: "压缩包", accept: { "application/zip": [".zip"] } }]);
}

async function saveBlobWithPicker(blob, filename, fileTypes) {
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: fileTypes,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function extensionFromMime(mimeType) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("svg")) return "svg";
  return "";
}

function extensionFromImageUrl(imageUrl) {
  const clean = imageUrl.split("?")[0].split("#")[0];
  const match = clean.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() || "";
}

async function pollJob(jobId) {
  // 这里故意使用短轮询而不是长连接，便于穿过 Cloudflare 代理超时限制。
  const startedAt = Date.now();
  while (Date.now() - startedAt < pollTimeoutMs) {
    const result = await apiJson(`/api/jobs/${jobId}`);
    state.activeJobStatus = result.status;
    state.activeJobAttempts = result.attemptCount || 0;
    render();

    if (result.status === "done") return result.result;
    if (result.status === "failed") {
      throw new Error(result.error || "图片生成失败，请稍后重试。");
    }

    await new Promise((resolve) => window.setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("等待任务结果超时，请稍后到历史记录中查看是否已完成。");
}

async function generateImage() {
  normalizeCount();
  state.isGenerating = true;
  state.selectedId = null;
  state.apiError = "";
  state.generationStartedAt = Date.now();
  state.elapsedSeconds = 0;
  state.activeJobId = null;
  state.activeJobStatus = "queued";
  state.activeJobAttempts = 0;
  startGenerationTimer();
  render();

  const request = currentRequestShape();
  try {
    const backendReady = await checkBackendHealth();
    if (!backendReady) {
      state.showBackendNotice = true;
      throw new Error("后端服务未启动，请联系管理员。");
    }

    let enqueueResult;
    if (state.mode === "edit") {
      // 图生图走 multipart/form-data，参考图通过重复 image 字段上传。
      const body = new FormData();
      body.append("providerId", request.providerId);
      body.append("model", request.model);
      body.append("prompt", request.prompt);
      body.append("size", request.size);
      body.append("quality", request.quality);
      body.append("count", String(request.count));
      for (const file of state.editFiles) {
        body.append("image", file.file, file.name);
      }
      enqueueResult = await apiJson("/api/images/edits", {
        method: "POST",
        body,
      });
    } else {
      enqueueResult = await apiJson("/api/images/generations", {
        method: "POST",
        body: JSON.stringify(request),
      });
    }

    state.activeJobId = enqueueResult.jobId;
    state.activeJobStatus = enqueueResult.status;
    if (state.currentUser && Number.isInteger(enqueueResult.quotaRemaining)) {
      state.currentUser.quotaRemaining = enqueueResult.quotaRemaining;
    }
    render();

    const result = await pollJob(enqueueResult.jobId);
    const nextItem = buildHistoryItem(result, request);
    upsertHistoryItem(nextItem);
    if (state.mode === "edit") {
      clearEditFiles();
    }
  } catch (error) {
    state.apiError = state.showBackendNotice ? "" : error?.message || "图片生成失败，请稍后重试。";
    if (state.apiError.includes("登录")) state.currentUser = null;
    if (state.currentUser) {
      const me = await apiJson("/api/auth/me").catch(() => null);
      if (me?.user) state.currentUser = me.user;
    }
  } finally {
    stopGenerationTimer();
    state.isGenerating = false;
    state.generationStartedAt = null;
    state.activeJobId = null;
    state.activeJobStatus = "";
    state.activeJobAttempts = 0;
    render();
  }
}

async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3000);
    const response = await fetch("/api/health", { signal: controller.signal, cache: "no-store" });
    window.clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

function startGenerationTimer() {
  stopGenerationTimer();
  generationTimer = window.setInterval(() => {
    if (!state.generationStartedAt) return;
    state.elapsedSeconds = Math.floor((Date.now() - state.generationStartedAt) / 1000);
    render();
  }, 1000);
}

function stopGenerationTimer() {
  if (generationTimer) {
    window.clearInterval(generationTimer);
    generationTimer = null;
  }
}

function clearAdminRefresh() {
  if (adminRefreshTimer) {
    window.clearInterval(adminRefreshTimer);
    adminRefreshTimer = null;
  }
}

function syncAdminRefresh() {
  clearAdminRefresh();
  if (state.route !== "admin" || !state.admin.user) return;
  if (!["dashboard", "logs"].includes(state.admin.view)) return;
  adminRefreshTimer = window.setInterval(() => {
    loadAdminData().then(() => render()).catch(() => null);
  }, 5000);
}

async function logout() {
  await apiJson("/api/auth/logout", { method: "POST" }).catch(() => null);
  state.currentUser = null;
  state.history = [];
  state.selectedId = null;
  state.apiError = "";
  clearEditFiles();
  state.mobileUI.toast = "";
  state.mobileUI.batchActionText = "";
  state.mobileUI.loginOpen = false;
  state.mobileUI.composerOpen = false;
  state.mobileUI.activeSetting = "";
  state.mobileUI.subroute = "feed";
  resetMobileHistorySelection();
  render();
}

async function deleteHistoryItem(historyId) {
  await removeHistoryItem(historyId);
}

async function removeHistoryItem(historyId, { skipConfirm = false, skipRender = false } = {}) {
  const item = state.history.find((entry) => entry.id === historyId);
  if (!item) return false;
  if (!skipConfirm) {
    const confirmed = window.confirm("确定删除这张历史图片吗？\n\n删除后会同时移除服务器上的本地缓存图片。");
    if (!confirmed) return false;
  }
  try {
    await apiJson(`/api/images/history/${historyId}`, { method: "DELETE" });
    state.history = state.history.filter((entry) => entry.id !== historyId);
    if (state.selectedId === historyId) {
      state.selectedId = state.history[0]?.id ?? null;
    }
    state.mobileUI.selectedHistoryIds = state.mobileUI.selectedHistoryIds.filter((id) => id !== historyId);
    state.apiError = "";
  } catch (error) {
    state.apiError = error.message;
    if (!skipRender) render();
    return false;
  }
  if (!state.history.length) {
    state.mobileUI.subroute = "feed";
  }
  if (!skipRender) render();
  return true;
}

async function loadSession() {
  try {
    const result = await apiJson("/api/auth/me");
    state.currentUser = result.role === "user" ? result.user : null;
    if (state.currentUser) await loadStoredHistory();
  } catch {
    state.currentUser = null;
  } finally {
    state.authReady = true;
  }
}

async function loadStoredHistory() {
  if (!state.currentUser) return;
  try {
    const result = await apiJson("/api/images/history");
    const stored = Array.isArray(result?.data) ? result.data : [];
    state.history = stored;
    state.selectedId = state.history[0]?.id ?? null;
  } catch {
    state.history = [];
  }
}

async function loadAdminSession() {
  try {
    const result = await apiJson("/api/admin/me");
    state.admin.user = result.user;
    state.admin.ready = true;
    await loadAdminData();
  } catch {
    state.admin.user = null;
    state.admin.ready = true;
  } finally {
    render();
    syncAdminRefresh();
  }
}

async function loadAdminData() {
  state.admin.error = "";
  if (!state.admin.user) return;
  try {
    // 后台不同页签走各自的数据装载，避免一次性把不需要的数据都拉回来。
    if (state.admin.view === "dashboard") {
      state.admin.dashboard = await apiJson("/api/admin/dashboard");
    }
    if (state.admin.view === "users") {
      const result = await apiJson("/api/admin/users");
      state.admin.users = result.data || [];
    }
    if (state.admin.view === "logs") {
      const result = await apiJson(`/api/admin/generation-logs?page=${state.admin.logPage}&pageSize=50`);
      state.admin.logs = result.data || [];
      state.admin.logTotal = result.total || 0;
    }
  } catch (error) {
    state.admin.error = error.message;
  }
}

async function createAdminUser(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await apiJson("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        displayName: form.get("displayName"),
        password: form.get("password"),
        quotaRemaining: Number(form.get("quotaRemaining") || 10),
      }),
    });
    state.admin.form = { username: "", displayName: "", password: "", quotaRemaining: 10 };
    state.admin.notice = "用户已添加。";
    await loadAdminData();
  } catch (error) {
    state.admin.error = error.message;
  }
  render();
}

async function updateAdminUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const body = {
    displayName: data.get("displayName"),
    quotaRemaining: Number(data.get("quotaRemaining") || 0),
    isEnabled: data.get("isEnabled") === "on",
  };
  const password = String(data.get("password") || "");
  if (password) body.password = password;
  try {
    await apiJson(`/api/admin/users/${form.dataset.userId}`, { method: "PATCH", body: JSON.stringify(body) });
    state.admin.notice = "用户已更新。";
    await loadAdminData();
  } catch (error) {
    state.admin.error = error.message;
  }
  render();
}

async function deleteAdminUser(button) {
  const username = button.dataset.username;
  const confirmed = window.confirm(`确定删除用户 ${username} 吗？\n\n点击“确定”会继续询问是否同时删除该用户历史图片文件。`);
  if (!confirmed) return;
  const deleteImages = window.confirm(`是否同时删除 ${username} 的本地历史图片文件？\n\n选择“取消”则只删除用户和数据库历史记录，图片文件会保留在本地目录中。`);
  try {
    await apiJson(`/api/admin/users/${button.dataset.userId}`, {
      method: "DELETE",
      body: JSON.stringify({ deleteImages }),
    });
    state.admin.notice = deleteImages ? "用户已删除，历史图片文件也已删除。" : "用户已删除，历史图片文件已保留。";
    await loadAdminData();
  } catch (error) {
    state.admin.error = error.message;
  }
  render();
}

async function transferGenerations(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const fromUserId = Number(form.get("fromUserId"));
  const toUserId = Number(form.get("toUserId"));
  if (!fromUserId || !toUserId) {
    state.admin.error = "请选择来源用户和目标用户。";
    state.admin.notice = "";
    render();
    return;
  }
  if (fromUserId === toUserId) {
    state.admin.error = "同一个用户无法转移图片，请选择不同的目标用户。";
    state.admin.notice = "";
    render();
    return;
  }
  try {
    const result = await apiJson("/api/admin/generations/transfer", {
      method: "POST",
      body: JSON.stringify({ fromUserId, toUserId }),
    });
    state.admin.notice = `已转移 ${result.transferred || 0} 张历史图片。`;
    await loadAdminData();
  } catch (error) {
    state.admin.error = error.message;
  }
  render();
}

render();
loadSession().finally(() => {
  if (state.route === "admin") loadAdminSession();
  else render();
});
