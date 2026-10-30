/** `skill` namespace dictionaries for the dedicated tool row and the install row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'skill'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'row.title': 'Skill',
  'row.running': '正在加载 skill',
  'row.failed': 'skill 加载失败',
  'row.stopped': 'skill 加载已中止',
  'row.instructions': '说明',
  'row.inspect': '查看',
  'menu.userOnly': '仅用户',
  'install.title': '安装 skill',
  'install.running': '正在安装 skill',
  'install.scope.workspace': '仅此工作区',
  'install.scope.global': '全局用于你的用户',
  'install.status.installed': '已安装',
  'install.status.replaced': '已替换',
  'install.status.alreadyInstalled': '已存在，无需重装',
  'install.status.skipped': '已跳过：已存在同名 skill',
  'install.status.refused': '已拒绝',
  'install.status.cancelled': '已取消',
  'install.notASkill': '该文件夹不是 skill',
} satisfies Record<string, string>

/** The skill namespace key union. */
export type SkillKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'row.title': 'Skill',
  'row.running': 'Loading skill',
  'row.failed': 'Skill load failed',
  'row.stopped': 'Skill load stopped',
  'row.instructions': 'Instructions',
  'row.inspect': 'Inspect',
  'menu.userOnly': 'user-only',
  'install.title': 'Install skill',
  'install.running': 'Installing skill',
  'install.scope.workspace': 'This workspace only',
  'install.scope.global': 'Global for your user',
  'install.status.installed': 'Installed',
  'install.status.replaced': 'Replaced',
  'install.status.alreadyInstalled': 'Already installed',
  'install.status.skipped': 'Skipped: a skill with that name already exists',
  'install.status.refused': 'Refused',
  'install.status.cancelled': 'Cancelled',
  'install.notASkill': 'That folder is not a skill',
} satisfies Record<SkillKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'row.title': 'Skill',
  'row.running': 'Cargando la skill',
  'row.failed': 'Error al cargar la skill',
  'row.stopped': 'Carga de la skill detenida',
  'row.instructions': 'Instrucciones',
  'row.inspect': 'Inspeccionar',
  'menu.userOnly': 'solo usuario',
  'install.title': 'Instalar skill',
  'install.running': 'Instalando la skill',
  'install.scope.workspace': 'Solo este espacio de trabajo',
  'install.scope.global': 'Global para tu usuario',
  'install.status.installed': 'Instalada',
  'install.status.replaced': 'Reemplazada',
  'install.status.alreadyInstalled': 'Ya estaba instalada',
  'install.status.skipped': 'Omitida: ya existe una skill con ese nombre',
  'install.status.refused': 'Rechazada',
  'install.status.cancelled': 'Cancelada',
  'install.notASkill': 'Esa carpeta no es una skill',
} satisfies Record<SkillKey, string>
