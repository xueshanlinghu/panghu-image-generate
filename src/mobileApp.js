import { appConfig } from "./appConfig.js";
import { getModelsForProvider, getParamOptions, getProvider } from "./config.js";
import { getTheme } from "./theme.js";
import { getMobileModelIcon, getMobileProviderIcon, getMobileQualityPreset, getMobileSizePreset } from "./mobileIcons.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function badgeText(mode) {
  return mode === "edit" ? "图生图" : "文生图";
}

function truncatePrompt(prompt, maxLength = 32) {
  const text = String(prompt || "").trim();
  if (!text) return "未命名作品";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function optionArtwork({ image = "", glyph = "", alt = "" }) {
  return `
    <span class="mobile-option-artwork ${image ? "has-image" : "has-glyph"}">
      ${image ? `<img class="mobile-option-artwork-image" src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" />` : `<span class="mobile-option-artwork-glyph">${escapeHtml(glyph)}</span>`}
    </span>
  `;
}

function settingTile({ active, setting, label, image = "", glyph = "" }) {
  return `
    <button class="mobile-setting-tile ${active ? "active" : ""}" type="button" data-mobile-action="toggle-setting" data-setting="${escapeHtml(setting)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      ${optionArtwork({ image, glyph, alt: label })}
    </button>
  `;
}

function settingOptionCard({ active, action, valueKey, value, label, detail, image = "", glyph = "" }) {
  return `
    <button
      class="mobile-setting-option-card ${active ? "active" : ""}"
      type="button"
      data-mobile-action="${escapeHtml(action)}"
      data-${escapeHtml(valueKey)}="${escapeHtml(value)}"
      aria-label="${escapeHtml(`${label} ${detail}`.trim())}"
      title="${escapeHtml(`${label} ${detail}`.trim())}"
    >
      ${optionArtwork({ image, glyph, alt: label })}
    </button>
  `;
}

function providerOption(item, active) {
  return settingOptionCard({
    active,
    action: "set-provider",
    valueKey: "provider-id",
    value: item.id,
    label: item.name,
    detail: item.badge || item.name,
    image: getMobileProviderIcon(item.id),
  });
}

function modelOption(item, active) {
  return settingOptionCard({
    active,
    action: "set-model",
    valueKey: "model",
    value: item.id,
    label: item.name,
    detail: item.id,
    image: getMobileModelIcon(item.id),
  });
}

function sizeOption(item, active) {
  const preset = getMobileSizePreset(item.id);
  return settingOptionCard({
    active,
    action: "set-size",
    valueKey: "size",
    value: item.id,
    label: preset.title,
    detail: preset.detail || item.name,
    image: preset.cardImage || preset.icon,
  });
}

function qualityOption(item, active) {
  const preset = getMobileQualityPreset(item.id);
  return settingOptionCard({
    active,
    action: "set-quality",
    valueKey: "quality",
    value: item.id,
    label: preset.title,
    detail: preset.detail,
    image: preset.cardImage || "",
    glyph: preset.glyph || preset.badge,
  });
}

function emptyState({ title, description, actionLabel = "", action = "", className = "" }) {
  return `
    <section class="mobile-empty-card ${escapeHtml(className)}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
      ${
        actionLabel && action
          ? `<button class="mobile-pill-button primary mobile-empty-action" type="button" data-mobile-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>`
          : ""
      }
    </section>
  `;
}

function feedCard(item, { selectedId }) {
  const sizePreset = getMobileSizePreset(item.size);
  const qualityPreset = getMobileQualityPreset(item.quality);
  const preview = item.thumbnailUrl || item.previewUrl || item.imageUrl;
  const fullPrompt = item.prompt || "未命名作品";

  return `
    <article class="mobile-feed-card ${selectedId === item.id ? "is-active" : ""}">
      <div class="mobile-feed-head">
        <strong title="${escapeHtml(fullPrompt)}">${escapeHtml(truncatePrompt(fullPrompt))}</strong>
      </div>
      <button class="mobile-feed-image" data-mobile-action="open-detail" data-history-id="${item.id}" aria-label="查看作品">
        ${preview ? `<img src="${escapeHtml(preview)}" alt="${escapeHtml(item.prompt || "作品预览")}" />` : `<span class="mobile-missing-image">图片缺失</span>`}
      </button>
      <div class="mobile-feed-actions">
        <button class="mobile-pill-button" data-mobile-action="edit-again" data-history-id="${item.id}">沿用参数</button>
        <button class="mobile-pill-button primary" data-mobile-action="download-history" data-history-id="${item.id}">下载原图</button>
        <div class="mobile-badge-row mobile-feed-meta-row">
          <span class="mobile-badge">${escapeHtml(badgeText(item.mode))}</span>
          <span class="mobile-badge">${escapeHtml(sizePreset.badge)}</span>
          <span class="mobile-badge">${escapeHtml(qualityPreset.badge)}</span>
        </div>
      </div>
    </article>
  `;
}

function historyGrid(items, { mobileUI }) {
  return `
    <div class="mobile-history-grid">
      ${items
        .map((item) => {
          const active = mobileUI.selectedHistoryIds.includes(item.id);
          const preview = item.thumbnailUrl || item.previewUrl || item.imageUrl;
          return `
            <button
              class="mobile-history-tile"
              data-mobile-action="${mobileUI.managingHistory ? "toggle-history-select" : "open-detail"}"
              data-history-id="${item.id}"
              aria-label="${mobileUI.managingHistory ? "选择作品" : "查看作品"}"
            >
              ${preview ? `<img src="${escapeHtml(preview)}" alt="${escapeHtml(item.prompt || "作品预览")}" />` : `<span class="mobile-missing-image">无图</span>`}
              ${mobileUI.managingHistory ? `<span class="mobile-history-check ${active ? "active" : ""}">${active ? "✓" : ""}</span>` : ""}
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function detailPanel(item, { formatDateTime }) {
  if (!item) {
    return emptyState({ title: "未找到作品", description: "请返回作品列表后重新选择。" });
  }

  const sizePreset = getMobileSizePreset(item.size);
  const qualityPreset = getMobileQualityPreset(item.quality);
  const displayTime = item.createdAt ? formatDateTime(item.createdAt) : "";

  return `
    <section class="mobile-detail-card">
      <div class="mobile-detail-image">
        ${
          item.previewUrl || item.imageUrl
            ? `<img src="${escapeHtml(item.previewUrl || item.imageUrl)}" alt="${escapeHtml(item.prompt || "作品预览")}" />`
            : `<span class="mobile-missing-image">图片缺失</span>`
        }
      </div>
      <div class="mobile-detail-copy">
        <strong>${escapeHtml(item.prompt || "未命名作品")}</strong>
        <p>${escapeHtml(badgeText(item.mode))} · ${escapeHtml(sizePreset.title)} · ${escapeHtml(qualityPreset.title)}</p>
        <span>${escapeHtml(displayTime)}</span>
      </div>
      <div class="mobile-detail-actions">
        <button class="mobile-pill-button primary" data-mobile-action="download-history" data-history-id="${item.id}">下载原图</button>
        <button class="mobile-pill-button" data-mobile-action="edit-again" data-history-id="${item.id}">沿用参数</button>
        <button class="mobile-pill-button" data-mobile-action="copy-prompt" data-history-id="${item.id}">复制提示词</button>
      </div>
    </section>
  `;
}

function composerPanel({ state, providerOptions, providerLabel, modelOptions, modelLabel, sizeOptions, qualityOptions }) {
  const open = state.mobileUI.composerOpen || state.isGenerating;
  const promptCount = state.prompt.trim().length;
  const currentSize = getMobileSizePreset(state.size);
  const currentQuality = getMobileQualityPreset(state.quality);
  const sendDisabled = !promptCount || state.isGenerating;
  const sendTitle = state.isGenerating ? "生成中" : promptCount ? "生成图片" : "请输入提示词";

  return `
    <div class="mobile-layer ${open ? "active" : ""}">
      <div class="mobile-backdrop ${open ? "active" : ""}" data-mobile-action="close-composer"></div>
      <section class="mobile-composer-sheet ${open ? "active" : ""}">
        <button class="mobile-sheet-handle" type="button" data-mobile-action="close-composer" aria-label="收起生成设置"></button>

        <div class="mobile-sheet-block">
          <div class="mobile-title-row">
            <strong>参考图</strong>
            <span>${state.editFiles.length ? `已添加 ${state.editFiles.length} 张` : "最多 6 张"}</span>
          </div>
          <div class="mobile-reference-grid">
            ${state.editFiles
              .map(
                (file) => `
                  <div class="mobile-reference-item">
                    <img src="${escapeHtml(file.previewUrl)}" alt="${escapeHtml(file.name)}" />
                    <button type="button" class="mobile-reference-remove" data-mobile-action="remove-reference" data-file-id="${file.id}" aria-label="删除参考图">×</button>
                  </div>
                `,
              )
              .join("")}
            <button class="mobile-reference-add" type="button" data-mobile-action="select-edit-images" aria-label="添加参考图">+</button>
          </div>
        </div>

        <div class="mobile-sheet-block">
          <div class="mobile-title-row">
            <strong>提示词</strong>
            <span data-role="mobile-prompt-count">${promptCount}/32000</span>
          </div>
          <textarea class="mobile-textarea" data-mobile-field="prompt" placeholder="描述你想生成的画面">${escapeHtml(state.prompt)}</textarea>
        </div>

        <div class="mobile-tool-row">
          ${settingTile({
            active: state.mobileUI.activeSetting === "provider",
            setting: "provider",
            label: "提供商",
            image: getMobileProviderIcon(state.providerId),
          })}
          ${settingTile({
            active: state.mobileUI.activeSetting === "model",
            setting: "model",
            label: "模型",
            image: getMobileModelIcon(state.model),
          })}
          ${settingTile({
            active: state.mobileUI.activeSetting === "size",
            setting: "size",
            label: "尺寸",
            image: currentSize.cardImage || currentSize.icon,
          })}
          ${settingTile({
            active: state.mobileUI.activeSetting === "quality",
            setting: "quality",
            label: "清晰度",
            image: currentQuality.cardImage || "",
            glyph: currentQuality.glyph || currentQuality.badge,
          })}
          <button class="mobile-send-tile" type="button" data-role="mobile-send-button" data-mobile-action="generate" ${sendDisabled ? "disabled" : ""} aria-label="${escapeHtml(sendTitle)}" title="${escapeHtml(sendTitle)}">
            <i data-lucide="send"></i>
          </button>
        </div>

        <div class="mobile-setting-panel ${state.mobileUI.activeSetting === "provider" ? "active" : ""}">
          <div class="mobile-title-row">
            <strong>提供商</strong>
            <span>选择当前生图服务</span>
          </div>
          <div class="mobile-setting-card-grid">
            ${providerOptions.map((item) => providerOption(item, state.providerId === item.id)).join("")}
          </div>
        </div>

        <div class="mobile-setting-panel ${state.mobileUI.activeSetting === "model" ? "active" : ""}">
          <div class="mobile-title-row">
            <strong>模型</strong>
            <span>选择本次使用的模型</span>
          </div>
          <div class="mobile-setting-card-grid">
            ${modelOptions.map((item) => modelOption(item, state.model === item.id)).join("")}
          </div>
        </div>

        <div class="mobile-setting-panel ${state.mobileUI.activeSetting === "size" ? "active" : ""}">
          <div class="mobile-title-row">
            <strong>图片尺寸</strong>
            <span>选择更适合当前画面的比例</span>
          </div>
          <div class="mobile-setting-card-grid">
            ${sizeOptions.map((item) => sizeOption(item, state.size === item.id)).join("")}
          </div>
        </div>

        <div class="mobile-setting-panel ${state.mobileUI.activeSetting === "quality" ? "active" : ""}">
          <div class="mobile-title-row">
            <strong>图片清晰度</strong>
            <span>更高质量通常会更慢</span>
          </div>
          <div class="mobile-setting-card-grid">
            ${qualityOptions.map((item) => qualityOption(item, state.quality === item.id)).join("")}
          </div>
        </div>
      </section>
    </div>
  `;
}

function mobileToolbar(state) {
  const user = state.currentUser;
  const theme = getTheme();

  return `
    <header class="mobile-toolbar">
      <div class="mobile-brand">
        <div class="mobile-brand-mark">胖</div>
        <div class="mobile-brand-copy">
          <strong>胖狐生图</strong>
          <span>${user ? "生成图片" : "登录后生成图片"}</span>
        </div>
      </div>
      <div class="mobile-toolbar-actions">
        <span class="mobile-count-chip">${user ? `剩余 ${Number(user.quotaRemaining)} 次` : "未登录"}</span>
        <button class="mobile-icon-button" type="button" data-mobile-action="toggle-theme" aria-label="切换主题">
          <i data-lucide="${theme === "dark" ? "sun" : "moon"}"></i>
        </button>
        <button class="mobile-icon-button" type="button" data-mobile-action="toggle-login" aria-label="${user ? "账号信息" : "登录"}">
          <i data-lucide="user"></i>
        </button>
        ${
          user
            ? `
              <button class="mobile-icon-button" type="button" data-mobile-action="open-history" aria-label="查看历史作品">
                <i data-lucide="history"></i>
              </button>
            `
            : ""
        }
      </div>
    </header>
  `;
}

function mobileLoginSheet(state) {
  return `
    <div class="mobile-login-layer ${state.mobileUI.loginOpen ? "active" : ""}">
      <div class="mobile-backdrop ${state.mobileUI.loginOpen ? "active" : ""}" data-mobile-action="toggle-login"></div>
      <section class="mobile-login-sheet ${state.mobileUI.loginOpen ? "active" : ""}">
        <div class="mobile-sheet-head mobile-login-head">
          <div class="mobile-sheet-heading">
            <strong>${state.currentUser ? "账号信息" : "登录胖狐生图"}</strong>
            <span>${state.currentUser ? "可在这里退出当前账号" : "登录后可生成图片并查看自己的作品"}</span>
          </div>
          <button class="mobile-icon-button" type="button" data-mobile-action="toggle-login" aria-label="关闭登录面板">
            <i data-lucide="x"></i>
          </button>
        </div>
        ${
          state.currentUser
            ? `
              <div class="mobile-user-summary">
                <strong>${escapeHtml(state.currentUser.displayName)}</strong>
                <span>剩余可生成 ${Number(state.currentUser.quotaRemaining)} 次</span>
              </div>
              <button class="mobile-generate-button secondary" type="button" data-mobile-action="logout">退出登录</button>
            `
            : `
              <form class="mobile-login-form" data-role="mobile-login-form">
                <input class="mobile-input" name="username" autocomplete="username" placeholder="用户名" />
                <input class="mobile-input" name="password" type="password" autocomplete="current-password" placeholder="密码" />
                ${state.loginError ? `<div class="mobile-inline-error">${escapeHtml(state.loginError)}</div>` : ""}
                <button class="mobile-generate-button" type="submit" ${state.loginLoading ? "disabled" : ""}>${state.loginLoading ? "登录中" : "登录"}</button>
              </form>
            `
        }
      </section>
    </div>
  `;
}

export function renderMobileApp({ state, selectedItem, formatDateTime }) {
  const providerLabel = getProvider(state.providerId)?.name || "胖狐 API";
  const providerOptions = appConfig.providers;
  const modelOptions = getModelsForProvider(state.providerId);
  const modelLabel = modelOptions.find((item) => item.id === state.model)?.name || state.model;
  const sizeOptions = getParamOptions(state.providerId, state.model, "size");
  const qualityOptions = getParamOptions(state.providerId, state.model, "quality");

  const subroute = state.mobileUI.subroute;
  const bodyContent =
    subroute === "history"
      ? `
        <div class="mobile-page-head">
          <button class="mobile-icon-button" type="button" data-mobile-action="open-feed" aria-label="返回首页">
            <i data-lucide="chevron-left"></i>
          </button>
          <strong>${state.mobileUI.managingHistory ? `已选择 ${state.mobileUI.selectedHistoryIds.length} 张` : "历史作品"}</strong>
          <button class="mobile-manage-chip" type="button" data-mobile-action="toggle-history-manage">${state.mobileUI.managingHistory ? "完成" : "管理"}</button>
        </div>
        ${
          state.history.length
            ? historyGrid(state.history, { mobileUI: state.mobileUI })
            : emptyState({ title: "还没有作品", description: "生成完成后，作品会保存在这里。", actionLabel: state.currentUser ? "开始生成" : "去登录", action: state.currentUser ? "open-composer" : "toggle-login" })
        }
      `
      : subroute === "detail"
        ? `
          <div class="mobile-page-head">
            <button class="mobile-icon-button" type="button" data-mobile-action="detail-back" aria-label="返回作品列表">
              <i data-lucide="chevron-left"></i>
            </button>
            <strong>作品</strong>
            <button class="mobile-icon-button" type="button" data-mobile-action="open-history" aria-label="查看历史作品">
              <i data-lucide="history"></i>
            </button>
          </div>
          ${detailPanel(selectedItem, { formatDateTime })}
        `
        : `
          ${state.history.length ? state.history.map((item) => feedCard(item, { selectedId: state.selectedId })).join("") : ""}
          ${
            state.history.length
              ? ""
              : state.currentUser
                ? emptyState({ title: "还没有作品", description: "输入提示词后，你的第一张作品会出现在这里。", actionLabel: "开始生成", action: "open-composer" })
                : emptyState({
                    title: "登录后即可开始生成图片",
                    description: "登录后可使用你的配额并查看自己的作品记录。",
                    actionLabel: "去登录",
                    action: "toggle-login",
                    className: "mobile-empty-card-emphasis",
                  })
          }
          ${state.apiError ? `<div class="mobile-inline-error mobile-global-error">${escapeHtml(state.apiError)}</div>` : ""}
        `;

  return `
    <main class="mobile-app-root">
      <section class="mobile-shell">
        ${mobileToolbar(state)}
        <div class="mobile-scroll-content ${subroute === "feed" ? "is-feed" : ""}">
          ${bodyContent}
        </div>
        ${
          subroute === "feed"
            ? `
              <div class="mobile-composer-bar">
                <button
                  class="mobile-composer-button ${state.currentUser ? "" : "is-login-entry"}"
                  type="button"
                  data-mobile-action="${state.currentUser ? "open-composer" : "toggle-login"}"
                  aria-label="${state.currentUser ? "打开生成设置" : "打开登录窗口"}"
                >
                  <span class="mobile-composer-kicker">${state.currentUser ? "创作" : "登录"}</span>
                  <span class="mobile-composer-placeholder">${state.currentUser ? state.prompt.trim() || "描述你想生成的画面" : "登录后开始生成图片"}</span>
                  <span class="mobile-send-badge"><i data-lucide="${state.currentUser ? "sliders-horizontal" : "user"}"></i></span>
                </button>
              </div>
            `
            : ""
        }
        <input class="hidden-file-input" data-role="edit-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple />
        ${composerPanel({ state, providerOptions, providerLabel, modelOptions, modelLabel, sizeOptions, qualityOptions })}
        ${mobileLoginSheet(state)}
        ${
          subroute === "history" && state.mobileUI.managingHistory
            ? `
              <div class="mobile-manage-bar">
                <div class="mobile-manage-copy">
                  <strong>${escapeHtml(state.mobileUI.batchActionText || `已选择 ${state.mobileUI.selectedHistoryIds.length} 张`)}</strong>
                  <span>${escapeHtml(state.mobileUI.batchActionText ? "请稍候，正在处理" : "可批量下载或删除")}</span>
                </div>
                <button type="button" data-mobile-action="batch-download" ${state.mobileUI.batchActionText ? "disabled" : ""} aria-label="下载已选作品">
                  <i data-lucide="download"></i>
                  <span>下载</span>
                </button>
                <button type="button" data-mobile-action="batch-delete" ${state.mobileUI.batchActionText ? "disabled" : ""} aria-label="删除已选作品">
                  <i data-lucide="trash-2"></i>
                  <span>删除</span>
                </button>
              </div>
            `
            : ""
        }
        ${state.mobileUI.toast ? `<div class="mobile-toast" role="status" aria-live="polite">${escapeHtml(state.mobileUI.toast)}</div>` : ""}
      </section>
    </main>
  `;
}

export function bindMobileAppEvents({ app, onAction, onFieldInput, onLogin }) {
  app.querySelectorAll("[data-mobile-action]").forEach((node) => {
    node.addEventListener("click", () => {
      onAction(node.dataset.mobileAction, {
        historyId: node.dataset.historyId || "",
        setting: node.dataset.setting || "",
        providerId: node.dataset.providerId || "",
        model: node.dataset.model || "",
        size: node.dataset.size || "",
        quality: node.dataset.quality || "",
        fileId: node.dataset.fileId || "",
      });
    });
  });

  app.querySelectorAll("[data-mobile-field]").forEach((field) => {
    field.addEventListener("input", (event) => {
      onFieldInput(event.currentTarget.dataset.mobileField, event.currentTarget.value, {
        selectionStart: typeof event.currentTarget.selectionStart === "number" ? event.currentTarget.selectionStart : null,
        selectionEnd: typeof event.currentTarget.selectionEnd === "number" ? event.currentTarget.selectionEnd : null,
      });
    });
  });

  const loginForm = app.querySelector("[data-role='mobile-login-form']");
  if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      onLogin(new FormData(event.currentTarget));
    });
  }
}
