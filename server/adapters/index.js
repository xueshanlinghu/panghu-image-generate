import { panghuGptImage2Adapter } from "./panghuGptImage2.js";

const adapters = [panghuGptImage2Adapter];

export function getGenerationAdapter(providerId, model) {
  return adapters.find((adapter) => adapter.isMatch({ providerId, model }));
}
