# Agent Note: skills 目录是带路由触发器描述的可验证产物

Status: implemented

[English](2026-09-22-skills-catalog-gate-and-triggers.md) | 中文

## 问题

角色 skills 目录有两个反复出现的弱点。每一类解析缺陷（2026-09-22 修复的未加引号冒号与下划线命名）都是被用户盯着空白的 `/` 菜单发现的，而不是被门禁发现——没有任何机制把目录当作产物来校验。而且 description 是 harness 唯一的模型调用路由信号，却只写了角色/模块/动作，从不说*何时*使用该 skill，助手只能靠猜选工具，没有显式触发器。

## 决策

一个验证门禁和生成的路由触发器，均幂等，且自此强制执行。

- `scripts/verify-skills-catalog.ts`（`pnpm run verify-skills-catalog`，由 vitest 套件中的 `scripts/verify-skills-catalog.spec.ts` 覆盖）拒绝：没有 SKILL.md 的 skill 目录、缺失或无法解析的 YAML frontmatter（js-yaml，与 2026-09-22 同一缺陷类）、违反 harness kebab-case 语法或与目录不匹配的 `name`、缺失 `description` 或缺少路由触发器的 description、缺失 `module`，以及未知 `action`（封闭集合 view/create/update/delete/download_doc/view_doc/upload_doc）。spec 跑真实目录加各类 bug 的合成夹具。
- 每个 description 现在携带生成的触发器，例如 view → "Úsala cuando el usuario quiera consultar, listar, ver, buscar o revisar <module> (por ejemplo 'muéstrame <module>' o 'busca en <module>')."，由 `scripts/rewrite-skill-triggers.mjs` 插入到 "Herramientas MCP:" 标记之前（652 个文件，幂等）。`scripts/flatten-skills.mjs` 在重新生成时注入同样的句子，因此下次从 Skills-MCP 源再生目录时触发器不会丢失。

## 已考虑的替代方案

- **逐个人工编写触发器。** 否决：675 个文件的手工文案会立即漂移；module+action 模板确定性地覆盖整个目录，之后仍可人工精修例外（重写器只补没有触发器的描述）。
- **把路由元数据放到独立字段（如 `triggers:`）。** 否决：harness 的 skill 路由器读的是 `description`，不是自定义字段；ECC 分析（agents/code-reviewer.md）证实了 description 即路由策略的模式。
- **用 harness registry 本身而不是 js-yaml 来验证。** 作为门禁予以否决：在目录上启动 skill registry 是集成测试（修复后的目录已人工验证过），而门禁需要的是在标准套件中运行的快速源码面检查；验证器镜像 registry 自己的规则（kebab 语法、YAML 解析、name/description 存在性）。

## 后果

- 目录回归现在会在几秒内让 `pnpm run verify-skills-catalog` 和 vitest 套件失败，无论本地还是 CI，都到不了部署。
- 全部 652 个 description 都有了显式的西班牙语路由文本，这正是 harness 的 `/` 菜单和模型调用共同读取的内容。
- 从源再生目录时，frontmatter 有效性、kebab 命名和触发器都天然保留（flattener 中一个模板，由门禁检查）。
