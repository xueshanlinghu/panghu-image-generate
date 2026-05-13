import { createIcons, Check, ChevronDown, Download, History, ImagePlus, Moon, PanelLeftClose, PanelLeftOpen, Send, SlidersHorizontal, Sparkles, Sun, Wand2, X } from "lucide";
import "./styles.css";
import { getModelsForProvider, getParamOptions, normalizeModelState } from "./config.js";
import { getTheme, toggleTheme } from "./theme.js";
import { appConfig, currentUserId } from "./appConfig.js";

const state = {
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
};

const app = document.querySelector("#app");
let generationTimer = null;

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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function currentRequestShape() {
  normalizeCount();
  return {
    userId: currentUserId,
    providerId: state.providerId,
    model: state.model,
    prompt: state.prompt.trim(),
    size: state.size,
    quality: state.quality,
    count: Number(state.count),
    mode: state.mode,
  };
}

function normalizeCount() {
  state.count = 1;
}

function render() {
  normalizeModelState(state);
  const item = selectedItem();
  const theme = getTheme();
  const providerModels = getModelsForProvider(state.providerId);
  const sizeOptions = getParamOptions(state.providerId, state.model, "size");
  const qualityOptions = getParamOptions(state.providerId, state.model, "quality");
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
          <button class="theme-button" data-action="toggle-theme" aria-label="切换主题">
            <i data-lucide="${theme === "dark" ? "sun" : "moon"}"></i>
            <span>${theme === "dark" ? "亮色" : "暗色"}</span>
          </button>
        </header>

        <div class="canvas-wrap">
          <div class="canvas-stage ${state.isGenerating ? "is-loading" : ""}" style="${previewStyle(item)}">
            ${
              state.isGenerating
                ? `
                  <div class="loading-card">
                    <div class="generation-orbit" aria-hidden="true">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                    <strong>正在生成，请耐心等待</strong>
                    <span>${generationTip()}</span>
                    <em>已等待 ${formatElapsed(state.elapsedSeconds)}，通常需要 1-5 分钟</em>
                  </div>
                `
                : item
                  ? `
                    <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.prompt)}" data-action="fullscreen" />
                  `
                  : `<div class="empty-state"><i data-lucide="image-plus"></i><strong>暂无图片</strong><span>输入提示词，创造属于你的图片</span></div>`
            }
          </div>
        </div>

        <form class="prompt-box" data-role="prompt-form">
          <textarea
            data-field="prompt"
            rows="3"
            ${state.mode === "edit" ? "disabled" : ""}
            placeholder="输入你的图片描述，文本绘制用中文双引号 “” 包裹"
          >${escapeHtml(state.prompt)}</textarea>
          <div class="prompt-actions">
            <button type="submit" class="send-button" ${state.isGenerating || state.mode === "edit" ? "disabled" : ""} aria-label="生成图片">
              <i data-lucide="send"></i>
            </button>
          </div>
        </form>
        ${state.apiError ? `<div class="error-toast" role="alert">${escapeHtml(state.apiError)}</div>` : ""}
      </section>

      <aside class="history-panel" aria-label="历史图片">
        <div class="history-head">
          <span><i data-lucide="history"></i> 历史</span>
          <button class="thumb add" data-action="clear-selection" aria-label="新建图片">
            <i data-lucide="image-plus"></i>
          </button>
        </div>
        <div class="history-list">
          ${
            state.history.length
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

      ${
        state.showEditNotice
          ? `
            <div class="modal-backdrop" role="presentation">
              <section class="notice-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-notice-title">
                <button class="icon-button ghost dialog-close" data-action="close-edit-notice" aria-label="关闭提示">
                  <i data-lucide="x"></i>
                </button>
                <div class="notice-icon">
                  <i data-lucide="sparkles"></i>
                </div>
                <h2 id="edit-notice-title">图生图即将到来</h2>
                <p>图片编辑功能会在后续版本支持。当前先回到文生图模式继续生成新图片。</p>
                <button class="primary-action" data-action="close-edit-notice" autofocus>
                  <i data-lucide="check"></i>
                  <span>OK</span>
                </button>
              </section>
            </div>
          `
          : ""
      }
      ${
        state.showBackendNotice
          ? `
            <div class="modal-backdrop" role="presentation">
              <section class="notice-dialog" role="dialog" aria-modal="true" aria-labelledby="backend-notice-title">
                <button class="icon-button ghost dialog-close" data-action="close-backend-notice" aria-label="关闭提示">
                  <i data-lucide="x"></i>
                </button>
                <div class="notice-icon">
                  <i data-lucide="sparkles"></i>
                </div>
                <h2 id="backend-notice-title">后端服务未启动</h2>
                <p>当前无法连接生图服务，请联系管理员或先启动后端服务后再生成图片。</p>
                <button class="primary-action" data-action="close-backend-notice" autofocus>
                  <i data-lucide="check"></i>
                  <span>OK</span>
                </button>
              </section>
            </div>
          `
          : ""
      }
    </main>
  `;

  bindEvents();
  createIcons({
    icons: {
      Check,
      ChevronDown,
      History,
      ImagePlus,
      Download,
      Moon,
      PanelLeftClose,
      PanelLeftOpen,
      Send,
      SlidersHorizontal,
      Sparkles,
      Sun,
      Wand2,
      X,
    },
  });
}

function bindEvents() {
  app.querySelectorAll("[data-field]").forEach((control) => {
    control.addEventListener("input", (event) => {
      const field = event.currentTarget.dataset.field;
      if (field === "count") {
        normalizeCount();
        event.currentTarget.value = "1";
      } else {
        state[field] = event.currentTarget.value;
        if (field === "providerId" || field === "model") {
          normalizeModelState(state);
        }
      }
      if (field !== "prompt") render();
    });

    control.addEventListener("blur", (event) => {
      const field = event.currentTarget.dataset.field;
      if (field === "count") {
        normalizeCount();
        event.currentTarget.value = "1";
        render();
      }
    });
  });

  app.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.mode === "edit") {
        state.showEditNotice = true;
      } else {
        state.mode = "generate";
      }
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
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "toggle-theme") {
        toggleTheme();
        render();
      }
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
      if (action === "download-selected") {
        downloadSelectedImage();
      }
      if (action === "fullscreen") {
        openFullscreen(button.src);
      }
    });
  });
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
  const sourceUrl = item.imageUrl.startsWith("http")
    ? `/api/images/proxy?url=${encodeURIComponent(item.imageUrl)}`
    : item.imageUrl;
  const response = await fetch(sourceUrl);
  const blob = await response.blob();
  const extension = extensionFromMime(blob.type) || extensionFromImageUrl(item.imageUrl) || "png";
  const filename = `panghu-image-${safeTime}.${extension}`;

  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "图片文件",
            accept: {
              "image/png": [".png"],
              "image/jpeg": [".jpg", ".jpeg"],
              "image/webp": [".webp"],
              "image/svg+xml": [".svg"],
            },
          },
        ],
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

    const response = await fetch("/api/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || "图片生成失败，请稍后重试。");
    }

    const nextItem = {
      id: result.id || `hist-${Date.now()}`,
      userId: result.userId || currentUserId,
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
  } catch (error) {
    state.apiError = state.showBackendNotice ? "" : error?.message || "图片生成失败，请稍后重试。";
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
    const response = await fetch("/api/health", {
      signal: controller.signal,
      cache: "no-store",
    });
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

async function loadStoredHistory() {
  try {
    const response = await fetch(`/api/images/history?userId=${encodeURIComponent(currentUserId)}`);
    if (!response.ok) return;
    const result = await response.json();
    const stored = Array.isArray(result?.data) ? result.data : [];
    if (!stored.length) return;
    const existingIds = new Set(state.history.map((item) => item.id));
    state.history = [...stored.filter((item) => !existingIds.has(item.id)), ...state.history];
    state.selectedId = state.history[0]?.id ?? state.selectedId;
  } catch {
    // The static UI can still run when the local API server is not available.
  }
}

render();
loadStoredHistory().finally(render);
