import {
  BarChart3,
  Check,
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
  Sparkles,
  Sun,
  UserPlus,
  Users,
  Wand2,
  X,
} from "lucide";
import "./styles.css";
import { getModelsForProvider, getParamOptions, normalizeModelState } from "./config.js";
import { getTheme, toggleTheme } from "./theme.js";
import { appConfig } from "./appConfig.js";

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
  isGenerating: false,
  generationStartedAt: null,
  elapsedSeconds: 0,
  leftCollapsed: false,
  showEditNotice: false,
  showBackendNotice: false,
  apiError: "",
  authReady: false,
  currentUser: null,
  loginError: "",
  loginLoading: false,
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
    transfer: {
      fromUserId: "",
      toUserId: "",
    },
  },
};

const app = document.querySelector("#app");
let generationTimer = null;

const icons = {
  BarChart3,
  Check,
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
  Sparkles,
  Sun,
  UserPlus,
  Users,
  Wand2,
  X,
};

function routeTo(path) {
  window.history.pushState({}, "", path);
  state.route = path.startsWith("/admin") ? "admin" : path.startsWith("/login") ? "login" : "app";
  render();
  if (state.route === "admin") loadAdminSession();
}

window.addEventListener("popstate", () => {
  state.route = window.location.pathname.startsWith("/admin") ? "admin" : window.location.pathname.startsWith("/login") ? "login" : "app";
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

function generationTip() {
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
  return Boolean(state.currentUser) && state.currentUser.quotaRemaining > 0 && !state.isGenerating && state.mode !== "edit";
}

function render() {
  if (state.route === "login") {
    renderLogin();
    return;
  }
  if (state.route === "admin") {
    renderAdmin();
    return;
  }
  renderApp();
}

function applyIcons() {
  createIcons({ icons });
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
  const sendTitle = !user ? "请先登录" : user.quotaRemaining <= 0 ? "可用次数不足" : "生成图片";

  app.innerHTML = `
    <main class="shell ${state.leftCollapsed ? "is-left-collapsed" : ""}">
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
                    <em>已等待 ${formatElapsed(state.elapsedSeconds)}，通常需要 1-5 分钟</em>
                  </div>
                `
                : item
                  ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.prompt)}" data-action="fullscreen" />`
                  : `<div class="empty-state"><i data-lucide="image-plus"></i><strong>${user ? "暂无图片" : "请先登录"}</strong><span>${user ? "输入提示词，创造属于你的图片" : "登录后即可生成图片并查看个人历史"}</span></div>`
            }
          </div>
        </div>

        <form class="prompt-box" data-role="prompt-form">
          <textarea
            data-field="prompt"
            rows="3"
            ${state.mode === "edit" ? "disabled" : ""}
            placeholder="${user ? "输入你的图片描述，文本绘制用中文双引号 “” 包裹" : "请先登录后输入提示词"}"
          >${escapeHtml(state.prompt)}</textarea>
          <div class="prompt-actions">
            <button type="submit" class="send-button" ${sendDisabled ? "disabled" : ""} title="${sendTitle}" aria-label="${sendTitle}">
              <i data-lucide="send"></i>
            </button>
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
                <button class="thumb ${historyItem.id === state.selectedId ? "active" : ""}" data-history-id="${historyItem.id}" title="${escapeHtml(historyItem.prompt)}">
                  <img src="${escapeHtml(historyItem.imageUrl)}" alt="${escapeHtml(historyItem.prompt)}" />
                  <span>${formatTime(historyItem.createdAt)}</span>
                </button>
              `,
                    )
                    .join("")
                : `<div class="history-empty">暂未有历史图片</div>`
          }
        </div>
      </aside>

      ${noticeModal("showEditNotice", "图生图即将到来", "图片编辑功能会在后续版本支持。当前先回到文生图模式继续生成新图片。", "close-edit-notice")}
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
          <div class="notice-icon"><i data-lucide="sparkles"></i></div>
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
        <div class="table-row table-head"><span>时间</span><span>用户</span><span>模型</span><span>状态</span><span>提示词</span></div>
        ${
          recent.length
            ? recent
                .map(
                  (log) =>
                    `<div class="table-row"><span>${formatDateTime(log.created_at)}</span><span>${escapeHtml(log.display_name || log.username || "-")}</span><span>${escapeHtml(log.model || "-")}</span><span>${escapeHtml(log.status)}</span><span>${escapeHtml(log.prompt || "-")}</span></div>`,
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
        <div class="table-row logs-row table-head"><span>时间</span><span>用户</span><span>模型</span><span>参数</span><span>状态</span><span>提示词</span></div>
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
              <span title="${escapeHtml(log.error_message || "")}">${escapeHtml(log.status)}</span>
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
      if (button.dataset.mode === "edit") state.showEditNotice = true;
      else state.mode = "generate";
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

  app.querySelector("[data-role='prompt-form']").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.currentUser) {
      state.apiError = "请先登录后再生成图片。";
      render();
      return;
    }
    if (state.currentUser.quotaRemaining <= 0) {
      state.apiError = "可用生图次数不足，请联系管理员增加次数。";
      render();
      return;
    }
    const textarea = app.querySelector("[data-field='prompt']");
    state.prompt = textarea.value.trim();
    if (!state.prompt) {
      textarea.focus();
      textarea.classList.add("is-invalid");
      window.setTimeout(() => textarea.classList.remove("is-invalid"), 900);
      return;
    }
    await generateImage();
  });

  app.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAppAction(button));
  });
}

function bindLoginEvents() {
  app.querySelector("[data-role='login-form']").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.loginLoading = true;
    state.loginError = "";
    render();
    try {
      const result = await apiJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      state.currentUser = result.user;
      state.history = [];
      state.selectedId = null;
      await loadStoredHistory();
      routeTo("/");
    } catch (error) {
      state.loginError = error.message;
    } finally {
      state.loginLoading = false;
      render();
    }
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

function handleAppAction(button) {
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
  if (action === "close-edit-notice") {
    state.showEditNotice = false;
    state.mode = "generate";
    render();
  }
  if (action === "close-backend-notice") {
    state.showBackendNotice = false;
    render();
  }
  if (action === "download-selected") downloadSelectedImage();
  if (action === "fullscreen") openFullscreen(button.src);
  if (action === "logout") logout();
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
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || "请求失败，请稍后重试。");
  return result;
}

function openFullscreen(src) {
  const overlay = document.createElement("div");
  overlay.className = "fullscreen-overlay";
  overlay.innerHTML = `<img src="${src}" />`;
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

async function downloadSelectedImage() {
  const item = selectedItem();
  if (!item?.imageUrl) return;

  const safeTime = formatShanghaiTimestamp(item.createdAt);
  const sourceUrl = item.imageUrl.startsWith("http") ? `/api/images/proxy?url=${encodeURIComponent(item.imageUrl)}` : item.imageUrl;
  const response = await fetch(sourceUrl);
  const blob = await response.blob();
  const extension = extensionFromMime(blob.type) || extensionFromImageUrl(item.imageUrl) || "png";
  const filename = `panghu-image-${safeTime}.${extension}`;

  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "图片文件", accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"], "image/svg+xml": [".svg"] } }],
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

async function generateImage() {
  normalizeCount();
  state.isGenerating = true;
  state.selectedId = null;
  state.apiError = "";
  state.generationStartedAt = Date.now();
  state.elapsedSeconds = 0;
  startGenerationTimer();
  render();

  const request = currentRequestShape();
  try {
    const backendReady = await checkBackendHealth();
    if (!backendReady) {
      state.showBackendNotice = true;
      throw new Error("后端服务未启动，请联系管理员。");
    }

    const result = await apiJson("/api/images/generations", {
      method: "POST",
      body: JSON.stringify(request),
    });

    const nextItem = {
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
      imageUrl: result.imageUrl,
      status: "done",
      usage: result.usage || null,
    };

    state.history = [nextItem, ...state.history];
    state.selectedId = nextItem.id;
    if (state.currentUser && Number.isInteger(result.quotaRemaining)) {
      state.currentUser.quotaRemaining = result.quotaRemaining;
    }
  } catch (error) {
    state.apiError = state.showBackendNotice ? "" : error?.message || "图片生成失败，请稍后重试。";
    if (state.apiError.includes("登录")) state.currentUser = null;
  } finally {
    stopGenerationTimer();
    state.isGenerating = false;
    state.generationStartedAt = null;
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

async function logout() {
  await apiJson("/api/auth/logout", { method: "POST" }).catch(() => null);
  state.currentUser = null;
  state.history = [];
  state.selectedId = null;
  state.apiError = "";
  render();
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
  }
}

async function loadAdminData() {
  state.admin.error = "";
  if (!state.admin.user) return;
  try {
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
