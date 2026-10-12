/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Locale namespace shared by both current-session permission pickers. */
export const PERMISSION_ACCESS_NS = 'permission.access'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '选择新会话的默认权限模式',
  'loading': '加载中',
  'unavailable': '不可用',
  'preset.readOnly': '仅可查看',
  'preset.workspaceWrite': '工作区内修改',
  'preset.fullAccess': '完全权限',
  'confirm.title': '确认启用完全权限？',
  'confirm.description': '启用完全权限后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全权限',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'title': 'Permisos',
  'description': 'Elige el modo de permiso predeterminado para las sesiones nuevas',
  'loading': 'Cargando',
  'unavailable': 'No disponible',
  'preset.readOnly': 'Solo lectura',
  'preset.workspaceWrite': 'Escritura en el workspace',
  'preset.fullAccess': 'Acceso total',
  'confirm.title': '¿Habilitar el acceso total?',
  'confirm.description': 'El acceso total reduce los pasos de confirmación y permite que las sesiones nuevas realicen más acciones directamente, incluidas operaciones sensibles, cambios en archivos o comandos externos. Úsalo solo cuando confíes en las tareas posteriores.',
  'confirm.acknowledge': 'Entiendo los riesgos y quiero continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Habilitar el acceso total',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'mode': '访问模式，当前：{name}',
  'close': '关闭',
  'preset.readOnly': '仅可查看',
  'preset.workspaceWrite': '工作区内修改',
  'preset.fullAccess': '完全权限',
  'confirm.title': '确认启用完全权限？',
  'confirm.description': '启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全权限',
  'auto.label': 'Auto review',
  'auto.badge': 'EXP',
  'auto.description': '无沙箱运行；每次原生工具调用和 PTC 内层调用前由同一模型进行实验性审查。',
  'auto.confirm.title': '确认启用 Auto review（实验）？',
  'auto.confirm.description': 'Auto review 不使用沙箱。每次原生工具调用和 PTC 内层调用前，都会由与当前 agent 相同的模型进行审查。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。',
  'auto.confirm.acknowledge': '我已了解这些风险，并愿意继续',
  'auto.confirm.enable': '启用 Auto review',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'mode': 'Access mode, current: {name}',
  'close': 'Close',
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
  'auto.label': 'Auto review',
  'auto.badge': 'EXP',
  'auto.description': 'Run without a sandbox after an experimental same-model review of every native tool call and PTC inner call.',
  'auto.confirm.title': 'Enable Auto review (experimental)?',
  'auto.confirm.description': 'Auto review runs without a sandbox. Before every native tool call and PTC inner call, the same model as the current agent reviews whether to allow it. This feature is experimental, can falsely allow or deny actions, and uses additional tokens.',
  'auto.confirm.acknowledge': 'I understand these risks and want to continue',
  'auto.confirm.enable': 'Enable Auto review',
} satisfies Record<PermissionAccessKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const accessEs = {
  'mode': 'Modo de acceso, actual: {name}',
  'close': 'Cerrar',
  'preset.readOnly': 'Solo lectura',
  'preset.workspaceWrite': 'Escritura en el workspace',
  'preset.fullAccess': 'Acceso total',
  'confirm.title': '¿Habilitar el acceso total?',
  'confirm.description': 'El acceso total reduce los pasos de confirmación y permite que el agente realice más acciones directamente, incluidas operaciones sensibles, cambios en archivos o comandos externos. Úsalo solo cuando confíes en la tarea actual.',
  'confirm.acknowledge': 'Entiendo los riesgos y quiero continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Habilitar el acceso total',
  'auto.label': 'Auto review',
  'auto.badge': 'EXP',
  'auto.description': 'Se ejecuta sin sandbox; antes de cada llamada a herramienta nativa y de cada llamada interna de PTC, el mismo modelo realiza una revisión experimental.',
  'auto.confirm.title': '¿Habilitar Auto review (experimental)?',
  'auto.confirm.description': 'Auto review se ejecuta sin sandbox. Antes de cada llamada a herramienta nativa y de cada llamada interna de PTC, el mismo modelo que el agente actual revisa si permitirla. Esta función es experimental, puede permitir o denegar acciones por error y consume tokens adicionales.',
  'auto.confirm.acknowledge': 'Entiendo estos riesgos y quiero continuar',
  'auto.confirm.enable': 'Habilitar Auto review',
} satisfies Record<PermissionAccessKey, string>
