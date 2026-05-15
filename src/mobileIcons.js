import providerPanghuIcon from "../static/images/logo-panghu-api.webp";
import modelGptImage2Icon from "../static/images/logo-gpt-image-2.webp";
import optionAutoImage from "../static/images/option-auto.webp";
import optionSquareImage from "../static/images/option-1-1.webp";
import optionLandscapeImage from "../static/images/option-3-2.webp";
import optionPortraitImage from "../static/images/option-2-3.webp";
import optionSquare2kImage from "../static/images/option-1-1-2K.webp";
import optionWide2kImage from "../static/images/option-16-9-2K.webp";
import optionWide4kImage from "../static/images/option-16-9-4K.webp";
import optionTall4kImage from "../static/images/option-9-16-4K.webp";

const providerIcons = {
  panghu: providerPanghuIcon,
};

const modelIcons = {
  "gpt-image-2": modelGptImage2Icon,
};

const sizePresets = {
  auto: { badge: "自动", title: "自动", detail: "智能匹配", icon: optionAutoImage, cardImage: optionAutoImage },
  "1024x1024": { badge: "1:1", title: "1:1 正方形", detail: "1024×1024", icon: optionSquareImage, cardImage: optionSquareImage },
  "1536x1024": { badge: "3:2", title: "3:2 横向", detail: "1536×1024", icon: optionLandscapeImage, cardImage: optionLandscapeImage },
  "1024x1536": { badge: "2:3", title: "2:3 竖向", detail: "1024×1536", icon: optionPortraitImage, cardImage: optionPortraitImage },
  "2048x2048": { badge: "1:1", title: "1:1 正方形", detail: "2048×2048 · 2K", icon: optionSquare2kImage, cardImage: optionSquare2kImage },
  "2048x1152": { badge: "16:9", title: "16:9 横向", detail: "2048×1152 · 2K", icon: optionWide2kImage, cardImage: optionWide2kImage },
  "3840x2160": { badge: "16:9", title: "16:9 横向", detail: "3840×2160 · 4K", icon: optionWide4kImage, cardImage: optionWide4kImage },
  "2160x3840": { badge: "9:16", title: "9:16 竖向", detail: "2160×3840 · 4K", icon: optionTall4kImage, cardImage: optionTall4kImage },
};

const qualityPresets = {
  auto: { badge: "自动", title: "自动", detail: "默认输出", cardImage: optionAutoImage, glyph: "A" },
  low: { badge: "低", title: "低", detail: "更快返回", glyph: "低" },
  medium: { badge: "中", title: "中", detail: "平衡速度与质量", glyph: "中" },
  high: { badge: "高", title: "高", detail: "更精细", glyph: "高" },
};

export function getMobileProviderIcon(providerId) {
  return providerIcons[providerId] || providerPanghuIcon;
}

export function getMobileModelIcon(modelId) {
  return modelIcons[modelId] || modelGptImage2Icon;
}

export function getMobileSizePreset(size) {
  return sizePresets[size] || { badge: size || "自动", title: size || "自动", detail: "", icon: optionAutoImage, cardImage: optionAutoImage };
}

export function getMobileQualityPreset(quality) {
  return qualityPresets[quality] || qualityPresets.auto;
}
