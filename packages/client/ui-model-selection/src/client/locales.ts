/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` intentionally matches `trigger.fallback` but remains a
 * separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.label': '模型',
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '选择模型',
  'trigger.loading': '正在加载模型…',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.aria': '模型与推理等级',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'effort.providerDefault': 'Default',
  'status.loading': '正在刷新模型列表…',
  'status.updatedNow': '刚刚更新',
  'status.updatedAgo': '更新于 {minutes} 分钟前',
  'error.action': '模型操作失败：{message}',
  'action.refresh': '刷新',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'failure.noCredential': '{name}：未配置凭证',
  'option.context': '上下文 {tokens} tokens',
  'empty.results': '没有结果',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '当前模型未提供推理等级。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.label': 'Model',
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.loading': 'Loading models…',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.aria': 'Model and reasoning effort',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'status.updatedNow': 'Updated just now',
  'status.updatedAgo': 'Updated {minutes} min ago',
  'error.action': 'Model operation failed: {message}',
  'action.refresh': 'Refresh',
  'warning.groupLoad': '{name} failed to load: {message}',
  'failure.noCredential': '{name}: no credential configured',
  'option.context': 'Context {tokens} tokens',
  'empty.results': 'No results',
  'blocked.composer': 'This model is unavailable; select one to continue',
  'empty.efforts': 'This model provides no reasoning effort levels.',
} satisfies Record<ModelKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'command.label': 'Modelo',
  'command.description': 'Elegir el modelo de esta conversación',
  'option.loadError': 'No se pudo cargar el catálogo: {message}',
  'trigger.fallback': 'Elegir un modelo',
  'trigger.loading': 'Cargando modelos…',
  'trigger.selectAria': 'Elegir un modelo',
  'trigger.aria': 'Elegir un modelo, actual {model}',
  'trigger.ariaEffort': 'Elegir un modelo, actual {model}, nivel de razonamiento {effort}',
  'menu.aria': 'Modelo y nivel de razonamiento',
  'menu.model': 'Modelo',
  'menu.effort': 'Nivel de razonamiento',
  'effort.providerDefault': 'Default',
  'status.loading': 'Actualizando la lista de modelos…',
  'status.updatedNow': 'Actualizado hace un momento',
  'status.updatedAgo': 'Actualizado hace {minutes} min',
  'error.action': 'No se pudo completar la operación con el modelo: {message}',
  'action.refresh': 'Actualizar',
  'warning.groupLoad': '{name} no se pudo cargar: {message}',
  'failure.noCredential': '{name}: no hay credencial configurada',
  'option.context': 'Contexto {tokens} tokens',
  'empty.results': 'Sin resultados',
  'blocked.composer': 'El modelo actual no está disponible; elige uno para continuar',
  'empty.efforts': 'Este modelo no ofrece niveles de razonamiento.',
} satisfies Record<ModelKey, string>
