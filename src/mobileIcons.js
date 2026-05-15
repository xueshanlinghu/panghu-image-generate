import providerPanghuIcon from "../static/images/mobile/provider-panghu.svg";
import modelGptImage2Icon from "../static/images/mobile/model-gpt-image-2.svg";
import sizeAutoIcon from "../static/images/mobile/size-auto.svg";
import sizeSquareIcon from "../static/images/mobile/size-square.svg";
import sizeLandscapeIcon from "../static/images/mobile/size-landscape.svg";
import sizePortraitIcon from "../static/images/mobile/size-portrait.svg";
import sizeWideIcon from "../static/images/mobile/size-wide.svg";
import sizeTallIcon from "../static/images/mobile/size-tall.svg";

const providerIcons = {
  panghu: providerPanghuIcon,
};

const modelIcons = {
  "gpt-image-2": modelGptImage2Icon,
};

const sizePresets = {
  auto: { badge: "自动", title: "自动", detail: "智能匹配", icon: sizeAutoIcon },
  "1024x1024": { badge: "1:1", title: "1:1 正方形", detail: "1024×1024", icon: sizeSquareIcon },
  "1536x1024": { badge: "3:2", title: "3:2 横向", detail: "1536×1024", icon: sizeLandscapeIcon },
  "1024x1536": { badge: "2:3", title: "2:3 竖向", detail: "1024×1536", icon: sizePortraitIcon },
  "2048x2048": { badge: "1:1", title: "1:1 正方形", detail: "2048×2048 · 2K", icon: sizeSquareIcon },
  "2048x1152": { badge: "16:9", title: "16:9 横向", detail: "2048×1152 · 2K", icon: sizeWideIcon },
  "3840x2160": { badge: "16:9", title: "16:9 横向", detail: "3840×2160 · 4K", icon: sizeWideIcon },
  "2160x3840": { badge: "9:16", title: "9:16 竖向", detail: "2160×3840 · 4K", icon: sizeTallIcon },
};

const qualityPresets = {
  auto: { badge: "自动", title: "自动", detail: "默认输出" },
  low: { badge: "低", title: "低", detail: "更快返回" },
  medium: { badge: "中", title: "中", detail: "平衡速度与质量" },
  high: { badge: "高", title: "高", detail: "更精细" },
};

export function getMobileProviderIcon(providerId) {
  return providerIcons[providerId] || providerPanghuIcon;
}

export function getMobileModelIcon(modelId) {
  return modelIcons[modelId] || modelGptImage2Icon;
}

export function getMobileSizePreset(size) {
  return sizePresets[size] || { badge: size || "自动", title: size || "自动", detail: "", icon: sizeAutoIcon };
}

export function getMobileQualityPreset(quality) {
  return qualityPresets[quality] || qualityPresets.auto;
}
