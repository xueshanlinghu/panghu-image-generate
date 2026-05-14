import { appConfig } from "./appConfig.js";

export function getProvider(providerId) {
  return appConfig.providers.find((provider) => provider.id === providerId) ?? appConfig.providers[0];
}

export function getModelsForProvider(providerId) {
  return appConfig.models.filter((model) => model.providerId === providerId);
}

export function getModelConfig(providerId, modelId) {
  return (
    appConfig.models.find((model) => model.providerId === providerId && model.id === modelId) ??
    getModelsForProvider(providerId)[0] ??
    appConfig.models[0]
  );
}

export function getParamOptions(providerId, modelId, paramName) {
  return getModelConfig(providerId, modelId)?.params?.[paramName]?.options ?? [];
}

export function getParamDefault(providerId, modelId, paramName) {
  const param = getModelConfig(providerId, modelId)?.params?.[paramName];
  return param?.defaultValue ?? param?.options?.[0]?.id ?? "";
}

export function normalizeModelState(state) {
  // 根据当前 provider/model 把状态纠正到合法值，避免旧历史或切换模型后留下无效参数。
  const provider = getProvider(state.providerId);
  state.providerId = provider.id;

  const model = getModelConfig(state.providerId, state.model);
  state.model = model.id;

  for (const paramName of Object.keys(model.params ?? {})) {
    const options = getParamOptions(state.providerId, state.model, paramName);
    if (!options.some((option) => option.id === state[paramName])) {
      state[paramName] = getParamDefault(state.providerId, state.model, paramName);
    }
  }
}
