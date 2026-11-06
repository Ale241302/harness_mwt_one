---
title: FaberLoom portable 分阶段分批次执行计划
description: 在 deepseek-harness 中实现 FaberLoom 可移植性的工作计划、agent 约定与验证。
owner: Alejandro，产品决策由 Álvaro 负责
created: 2026-11-05
expires: 2026-12-05
status: proposed
---

# FaberLoom portable：分阶段、分批次执行计划

[English](faberloom-portable-fases-olas.md) | 中文

## Summary

本文的主文按用户要求使用西班牙语，将收到的资料包转化为 `deepseek-harness` 内的 43 个可执行批次。每批明确输入、负责人、新建、修改、修正、比较、测试、验收与恢复。拟建的验证 harness 关联需求、变更、测试和证据；任何关联缺失都会阻止关闭。本文描述待办工作，不代表已认证功能，也不授权执行各阶段。

文档类型：`docs/scratch/` 中的临时规划参考。审查日期：2026-11-05。到期后 Alejandro 复核范围并续期或关闭；持久约定转入 Agent Notes，已经证明的功能进入各包参考文档。双语规则保留仓库约定的语言切换标签。

## Table of Contents

- [1. 完整阅读与基线](#1-lectura-completa-y-línea-base)
- [2. 范围、决策与依赖](#2-alcance-decisiones-y-dependencias)
- [3. Agent 约定与 skills](#3-contratos-de-agentes-y-skills)
- [4. 文件与职责](#4-archivos-y-responsabilidades)
- [5. 验证与比较 harness](#5-harness-de-verificación-y-comparación)
- [6. 阶段与批次](#6-fases-y-olas)
- [7. 资料包的 58 项测试](#7-matriz-de-las-58-pruebas-del-paquete)
- [8. 完整验证流程](#8-recorrido-completo-de-validación)
- [9. 评估与关闭](#9-evaluación-y-cierre)
- [10. 工作量与协调](#10-esfuerzo-y-coordinación)
- [11. Agent 交接](#11-entrega-entre-agentes)
- [Dev Note](#dev-note)

## 1. Lectura completa y línea base

完整阅读的范围是输入资料包：六个文件及三个子目录。对 `deepseek-harness` 的检查聚焦受影响的消费方与机制，不代表通读了依赖、编译产物、缓存或整个 monorepo。

### 1.1 资料包清单

以下路径基于同级目录 `Paquete-Alejandro-FaberLoom-2026-11-05/`。这些路径指向收到的资料，不会自动随仓库分发。

| 完整阅读的文件 | 阅读范围 | 对计划的贡献 | 处理方式 |
|---|---|---|---|
| `00-LEEME.md` | 第 1 至 53 行 | 当前计划优先级、决策与缺失资料 | 保留执行限制与未决事项 |
| `01-Plan-FaberLoom-portable-por-fases.md` | 第 1 至 663 行 | 当前范围、阶段、用户流程与 58 项测试 | 本分解的需求依据 |
| `02-referencia/PLAN-ALEJANDRO-original.md` | 第 1 至 449 行 | 原范围、30 项测试与消费方 | 将原第 1 至 14 节逐一对照当前计划 |
| `03-revision-astra/ronda-1.md` | 第 1 至 209 行 | Git/MinIO、UX、首个完整循环与 host 限制 | 保留已纳入的改进，复核被替代的建议 |
| `03-revision-astra/ronda-2.md` | 第 1 至 91 行 | 恢复遗漏、读取/提案分离、批准与应用器 | 阶段 1、3A 必须覆盖的负面要求 |
| `04-prototipo/armar_plugin.py` | 第 1 至 215 行 | 生成器参考实现 | 仅作背景阅读，不执行，也不以其输出为判定真值 |

第二轮修正第一轮：没有确认加载就不能声称连接已就绪，也不能承诺任意聊天都能访问本地副本。当前计划恢复了弱化范围，在原 30 项上增加 28 项。本文在第 7 节分别保留全部 58 个标识。

冻结清单位于 `scripts/faberloom-portable/baseline.json`：六条路径、字节数、阅读范围与 SHA-256，并记录分支与 Node、pnpm、包版本。HEAD 与 diff 摘要写入 `.artifacts/` 下的执行证据，而非本维护文档；修改本计划会改变其摘要，`check-plan.ts` 因此要求重新生成登记，而不是接受已不对应的用例清单。

### 1.2 本地观察证据

已查询 `git status --short`、`git branch --show-current`、`git rev-parse HEAD`：分支为 `main`，文档修改前工作树干净，HEAD 与 Astra 审查一致。完整标识保留在会话输出中；未来的 `run.json` 将其作为执行证据记录，遵守仓库引用校验规则，不把 commit 标识嵌入持续维护的正文。

| 检查的证据 | 静态结果 | 对批次的影响 |
|---|---|---|
| `package.json` | 版本 `0.1.8-alpha.1`、pnpm `11.7.0`、Node `^22.19.0 || >=24.0.0` | 执行前记录 runtime 与包管理器，不把本地版本等同于部署版本 |
| [架构](../architecture.zh.md)与[测试策略](../testing.zh.md) | Cordis 组合、launcher、真实组合测试与 snapshots | 扩展既有服务/插件和验证路径 |
| `scripts/run-gates.ts` | 带依赖和 passed/failed/skipped 状态的检查调度器 | 复用检查集成，不再建通用执行引擎 |
| `vitest.config.ts` | 收集包、应用、脚本 specs，逐文件覆盖率 | 保留既有门槛；行覆盖不代替验收 |
| `packages/faberloom/` | 已有空间、上下文、Mesa、记忆、执行与投影服务 | 保留职责并测试回归 |
| `packages/faberloom/view/tests/` | 已有批准、效果、迭代、导出和 harness 准备测试 | 在真实消费方上扩展用户测试 |
| `packages/client/ui-faberloom/src/client/` | `components.tsx`、`panels.tsx`、`store.ts`、`locales.ts`、`harness-install.tsx` | 把提案审查与状态融入现有 UI |
| [F01 至 F50 清单](../faberloom-e2e-checklist.zh.md) | 既有自动与手动验证目录 | 作为额外回归保留，列出不等于已执行 |
| `node --version` | `v22.22.2` | 观察版本符合 engines 声明 |
| `pnpm --version` | 不在 PATH 中，但 `corepack pnpm --version` 返回 `11.7.0`，且 `node_modules` 已存在 | 以 `corepack pnpm` 调用包管理器；无需全局安装 |

尚未认证 Consola、IdP、已部署 MinIO、host 账户或生产环境。Álvaro 提及的 `build_faberloom.py` 及 `mwt-knowledge-hub` 的 `faberloom-espacios` 分支未随包提供。其审查列为待补输入，不算已验证工作。

### 1.3 原型需要的具体修正

| 阅读的代码 | 替代实现必须解决的问题 | 批次 |
|---|---|---|
| `copiar_arbol`，40 至 48 行 | 只检查文件符号链接；还需目录、junction、别名和竞态 | 3A.2、3B.2 |
| `agente_limpio`，58 至 67 行 | 元数据只留名称/描述，将 skills 移入正文，丢失限制 | 3B.3 |
| `sin_rutas_externas`，70 至 71 行 | regex 删除行，没有解析依赖或证明隔离 | 3A.2、3B.1 |
| 继承，110 至 116 行 | 复制父规则，缺少逐贡献授权模型 | 3B.1 |
| 指纹，163 至 178 行 | 在纳入全部文件与最终身份之前计算版本 | 3A.2、3B.3 |
| `.mcp.json`，173 至 174 行 | 本地端点与全局 token 变量不能解决远程聊天及共存 | 1.4、4A.1 |
| `main`，198 至 211 行 | 初始重叠检查后，替换前先删除旧输出 | 3B.2 |

与原型比较时保留预期内容和能力，但必须明确这些缺陷上的行为差异。不能为了逐字节相同而复制不安全行为。

## 2. Alcance, decisiones y dependencias

目标是在此 monorepo 开发 FaberLoom portable：本地 home、空间/子空间、获授权上下文、Mesa 提案、人工批准、可验证发布，以及可选 MWT 和各 host 适配器。

### 2.1 产品不变量

1. FaberLoom 保有授权和业务规则；适配器只转换能力。
2. 已批准编辑知识只有一个 Git 权威源；MinIO 保存不可变派生发布。
3. 运行上下文、记忆、workflows、会话和凭据保留各自权威源。会话和转录不进入 portable 包，即使作为授权空间的资源或依赖也不允许；凭据也不进入包。
4. 本地身份不授予 MWT 访问权。关闭 MWT 意味着没有其工具、流量、探测和重试。
5. AI 提案；认证人员批准准确条目、基线和 diff；应用器写入前重新校验。
6. 读取、提案和批准是不同权限。宽权限、所有者身份或客户端标识不证明人工动作。
7. 每次编辑知识读取固定到某个修订；实时运行上下文另行标识。
8. 错误保留工作并指明下一步；收到、发布和加载只能由相应证据确认。
9. Claude/ChatGPT 插件不得暗中调用另一模型。DSH 保留获授权的多模型组合。
10. 隔离需在字节、权限、状态和效果上验证，会话行为仅是补充。

### 2.2 Decisiones, bloqueos y resoluciones

| ID | 决策或输入 | 状态与负责人 | 阻塞的工作 | 结果 |
|---|---|---|---|---|
| D01 | Claude 应用与测试账户 | 已决 · 架构（2.2.1） | 4A、4B 认证 | Code 优先；聊天与 Cowork 保持开放 |
| D02 | 远程服务与 home 自愿关联 | 已决 · 架构（2.2.1） | 1.4、4A.3 | 首个增量不使用远程服务；运营方已指定 |
| D03 | 正式 Git 源与技术管理员 | 已决 · 架构（2.2.1） | 3A.1 | 按组织的知识仓库；`publication` 的技术 actor |
| D04 | 导出与 CEO-ONLY/N3/N4 | 已决 · 架构（2.2.1） | 3A.2、7A | 允许清单排除；未知分类拒绝 |
| D05 | 继承与修订更新 | 已决 · 架构（2.2.1） | 3A.2、3B.1 | 逐贡献显式继承；子优先；排除优先 |
| D06 | 测试 MinIO、版本、保留与撤回 | 开放 · 平台与 Álvaro | 3A.3 关闭 | 权限、恢复、真实不可变性证据 |
| D07 | 测试 OAuth、客户端、redirects 与权限 | 已决 · Authentik（`idp.mwt.one`） | 1.4、5.1 使用环境 | 已验证 metadata、带 loopback redirect 的 `Claude MCP` 客户端与权限；PocketID 未启用；包中无秘密 |
| D08 | 模型提供方与本地 home | 已决 · 架构（2.2.1） | 2.1、2.3 | BYOK 认证；home 位于同步目录之外 |
| D09 | UX 门槛和代表性用户 | 开放 · Álvaro 与 UX | 4A.3、4B.3 关闭 | 确认或调整连接 ≤5 分钟、循环 ≤10 分钟 |
| D10 | 撤销时间窗口与多安装实例 | 开放 · Álvaro 与身份 | 5.3 关闭 | 可测上限与进行中操作策略 |
| D11 | Marluvas/Eguisa 试点及团队容量 | 开放 · Álvaro 与协调 | 7A | 任务、人员、可导出数据与排期 |
| D12 | 支持的 host、版本与系统 | 开放 · 产品与 QA | 各阶段 6、7B 分发 | 明确矩阵；建议 Windows 优先 |
| D13 | 提供 `build_faberloom.py` 和 KB 分支 | 开放 · Álvaro | 3B.3 替代 | 经审查副本、消费方与需求比较 |
| D14 | Consola MWT 只读访问与集成约定 | 开放 · Consola 运营者 | 阶段 5 真实认证 | 后端、grants、缓存、RBAC 与联合测试 |

未决依赖只阻塞依赖它的工作。例如 D14 不阻塞合成数据生成器；D06 会阻止声称 MinIO 发布已证明。已决事项固定设计，但其运行输入——账户、测试仓库、MinIO 存储——仍是认证条件，可使消费它的批次保持开放。资料包推荐 `harness.mwt.one`，不代表授权使用生产环境。

#### 2.2.1 Decisiones tomadas el 2026-11-05

以下六项决策由架构作出，用于解除 0.2 的阻塞。它们固定设计；后续产品确认只能收紧，扩大范围需登记新决策。

**D01 — Claude 应用与测试账户。** 首个认证应用是 Claude Code，包括其命令行界面与桌面扩展，版本在打开 4A.1 时固定。测试账户为专用组织账户，区别于个人账户，不持有组织管理员角色，具备安装插件与本地 MCP 服务器的能力，不含客户数据，并在该批次的 `run.json` 中连同版本登记。聊天网页与 Cowork 不继承该认证：它们依赖远程端点（D02）并在 4B 中各自取证。若账户无法安装该机制，4A 保持开放，不替换应用。

**D02 — 远程服务与 home 关联。** 首个增量不把 home 暴露到本机之外。远程服务指定由 FaberLoom 平台团队负责，负责人由 Álvaro 指定，只在需要它的批次中构建，使用独立环境与独立 Mesa 权威。home 与远程账户的关联按安装自愿、单次、可撤销；禁止临时隧道与默认公网端点。1.4 以本地端点认证，1.5 在 Code 关闭阶段 1；4A.3 的远程聊天保持显式开放。

**D03 — 正式 Git 与技术管理员。** 编辑权威是按组织划分的知识 Git 仓库，独立于本 monorepo；业务仓库（`mwt-knowledge-hub`）为指定候选，按环境使用专用且受保护的发布分支。唯一写入者是 `publication` 包拥有的技术 actor；人员不写 Git，在 Mesa 批准。应用以基线修订为条件做条件比较更新，不 `force-push`，不重写已发布历史；冲突使提案回到审查。该仓库的测试访问仍是待补运行条件：若缺失，3A.1 使用结构相同的合成仓库，正式指定不变。

**D04 — 导出排除分类。** CEO-ONLY、N3、N4 在所有增量中排除于 portable 产物。导出使用允许清单并在服务端评估分类；分类缺失或未知即拒绝。被排除内容不进入清单、manifest、上下文或标题，也不产生脱敏占位标记。扩大范围需要版本化策略与新的批准；任何客户端或提案都不能在运行时改变该规则。

**D05 — 继承与版本。** 解析规则：

1. 子只接收标记为可继承且 actor 具备逐贡献访问的父贡献；属于组织不授予任何内容。
2. 同一类型与标识符以子为准。名称冲突不按读取顺序解决：拒绝，并要求重命名或由子空间所有者签署显式别名。
3. 子在自身声明的排除优先于父继承。
4. 每次导出固定所使用的父修订。父变更不改变既有发布：识别受影响子空间并开启需要人工批准的新修订提案。
5. 继承只到声明的深度；循环与自引用在加载时拒绝，早于生成。
6. 工作引用在打开时固定空间、修订与继承，会话进行中不重算。

**D08 — 提供方与本地 home。** 首次启动选择显式模式，无静默默认值：

1. 用户密钥云模式（BYOK），面向兼容 OpenAI 的端点。2.3 认证该模式。
2. 兼容 OpenAI 的本地端点（Ollama 或 vLLM），用于无网络 home；作为次要模式认证，不承诺质量对等。
3. 凭据存放于 host 安全存储（Windows 凭据管理器或 DPAPI），绝不进入产物、共享文件或日志。
4. home 是每次安装一个目录，具有稳定本地身份，位于同步或网络目录（OneDrive、Dropbox、UNC）之外。当前 checkout 位于 OneDrive 下，因此规则在创建 home 时校验，且不继承仓库位置。
5. home 架构版本化并单调迁移；其他 home 的数据不会自动导入。
6. SICOP 单独配置；其失败不阻止启动，也不表现为已执行操作。

首个代码增量推荐 1.1 加 H0，因为它不依赖 Desktop、网络或 MinIO；满足 D08 的目录规则后 2.1 可并行。

### 2.3 执行顺序

```text
0.1 -> 0.2 -> 0.3 -> 0.4
                     |-> 1.1 -> 1.2 -> 1.3 -> 1.4 ---------|
                     |-> 2.1 -> 2.2 -> 2.3                 |
                     |-> diseño 3A                        |
1.1 + 1.2 + 0.4 -------> 3A.1 -> 3A.2 -> 3A.3 -> 3A.4 ---|
1.4 + 3A.3 ------------> 3A.4 -> 1.5 (cierre de Fase 1)
1 completa + 3A completa -> 4A.1 -> 4A.2 -> 4A.3
3A completa -> 3B.1 -> 3B.2 -> 3B.3 -> 3B.4
4A + 3B -> 4B.1 -> 4B.2 -> 4B.3
2 + 4B -> 5.1 -> 5.2 -> 5.3 -> 5.4
3B + 4B -> 6A / 6B / 6C / 6D, cada una autorizada y acotada
4B + exportacion aprobada + integraciones usadas -> 7A.1 -> 7A.2
7A + hosts certificados + autorizacion operativa -> 7B.1 -> 7B.2 -> 7B.3
```

3A 设计可从阶段 0 开始；产生效果的应用器依赖 1.1 的人工批准和 1.2 的提案身份。1.4 交付授权/引用，3A.4 交付实际读取器，1.5 用同一连接证明读取和提案后关闭阶段 1。若有测试 runtime，4A 可先于 2 关闭；完整基础交付仍要求阶段 2。7A 不等待它未使用的适配器。只有文件和决策独立的任务才能并行。

## 3. Contratos de agentes y skills

以下名称是此 OpenCode 会话目录中可用的 agent ID，负责实施与审查，并非可以在 Mesa 批准提案的业务身份。产品的人工授权始终独立。

### 3.1 任务分配通用约定

每项任务接收 `waveId`、可观察目标、需求、允许文件、版本化输入约定、已决事项、限制、获授权命令、验收条件和尝试预算。返回变更文件、命令证据、基线比较、风险、疑问与状态。协调者拒绝仅声称完成的交付。

| 目录 agent | 输入与职责 | 可修改范围 | 必需交付 | 审查者 / 拒收条件 |
|---|---|---|---|---|
| `planner` | 每批范围与依赖，保留 58 项 | 计划、分配记录 | 需求→批次→测试覆盖，决策和下步工作 | `reality-checker`；拒绝孤立需求 |
| `architect` | Cordis 拓扑、数据和消费方 | 分配的组合/portable 约定与模块 | API、消费方、迁移、恢复和位置决策 | `code-reviewer`；拒绝适配器重复业务引擎 |
| `backend-architect` | 提案、Mesa、应用与发布 | 分配的 `packages/faberloom/` | 实现与状态、并发、失败测试 | `security-reviewer` + QA；拒绝未批准效果 |
| `identity-access-engineer` | 身份、OAuth、scopes 和工作引用 | 分配的连接/MCP 模块及 DTO 消费方 | actor/资源/操作矩阵、撤销和对抗测试 | `security-reviewer`；拒绝自声明权限 |
| `desktop-app-engineer` | 本地启动、homes、host 凭据 | `apps/desktop/` 和分配的组合 | 干净安装、更新与本地保留 | QA；拒绝关闭集成时的 MWT 流量 |
| `frontend-developer` | 可读 Mesa、连接与状态 | 分配的 `ui-faberloom`、view、locales | 空/加载/错误状态、真实动作和 UI 证据 | `accessibility-auditor` + QA；拒绝未确认成功 |
| `developer-tooling-engineer` | 生成器、适配器、打包和开发命令 | 分配的 portable 模块和 scripts | 产物、清单、能力转换与确定性 | `code-reviewer`；拒绝静默删除限制 |
| `test-automation-engineer` | Harness 与需求派生测试 | 测试、合成 fixtures 和校验器 | 正例、反例、恢复和独立结果 | `evidence-collector`；拒绝复述实现的测试 |
| `security-reviewer` | 独立审查 diff 与替代入口 | 只读，提出修正 | 含严重性、路径、复现和效果的发现 | `reality-checker`；不自证自己修复的缺陷 |
| `accessibility-auditor` | 键盘、读屏、对比度和消息 | 只读与交互证据 | 按控件/状态/实际环境记录障碍 | QA；未测试项保持未证明 |
| `evidence-collector` | 对照回执、持久化、Git、文件、host、网络 | 已脱敏证据，不改 expected | 可复现观察与产物引用 | `reality-checker`；拒绝无关联截图 |
| `devops-automator` | 测试 MinIO、CI、分发与恢复 | 明确分配并授权的基础设施 | 保留、权限、restore 与 CI 证据 | 安全 + 产品；不得推断生产授权 |
| `technical-writer` | 已证明行为的文档 | 分配的 README、指南、支持矩阵和 notes | 验证过的说明与文档对 | `code-reviewer`；拒绝手工目录漂移 |
| `reality-checker` | 基于独立来源判定批次/阶段 | 评估报告 | 按需求给出证明/反证/未证明/不适用 | 产品；不改测试把失败变成功 |

同一 agent 可串行承担多个组件，但不得成为自己授权、持久化、应用器或发布变更的唯一验证者。同模型的另一 agent 提供独立上下文，不等于独立提供方或运行证据。

### 3.2 按工作选择 OpenCode skills

本表规定执行时应加载的 skill，不声称编写本文时已调用全部 skill。按需加载并记录精确 ID，不把整个目录塞入每个 prompt。

| 时机 | 可用 skills | 预期结果 |
|---|---|---|
| 阶段 0 需求与批次 | `intent-driven-development`、`planning-and-task-breakdown`、`api-and-interface-design` | 可观察标准、依赖与组件义务 |
| OAuth、tokens、输入和存储 | `security-and-hardening`、`source-driven-development` | 服务端校验与带日期官方依据 |
| 每个增量实现 | `incremental-implementation`、`test-driven-development` | 小改动及修复前失败的回归 |
| E2E 与比较 | `e2e-testing`、`verification-loop`、`eval-harness` | 真实流程、可复现结果与独立评估 |
| 现有 UI | `frontend-ui-engineering`、`antislop`、`antislop-human`、`antislop-copywriting` | 功能、无障碍和真实状态消息 |
| 浏览器 / Desktop | `browser`、`browser-qa`；适合 UI Automation 时用 `windows-desktop-e2e` | 实际使用应用上的证据 |
| 失败诊断 | `debugging-and-error-recovery` | 复现、原因与局部修正 |
| 审查 | `code-review-and-quality`、`agent-self-evaluation` | 有依据缺陷，自评与外部判定分离 |
| CI 和发布 | `ci-cd-and-automation`、`shipping-and-launch`、`observability-and-instrumentation` | 已运行检查、脱敏信号与恢复 |
| Notes 和交付 | `documentation-and-adrs`、`git-workflow-and-versioning` | 理由、文档与保留原工作的 diff |
| OpenCode 定义 | `opencode` | 对官方文档验证 V2 语法 |

DSH 本地 skills 位于 `.agents/skills/`：按变更选择 `dsh-doc`、`dsh-prose-standard`、`dsh-pre-push-checks`、`dsh-ci-test-reliability`、`dsh-code-review`、`dsh-byok-composition`、`dsh-shared-key-guard`。通用 skill 门槛不得降低 DSH 的逐文件 100% 要求。`skills-catalog/`、`skills-shared/`、`agents-shared/` 是产品内容，不等于 OpenCode 会话可用目录。

### 3.3 调用与并发控制

2026-11-05 已查阅 [V2 agent 定义](https://opencode.ai/v2/docs/agents)和 [V2 skills](https://opencode.ai/v2/docs/skills)。开始时复用现有 ID 即可。如需项目级持久配置，阶段 0 定义 `.opencode/agents/<id>.md`、`mode: subagent` 和 V2 权限；不虚构模型，不安装全局配置。

操作约定要求每文件只有一名写入者。并行前协调者固定 API 和共享文件所有者；需要扩展时返回约定变更。QA 可并行准备独立 fixtures。协调者集成后重算影响范围并运行受集成影响的测试。

审查 prompt 不授予写权限。只读分配须通过 OpenCode 有效权限限制编辑与变更命令；通用 shell 可绕过编辑器禁令。证据审查者只需读取授权输出。每批默认允许一次修正与一次重验；同一性质第二次失败必须诊断和拆分，不得无限循环。

## 4. Archivos y responsabilidades

以下路径相对 `deepseek-harness/`。`E` 指已检查的现有位置；`N` 指在相应批次拟建的文件/模块。表中的新名称不证明已经存在。

最终 E/N 映射（含每条路径的负责人、集成者与消费方）位于 `scripts/faberloom-portable/owners.json`；本表保留按领域的范围。共享路径只有一个集成者，不能并行编辑。

| 领域 | 现有基础（E） | 拟新建（N） | 负责范围 |
|---|---|---|---|
| MCP | `packages/faberloom/mcp-server/src/{spec,index,tools,protocol}.ts` | `src/proposal.ts`、`src/work-reference.ts` 和同级 tests | Tokens、传递、独立操作与直接调用拒绝 |
| Mesa | `packages/faberloom/board/src/{index,classify,keys}.ts` | `src/knowledge-approval.ts`、人工批准案例 | 绑定人工动作，提案不自动产生效果 |
| 展示 | `packages/faberloom/view/src/{index,types}.ts`；`packages/client/ui-faberloom/src/client/{components,panels,store,locales}.ts*` | 现有组件不适合时新建提案/状态组件 | 授权视图、不可信 diff 和恢复 |
| 本地 | `apps/desktop/src/`；`apps/desktop/src/product-mcp.ts` | 本地身份模块与干净 home 测试 | 持久身份、数据分隔、显式提供方 |
| 继承 | `packages/faberloom/spaces/src/index.ts`；现有上下文与记忆 | 逐贡献授权案例 | 导出前统一上下文与记忆语义 |
| 生成器 | `packages/faberloom/harness-projection/`；`scripts/validate-kb.mjs` | `packages/faberloom/portable/` | 模型、解析、清单、校验与纯适配器 |
| 发布 | Mesa、FaberLoom 持久化与执行 | `packages/faberloom/publication/` | Git 应用器、持久状态、MinIO、激活与授权读取 |
| 连接 | `packages/faberloom/connections/`；MCP 注册和 Desktop | 0.3 验证的所有者中的 OAuth 模块 | 分离 FaberLoom/MWT 连接，不重复身份 |
| 验证 | `scripts/run-gates.ts`；Vitest 配置、现有 tests/snapshots | `scripts/faberloom-portable/{requirements.json,check-plan.ts,check-plan.spec.ts,compare.ts,compare.spec.ts,run.ts,run.spec.ts}` | 可追踪性、受限执行与比较器 |
| E2E 组合 | `apps/cli/tests/profiles/`；snapshot 支持 | `apps/cli/tests/profiles/faberloom-portable.spec.ts`；`faberloom-portable-*` 场景 | Launcher 启动与真实服务验证 |
| Fixtures | 各所有者的 `tests/` | `packages/faberloom/portable/tests/fixtures/` 及发布 fixtures | 合成数据、经审查 expected manifests 与失败 |
| 证据 | `.artifacts/` | `.artifacts/faberloom-portable/<runId>/` | 执行结果；共享前脱敏私有日志 |
| 文档 | 本计划、包 README、FaberLoom 指南 | 提案 note、各批决策和 portable 格式参考 | 按所有者更新，目录从代码生成 |

`portable` 初始集中模型和纯适配器；`publication` 集中共同演化的服务、提供方和消费方。只有替代消费方证明有独立需求才拆出 MinIO 提供方。每个新包按[新增包](../cookbook/adding-a-package.zh.md)要求提供 manifest、tsconfig、README、exports、组合和测试。不为生成文件另建独立服务器。

每批列明相对此表的增量。如逻辑涉及超过五个不同职责文件，将实现拆为同批下的子任务；tests、README、pairing 和 manifests 跟随所有者。这些子任务保留原需求，不提前关闭批次。

## 5. Harness de verificación y comparación

拟建 harness 属于 monorepo 并使用其 runners，防止不完整绿色测试、遗漏测试或模型自述被当作验收。0.4 只定义规范。构建属于首个获授权代码批次（1.1 或 2.1）的前置任务 H0，由唯一 QA 所有者负责，评估实现前必须完成。因此阶段 0 仍只改文档。

H0 自 1.1 起存在：`requirements.json` 是登记，`check-plan.ts` 校验覆盖与新鲜度，`compare.ts` 按摘要比较目录树，`run.ts` 写入 `run.json` 与 `results.json`（含退出码、耗时与计数）。超时、非零退出、零测试或计数不符的命令只会得到 `no-comprobada` 或 `refutada`。

### 5.1 需求与结果登记

`requirements.json` 为 58 个 ID 分别登记来源/章节、义务、阶段、批次、所有者、依赖、正反案例、测试文件、比较器、环境和适用的手动验证。追加保留要求 `REG-*`、约定 `CTR-*` 和 harness 自测 `HAR-*`。记录有 schema 版本；撤销 ID 保留原因和授权，不从分母消失。

每次执行的 `run.json` 记录 ID、UTC 时间、checkout/diff digest、分支/HEAD、平台、Node/pnpm、脱敏 profile/配置、fixture digest、host/生成器/格式版本、授权批次及命令 argv、cwd、exitCode、耗时和测试数量。`results.json` 关联案例、日志/产物和状态。`comparison.json` 保存前后差异及分类。`review.md` 标识审查者、发现与人工继续决策。

允许状态：`demostrada`、`refutada`、`no-comprobada`、`no-aplicable`。Skip、timeout、命令缺失、环境不可用、零选中测试或产物不完整只能得到未证明或反证，不能得到已证明。不适用需要适用性规则、负责人、理由和认可，不可借此删除已承诺 host。

### 5.2 环境与 fixtures

| 级别 | 组合 | 数据与观察 | 证明范围 |
|---|---|---|---|
| L0 | 纯校验器/比较器 | 有效/无效输入和完整语料 | 可追踪性和真实检错能力 |
| L1 | 真实服务，仅替换网络/时钟/模型 | ORG-A/ORG-B；ORG-A 内 A1/A2；ORG-B 内 B1；父 P 与子 H | 权限、幂等、继承与持久化 |
| L2 | 测试 DSH profile 经 launcher/Loader | 临时 home/Git、两个 actor/会话、真实重启 | 集成、组合、状态和外部世界保留 |
| L3 | checkout 外构建并安装的产物 | 空格/Unicode 目录、Windows 和声明平台 | 依赖闭包与安装后行为 |
| L4 | 非生产 MinIO/OAuth 与获授权真实 host | 独立客户端与非管理员账户 | 外部集成、权限、撤销和实际加载 |
| L5 | 获批准的人员与试点 | 有界任务、授权内容、同意观察 | 理解、效用与真实复用 |

最少 actor：所有者、仅子空间成员、A1 非 A2 成员、多企业用户、无权限第三方、停用用户、技术发布者。加入受限父空间、缺失依赖、排除分类、带 HTML/远程 URL 提案、他人文件和既有计划操作。每次测试生成合成凭据，不复制到 expected 输出。

每个测试拥有其临时端口、目录和进程，并记录失败时清理。中断测试在 L2 真实杀死/重启进程；模拟异常的 unit test 只是补充。Windows 覆盖锁定、大小写、Unicode、UNC、链接和 junction；Linux 保留 POSIX 语义。跳过的平台在获得证据前不进入认证。

### 5.3 独立比较器

| 比较 | 前 / 后 | 独立判定依据 | 阻塞差异 |
|---|---|---|---|
| 需求 | 原始+当前包 / 批次登记 | 抽取 ID 和原章节 | ID 缺失、重复、无所有者或无测试 |
| 权限 | 授权矩阵 / `tools/list` 与直接调用 | 按 actor/操作定义 expected，也到 executor | 列表隐藏但越权可执行 |
| 接收 | 请求/键 / 回执 / Mesa 持久记录 | 授权人工读取与测试 storage 查询 | ID 无条目、重复或替换其他条目 |
| 应用 | 已批准基线/diff / 最终 Git 树 | QA 准备的 expected，包含不可修改文件 | 额外写入、基线改变或 commit 混入他人工作 |
| 生成 | 授权清单 / 最终树与 manifest | 已审查 expected 清单和重算字节哈希 | 丢失依赖、B 内容、秘密或错误哈希 |
| 确定性 | 相同输入的两次干净生成 | 排序树与规范 digest | 未声明的时间/顺序/路径/metadata 差异 |
| 发布 | 批准→commit→对象→激活 | 重读 Git、恢复 MinIO 和持久日志 | 验证前激活、重复或丢失最后有效版本 |
| 上下文 | 发布修订 / 引用 / 已加载内容 | Host 或 request/log 证据，合成见证数据 | 会话中使用 latest，或无证据声称已加载 |
| 本地/MWT | 关闭 / 连接 / 撤销 | 网络连接与工具清单，另行读取 home | 关闭时流量、提权 fallback 或本地数据丢失 |
| 更新 | 用户先前树 / 安装或卸载 | 外部计算非管理文件/块哈希 | 丢数据或静默覆盖手工编辑 |
| 目录 | 源定义 / 生成文档 / 按 actor 的 runtime | 名称、schemas 和有效权限 | 文档声称可访问的工具实际不可访问 |

不得通过归一化私有路径、授权错误、身份、修订或内容差异掩盖失败。允许规则只涉及已声明非语义字段，例如临时端口；每条规则需测试它仍保留有意义差异。生成器作者不得未经 QA 审查更新比较器 expected。

### 5.4 Harness 自测

| ID | 故意加入的负面控制 | 必需结果 |
|---|---|---|
| HAR-01 | 从登记删除必需 ID | 非零退出码并指出 ID |
| HAR-02 | 选中零测试或模拟无凭据 skip | 关闭状态为未证明，不只看 exitCode 零 |
| HAR-03 | 修改文件或 expected 清单一字节 | 比较器指出路径和 digest 差异 |
| HAR-04 | A1 混入 A2 内容且仅在列表隐藏工具 | 导出与直接调用分别失败 |
| HAR-05 | 在隔离 mutation fixture 移除人工验证 | PROP-09 失败；恢复 mutation，不进入交付 |
| HAR-06 | commit/上传/激活后中断再续跑 | 检出重复/虚假状态，只恢复一次转换 |
| HAR-07 | 使用其他修订证据或无日志结果 | 拒绝过期或无关联证据 |
| HAR-08 | 未授权同时修改 baseline/expected 与实现 | 审查发现变更并阻止自动验收 |

这些 mutation 在带明确 diff 的测试 fixtures/worktrees 中进行，不修改用户 checkout 或真实策略。LLM 评估摘要可辅助审查，但不决定权限、哈希或效果是否存在。

### 5.5 命令与测试选择

以下命令安排在已授权批次中，列出并不证明执行。应从仓库根目录运行，先确认固定包管理器和已有依赖。`pnpm` 不在本会话 PATH 中，但 `corepack pnpm` 按 `packageManager` 声明的版本解析，无需全局安装；示例命令保留短形式，执行记录登记实际调用。

```powershell
git status --short --branch
git rev-parse HEAD
node --version
pnpm --version
pnpm exec vitest run packages/faberloom/mcp-server/tests/mcp.spec.ts
pnpm exec vitest run packages/faberloom/board/tests/board.spec.ts
pnpm exec vitest run packages/faberloom/spaces/tests/spaces.spec.ts
pnpm exec vitest run packages/faberloom/view/tests/approvals.spec.ts
pnpm run test:gui
pnpm run typecheck
pnpm run lint
pnpm run test:docs
pnpm run doc-sync
git diff --check
```

只选与该批差异有关的命令。覆盖率分别选测试和受影响源，保留仓库门槛。Snapshot 使用真实 driver 文件和场景 `-t`，不得插入使过滤失效的 `--`。检查选中数量。`test:expected` 覆盖非 replay 进程；`test:snapshot` 覆盖会话；`test:web` 覆盖浏览器；生成器输出留在所有者的 `tests/expected/`，不放入会话树。

拟新增 `package.json` 命令 `verify:faberloom-portable` 负责追踪/比较，`test:faberloom-portable` 负责场景 runner。Runner 接收 `--wave`、`--run-id`、`--evidence-dir`，按登记验证值，不从提案文本构造 shell 命令。在首个获授权代码批次的 H0 中创建和测试后，才可将这些命令写为可用。确定性检查纳入 `scripts/run-gates.ts`；账户集成使用独立通道，缺条件时如实记录。

CI 按范围保留逐文件覆盖率、lint、类型、build、hygiene、组合、snapshots 和平台矩阵。本地绿色不代替原生 Windows 通道或 host 认证。`check:windows-wine` 不作为常规替代，它留给诊断和 CI。

## 6. Fases y olas

每批以可验证交付结束。新命名 tests 与行为一起创建，并在描述或登记中保留第 7 节 ID。恢复仅影响该批输出，保留数据与历史。产品决策必须在依赖它的效果发生前解决。

### 执行状态

更新于 2026-11-05。只有交付已存在于代码树且测试已执行，批次才标记为完成；逐项状态保存在 `scripts/faberloom-portable/requirements.json`，由 `pnpm run check-faberloom-portable-plan` 校验。

| 批次 | 状态 | 交付与证据 |
|---|---|---|
| 0.1 | 完成 | `baseline.json` 以 SHA-256 冻结六个文件；`requirements.json` 分配 58 个 ID；计划摘要可发现偏差 |
| 0.2 | 完成 | D01–D05 与 D08 在 2.2.1 解决；流程与权限矩阵已固定 |
| 0.3 | 完成 | `owners.json` 固定 33 条路径的负责人、集成者与消费方 |
| 0.4 | 完成 | H0 已在 5.1–5.4 定义，未提前实施 |
| 1.1 | 完成 | H0 已构建；批准证据绑定修订与哈希；mirror 不传输裁决；PROP-09 与 HAR-05 |
| 1.2 | 完成 | `faberloom_proposal_submit`；公司/owner/空间/键命名空间；确定性 id 与持久声明；PROP-01 至 PROP-06 与 PROP-08 |
| 1.3 | 完成 | 按指纹管理 token；提案独占；`spaceId` 重新校验并传播；HTTP 与 `request()` 共享认证；AUTH-04、CON-02 与 PROP-09 |
| 1.4 | 完成 | 带 PKCE 与同意的本地 OAuth；一次性事务/授权码；按连接/空间/修订的工作引用；CON-01/03/04 与 UX-01 |
| 1.5 | 完成（本地 Git 读取器） | 无活动 HTML 的提案卡；diff、原因、范围、证据与版本；真实批准/拒绝；按引用固定版本的发布读取器；PROP-10、UX-03 与 UX-04；UX-05 等待 4A.3 的人工验证；3A.4 的 MinIO 仍开放 |
| 2.1 | 完成 | 本地模式持久化、home 身份、无账号启动、home 位于非同步文件夹；BASE-01 |

### 阶段 0：流程、约定与准备

结果：团队与用户明确范围、首个增量及验证方式。输入：完整资料包和本阶段具体授权。主要负责人 `planner`；审查者 `architect`、`security-reviewer`、`reality-checker`。

#### 批次 0.1：固定基线并保留需求

1. 输入：六文件、仓库规则、Git 状态和既有测试目录。分配 `planner`、`evidence-collector`。
2. 新建：含文件哈希的阅读清单、58 需求初始登记及原第 1 至 14 节映射。Checkout 身份进入证据，不嵌入持续维护正文。
3. 修改/修正：将差异补入本计划；修正原 PC 路径引用，不把绝对路径复制到 runtime 约定。提供方自述不得当作已检查事实。
4. 验证/比较：递归目录对照清单；原计划→当前计划→批次，包含第二轮恢复项和额外 F01 至 F50 回归。
5. 验收：六文件齐全，58 个唯一 ID 已分配，原范围无丢失，既有变更已登记。审查签署文档覆盖，不签产品认证。
6. 交付/恢复：执行的 `baseline` 和 `requirements`；来源变化时失效相应比较并重算，不删除旧证据。依赖：无。

**状态：** 2026-11-05 完成。`scripts/faberloom-portable/baseline.json` 保存六个文件的字节数、阅读范围与 SHA-256，以及分支和 Node、pnpm、包版本；HEAD 留在执行证据中。`requirements.json` 为 58 个 ID 分配负责人、批次、测试、比较器与环境，`check-plan.ts` 拒绝缺失 ID、未知批次、目录外负责人或标记为 `demostrada` 但不存在的测试。

#### 批次 0.2：决定流程、权威与阻塞事项

1. 输入：0.1、D01 至 D05/D08。分配架构、身份、前端，并由产品审查。
2. 新建：本地/FaberLoom/MWT 身份、分类导出、继承、固定修订、准确批准、发布状态和 13 步流程错误约定。
3. 修改/修正：服务端验证空间选择与单次同意；去除聊天依赖 localhost 和未确认加载承诺。
4. 验证/比较：纸面演练成功、拒绝、取消、源关闭和 MinIO 故障；将每步对照真实 actor/权威。明确同一连接如何用不同权限读取和提案。
5. 验收：阻塞决策有负责人和答案；没有重复可编辑源、账户全局空间或基于模型 claim 的批准。未决事项只阻塞依赖批次。
6. 交付/恢复：版本化决策、流程与权限矩阵；后续约定变更使对应消费方/测试证据失效。依赖 0.1。

**状态：** 2026-11-05 完成。D01–D05 与 D08 已在 2.2.1 解决；D06、D07 与 D09–D14 仍未决，只阻塞其消费方。

#### 批次 0.3：确定代码所有者与 agent 间约定

1. 输入：0.2、真实消费方和可用 D13/D14 资料。分配 `architect`、`developer-tooling-engineer`。
2. 新建：第 4 节最终 E/N 映射、拟议 DTO、`mintToken`/批准/投影消费方清单、agent 分配约定及提案 note。
3. 修改/修正：先复用服务，再批准新包；区分库、插件、bundle；按真实所有者决定 tokens 与发布存储迁移。
4. 验证/比较：API 对照 HTTP、`request()`、view、内部工具、mirror、bridge；共享后审查 `build_faberloom.py`，检查期不执行。
5. 验收：每个跨进程字段有生产方、校验方、消费方和测试；不透明 ID 使用 branded 类型；不为 FaberLoom 业务改 agent-loop。
6. 交付/恢复：批准的映射、持久变更清单和文件独占分工。生成器仍缺失则 D13 保持开放，不声称替代完成。依赖 0.2。

**状态：** 2026-11-05 完成。`scripts/faberloom-portable/owners.json` 固定 33 条路径的负责人、集成者与消费方；共享路径只有一个集成者，不透明 ID 保持 branded 类型。

#### 批次 0.4：定义 harness 并交付首个代码增量计划

1. 输入：0.3 与现有测试选择。分配 `test-automation-engineer`，审查 `evidence-collector`。本批保留当前资料包的纯文档范围。
2. 新建：H0 规范，包含证据 schema、HAR-01/02/03/07/08 数据，以及未来 `scripts/faberloom-portable/requirements.json`、`check-plan.ts`、`compare.ts`、`run.ts` 和三个 specs。H0 拆为三个单所有者任务。
3. 修改/修正：只改规划文档；定义未来 `package.json`、`scripts/run-gates.ts` 增量，不实施。明确 skip、零测试、缩减语料、过期证据如何阻止验收。
4. 验证/比较：静态审查正反例、登记对照资料包、比较器约定。在 H0 规定真实执行、timeout 清理和数量，不能声称已经执行。
5. 验收：H0 档案可供授权，判定依据要求删除需求、修改字节、结果无证据时非零失败，并定义完整正例。实现与测试留待首个获授权代码批次。
6. 交付/恢复：文档层面关闭阶段 0，交付含 H0 的首增量范围。仅文档回退，不一致则退回约定审查。依赖 0.3；可申请 1、2 与 3A 设计工作。

**状态：** 2026-11-05 作为文档交付完成。H0 规范连同负面控制留在 5.1–5.4；构建属于 1.1，本批未提前实施。

### 阶段 1：按空间提案与连接

结果：用户连接 host，收到真实提案并无需操作 token 即可审查。要求阶段 0 以及批准/分类决策；使用远程 OAuth 前必须解决 D07。

#### 批次 1.1：在领域操作中强制知识人工批准

1. 输入：0.3 入口映射。`backend-architect` 实施，`security-reviewer` 独立审查。
2. 新建：H0 尚不存在时先完成并执行其负面控制；再按需创建 `board/src/knowledge-approval.ts`，绑定条目/修订/hash 的人工动作测试及全部批准变体矩阵。
3. 修改/修正：`board/src/index.ts` 批准操作、view/MCP、本地工具和内部路径。凭证由服务器根据人工会话签发/验证；不接受 `human: true`、owner、宽 scopes 或模型 actor。本批先定位 import、restore 与复制的写入路径：阅读 `mirror/src/sync.ts` 未发现 `approve` 或状态引用，因此确认实际写行的模块后，规定其不得在未验证时引入权威编辑知识批准，即使不调用 `approve()`。
4. 验证/比较：PROP-09 覆盖 HTTP、`request()`、新旧 tokens、mirror、bridge、单个/批量批准、已批准行导入和内部调用；人工正例具备请求保护与权限。HAR-05 证明移除控制会被检出。Restore 保留可验证决策，不产生新的人工证明。
5. 验收：任何变体都不能无准确人工动作批准知识；重放、基线/hash 改变被拒；其他 Mesa 类型保留已定义策略。
6. 交付/恢复：领域控制与入口报告。关闭本批前应用器保持停用；任何路径失败不得启用自动应用。依赖 0.4。

**状态：** 2026-11-05 完成。`packages/faberloom/board/src/knowledge-approval.ts` 写入绑定所批准版本与哈希的证据；条目表把证据缺失或不匹配的批准降为 `PENDIENTE_CRITERIO`，包括 `state: null` 且 `status: 'approved'` 的旧行；mirror 只传输工作、不传输裁决（`REPLICATED_DECISION`）。批准要求 writer 带 `kind: 'human'`；工具与 MCP 路径作为 agent，以 `HUMAN_ACTION_REQUIRED` 被拒，因此模型不能批准自己的提案。`tests/knowledge-approval.spec.ts` 覆盖 PROP-09 与 HAR-05，包括导入已批准行、重新校验后再批准与拒绝 agent。

#### 批次 1.2：独立提案入口与持久幂等

1. 输入：1.1 与提案约定。后端实施，QA 准备独立 expected。
2. 新建：`mcp-server/src/proposal.ts`、接收/并发案例和显式 `propuesta-conocimiento` 分类规则。字段为 `archivo`、`versionBase`、`cambio`、`motivo`、`evidencia`、`claveCliente`、`title`，限制需批准。
3. 修改/修正：`tools.ts`、`protocol.ts`、`board/src/{index,keys,classify}.ts` 及消费类型。身份 namespace 规范包含企业/owner/空间/客户端键，也写入 `sourceRef`；存储插入和去重必须原子，不仅是进程 Map。
4. 验证/比较：PROP-01 至 PROP-06、PROP-08；两个进程、持久化后响应前重启、同键异内容、计划条目碰撞。直接调用 executor 同样拒绝权限字段。
5. 验收：准确成功 `{ recibida: true, id }` 对应一个待审条目；异键保留两个提案；同内容重试不重复，异内容冲突不泄露他人条目。待审不进入索引、上下文、teaching 或效果。
6. 交付/恢复：持久接收和旧条目完整证据。失败保持未确认或允许同键重试，不替换旧条目。依赖 1.1。

**状态：** 2026-11-06 完成。`mcp-server/src/proposal.ts` 发布 `faberloom_proposal_submit` 工具，包含七个字段及其上限；`board.submitProposal` 在 executor 再次校验，把公司/owner/空间/键命名空间写入 `sourceRef` 并派生确定性 id，以该 id 加持久 `idem`/`bkey` 声明完成去重。完全相同的重试返回 `{ recibida: true, id }`；不同内容，或已持有该键的活跃条目，返回 `PROPOSAL_CONFLICT` 且不触碰前一行。`propuesta-conocimiento` 有自己的 LOW/N2 规则。测试覆盖 PROP-01 至 PROP-06 与 PROP-08，包括同一介质上的重启、并发、与已计划条目的碰撞，以及权威字段。

#### 批次 1.3：演进 tokens 并把范围传到 executor

1. 输入：1.2 和完整 `mintToken` 消费方清单。身份实施，安全审查。
2. 新建：旧 token 迁移/读取、提案独占权限、成员资格丢失案例；不用真实秘密。
3. 修改/修正：`mcp-server/src/{spec,index,tools,protocol}.ts`、DTO、`view/src/{index,types}.ts` 和 UI。加入可选 `spaceId` 并明确 legacy 语义；签发/使用时重新验证用户/企业/空间，经 HTTP 和 `request()` 传递。重设计当前完整 token 列表暴露，使引导连接不向模型/诊断交付 token，并显式迁移 legacy 消费方。
4. 验证/比较：AUTH-04/06、CON-02、PROP-09；列表对照直接调用/executor。覆盖 manipulated scopes、撤销、无父访问；必要时更新持久类型变更确认。
5. 验收：提案 token 仅可执行 `faberloom_proposal_submit`；读取 token 不提案；legacy 不绕过人工批准；消费方不得丢范围或从不可信 payload 获企业。
6. 交付/恢复：兼容表及迁移演练。失败则停发新型 token 并撤销测试 token，保留记录与持久版本。依赖 1.2。

**状态：** 2026-11-06 完成。列表返回指纹（`id`），绝不返回 bearer；签发只交付一次密钥。`spaceId` 可选且旧语义显式（`null` = 覆盖整个 home 的 token），要求令牌只携带提案工具，签发时与每次使用时都向 Spaces 重新校验，并一路传到 `submitProposal`。提案 token 只能携带 `faberloom_proposal_submit`；存储的 scope 列表若混合它或命名未知工具则拒绝，而已退役的 scope（`faberloom_board_review`）被忽略以不破坏旧令牌。HTTP 路径与 `request()` 共享同一校验。`mcpTools()` 从服务器目录供给面板。测试覆盖 AUTH-04、CON-02 与 PROP-09、AUTH-06 的新操作半部分（活动操作处理仍在 5.3）、已撤销 token、被篡改 scopes、空间访问丢失与成员移除。

#### 批次 1.4：连接 host 并按会话固定工作引用

1. 输入：1.3、D07 和已决的 D02（2.2.1，本批限于本地端点）。身份与前端实施。
2. 新建：单次授权事务、绑定用户/连接/空间/修订的引用及读取权限授权。OAuth 集成到 0.3 确定的所有者。发布内容传输由 3A.4 交付，本批不声称已经实现。
3. 修改/修正：MCP、连接与 UI 选择。验证 PKCE、精确 redirects、issuer、resource/audience、过期与 scopes；提案 token 不升级为通用凭据。不把 MCP 会话当聊天，也不保留全局活动空间。
4. 验证/比较：CON-01 至 CON-04、AUTH-04/08、UX-01 的授权部分；重复/取消/篡改 callback、双标签、A1/A2 双引用和交叉权限拒绝。同连接实际读字节与提案的强制测试在 3A.4 后的 1.5 完成。
5. 验收：浏览器授权无需复制秘密；每次调用复核引用/成员；选择 A2 不改变 A1 目的地；UI 显示实际授权空间。对远程服务的试验属于开启 D02 的批次；本增量使用本地连接。
6. 交付/恢复：已证明连接器和脱敏事务记录。取消按约定消耗/失效事务并返回空间；即使客户端保留引用，撤销也阻止新操作。依赖 1.3。

**状态：** 2026-11-06 完成。MCP 服务器充当本地授权服务器：`/authorize` 校验本地客户端、精确 loopback redirect、PKCE S256、`resource`/受众与 scopes；等待页显示空间与 scopes，批准发生在已登录面板（`decideAuthorization`）而不是页面。事务与授权码均为一次性且会过期；`/token` 兑换授权码，签发带过期时间、授权空间和绑定连接/空间/修订的工作引用的令牌。每次调用必须在 `x-faberloom-work-reference` 中携带引用，并重新校验空间与成员资格；A1/A2 两个引用不会交叉。取消会消耗事务并返回 `access_denied`；撤销引用或令牌会切断调用。公共 bridge 转发 `x-faberloom-work-reference`，因此 OAuth 令牌也可经网关工作；待处理请求按 owner 与客户端限制（`maxPendingAuthorizations`，默认 5），过期请求会被清除。D07 已由 Authentik（`idp.mwt.one`）解决：`Claude MCP` 客户端发布 OIDC metadata、RS256 JWKS 与 loopback redirect；FaberLoom 本次仍使用本地端点（D02）处理 loopback，本地服务器的联合属于 5.1。

#### 批次 1.5：可读提案与可核实状态

1. 输入：1.2 至 1.4、3A.4 的真实读取器和已定义状态。前端实施，无障碍与证据审查。
2. 新建：提案卡、连接/版本/待办状态面板、UI 测试与错误流程。复用既有控件和 slots。
3. 修改/修正：`view/src/{index,types}.ts`、`ui-faberloom/src/client/{components,panels,store,locales}.ts*` 及 MCP 目录所有者。展示 diff、原因、证据、范围；内容不可信，禁止活动 HTML 和自动远程加载。
4. 验证/比较：PROP-10、UX-03/04/05、空/加载/错误、键盘；UI 回执对照持久条目。在初始 host 用同连接证明真实发布读取与提案，同时满足 CON-02/04。链接显示 URL 且不携带凭据请求；运行受影响 view/UI tests 和组合 snapshot。
5. 验收：批准/拒绝真实执行；服务端重新授权；连接授权不标为内容已加载；文本属于 locales，用户无需技术结构也可理解卡片。
6. 交付/恢复：阶段 1 演示、矩阵、源生成目录。出错保留草稿并提供重试；不启用未认证发布也能人工审查。依赖 1.4、3A.4，不可用读取器替身关闭阶段 1。

**状态：** 2026-11-06 以本地 Git 读取器完成；3A.3/3A.4 的 MinIO 恢复仍开放，未以模拟代替。Mesa 从持久条目投影提案——文件、基础修订、原因、范围、逐行 diff、证据与版本——并作为文本渲染：没有活动 HTML，也没有远程加载；测试确认内容中的 `<script>` 或链接不会创建可执行节点。批准与拒绝复用 Mesa 控件，服务端重新校验权限与状态。`faberloom_publication_read` 用本地 Git 读取工作引用固定的提交，绝不读取移动分支；路径必须相对，上限 1 MiB，返回 SHA-256；缺少引用或未配置仓库时拒绝。读取令牌不能提案，提案令牌不能读取（CON-02）。使用临时仓库的端到端测试读取固定修订并从同一引用提交提案；当安装提供本地发布时，与该修订不同的 `versionBase` 以 `PROPOSAL_BASE_MISMATCH` 拒绝。详情出错时保留草稿并提供重试。UX-05 的人工验证——解释改动并无需读取 JSON 即可决策——留在 4A.3；卡片已用标签展示字段，不含技术结构。

### 阶段 2：无 MWT 账户的完整本地 home

结果：有用、持久、隔离的本地工作。依赖阶段 0 的身份/home/提供方约定；若不共享文件，可与阶段 1 并行。

#### 批次 2.1：分离本地启动与远程身份

1. 输入：已决的 D08（2.2.1）和 Desktop 启动映射。Desktop 实施，架构审查。
2. 新建：若这是首个获授权代码批次，先与 QA 完成 H0；再建稳定本地 home 身份、显式模式选择、干净安装/重启测试。创建前确认 `apps/desktop/src/` 内模块所有者。
3. 修改/修正：`apps/desktop/src/{main,identity}.ts`，确认后新增 `local-identity.ts`、`home-selection.ts`。更新 token 或 provision MCP 前先解析模式/home。不复用会启用 mirror 的远程 `writeIdentity()` 来创建本地身份。按受支持路径启动后端，保留既有数据 ownership。
4. 验证/比较：BASE-01、AUTH-08，覆盖新 home、既有远程 home、他人目录、取消与重启；比较原数据 ownership/bytes。
5. 验收：无需 Consola 账户可建 Workspace、Space、subspace；身份/权限跨重启；他人 home 数据不出现也不自动导入。
6. 交付/恢复：已证明本地启动。恢复 profile 选择保留两个 home，不要求破坏性逆迁移。依赖 0.4；模式与目录规则来自 D08（2.2.1）。

**状态：** 2026-11-05 完成。`home-selection.ts` 记录模式，解析 junction 与映射驱动器，并以 `DSH_DESKTOP_HOME_SYNCED` 拒绝 OneDrive（含 `OneDrive - <tenant>`）、Dropbox 或网络共享内的 home；`local-identity.ts` 创建稳定身份，文档存在但不可读时拒绝轮换，且不写 `desktop-identity.json`。`main.ts` 以 `desktop-local.patch.yml`（owner 为本地 id，无共享行）启动本地 Host，在 `.env` 层之上强制 `FABERLOOM_MIRROR_ENABLED=0`，且在该模式下不续期 token 或 provision MCP。`tests/home-selection.spec.ts` 覆盖 BASE-01、重启、模式冲突与 home 隔离。

#### 批次 2.2：通过组合关闭 MWT 与关联服务

1. 输入：2.1 和真实 profiles。Desktop/架构实施，QA 观察网络。
2. 新建：合成继承环境变量/凭据 fixture，以及启动、使用、等待、重启期间连接/工具观察器。
3. 修改/修正：`product-mcp.ts`、`packages/bundle/faberloom-app/cordis.patch.yml`、`apps/desktop-host/src/index.ts`。定义对 CLI/Desktop 都有效的本地 overlay，防止后续层重新启用 MWT、credentials-console、checks-MWT、mirror、bridge、shares 或同步。本地模式不挂载这些连接，仅隐藏或捕获错误不合格。
4. 验证/比较：BASE-02、LIFE-01；有效工具/网络对照显式启用 provider/SICOP allowlist；覆盖远程变量已存在及 MWT 服务故障。
5. 验收：声明的观察区间内零 MWT 请求、工具、重试；本地 Mesa/上下文/记忆/routines/workflows 可用；teardown 清除停用连接资源。
6. 交付/恢复：本地 profile 与观察到的缺席证据。发现流量就阻止基础交付并修正组合，不能停用观察来通过。依赖 2.1。

#### 批次 2.3：配置提供方与 SICOP，完成本地任务

1. 输入：2.2、D08 的提供方模式（2.2.1）和授权测试访问。Desktop/UI 实施，证据 agent 验证。
2. 新建：无凭据/断网状态的提供方向导、独立 SICOP 流程、产生持久结果的本地合成任务。
3. 修改/修正：既有配置/locales；凭据使用 host 安全机制，产物无共享 key。SICOP 失败不阻止启动，不把未执行操作标为成功。
4. 验证/比较：BASE-03/04 和本地回归：任务→提案→Mesa、上下文/记忆、提供方缺失、SICOP 故障、重启。在模型会话之外重读本地结果。
5. 验收：无 MWT 用户完成任务，理解网络/推理要求，故障后保留数据。客户端未配置 auth 不等于 SICOP 当前可用。
6. 交付/恢复：带技术/用户证据关闭阶段 2。移除问题配置保留 home；未实际访问的外部依赖标未证明。依赖 2.2。

### 阶段 3A：首个 Git 与 MinIO 发布链

结果：合成文档和 skill 完成应用、生成、发布、激活、读取。设计从 0 开始，效果依赖 1.1/1.2、已决的 D03 至 D05（2.2.1）和开放的 D06。

#### 批次 3A.1：只应用已批准 diff

1. 输入：1.1 批准、1.2 提案、D03 的 Git 源和授权清单。后端实施，安全审查。
2. 新建：`publication` 应用器、持久应用记录、临时 Git 测试。由服务端清单解析 `archivo`，将目的地/基线/diff/hash 绑定批准。
3. 修改/修正：Mesa→应用器连接，不建第二可编辑源。写入前立刻复核权限、分类、真实路径和基线；竞争变更串行化或条件比较更新。
4. 验证/比较：PROP-07、PUB-02/07：多文件 patch、B 路径、替换 symlink、新基线、并发批准、含他人变更 checkout。最终树对照 QA fixture。
5. 验收：只有批准 diff 进入可识别 commit；不执行内容命令；冲突保留提案，diff 变化须重审。Commit 后崩溃重试不重复 commit。
6. 交付/恢复：用测试效果证明应用器。基线/目的地错误则冲突且零写入；commit 已存在时按持久身份协调。依赖 0.4、1.1、1.2。

#### 批次 3A.2：生成带可认证清单的最小产物

1. 输入：3A.1 授权 commit 与 D04 的导出策略。Tooling 实施，QA 保留独立 expected。
2. 新建：`portable` 的版本化格式、空间身份、编辑修订、最小继承、文件清单、预校验及新的 staging 目录。
3. 修改/修正：与 `harness-projection` 集成但不赋予其原子性；以依赖解析替代 regex 过滤。写前校验路径，所有被覆盖内容完成后计算最终 digest。
4. 验证/比较：文档/skill 的 PKG-01/02/03/04、CTX-01/02、FS-01；相同输入两个目录；metadata/资源/继承中的 B 内容、合成秘密和不存在依赖。增加 CTR-PORTABLE-01：即使同一空间的会话/转录作为资源或依赖，也拒绝并确保未进入产物。
5. 验收：清单完整、哈希可重算、可复现；格式/内容/软件分别版本化。明确规范序列化及 digest 排除字段/签名避免自引用；以下载对象外的信任锚认证 manifest。
6. 交付/恢复：最小产物与按文件拒绝报告。无效 staging 不替换有效输出、不修改源。依赖 3A.1；适用 D04 与 D05（2.2.1）。

#### 批次 3A.3：在测试 MinIO 发布、取回与激活

1. 输入：3A.2、D06、仅服务器持有的技术凭据。DevOps 与后端实施。
2. 新建：发布器、aplicada/publicada/disponible 持久状态、完整对象取回、激活记录与幂等重试。
3. 修改/修正：发布集成与状态视图。上传不可变修订 key，验证取回/完整性/真实性后条件更新激活；客户端不列举 MinIO、不收其凭据。
4. 验证/比较：PUB-01/03/04/05：上传/校验/激活前后中断、对象篡改、错签名、源关闭、发布身份尝试删除/覆盖。对象和激活对照持久记录。
5. 验收：完整取回的修订只激活一次；发布身份不能违反约定保留策略；MinIO 失败仍有最后有效版本。仅版本控制不算不可变性。
6. 交付/恢复：真实测试 MinIO 与恢复证据。D06 未证明则阶段保持开放，即使替身测试通过。依赖 3A.2。

#### 批次 3A.4：交付固定修订并证明完整恢复

1. 输入：3A.3 和 1.4 工作引用。后端/MCP 实施，QA 验证。
2. 新建：按修订/权限读取、引用仍有效时撤销测试、可用/加载未确认状态。
3. 修改/修正：只读 executor、view、连接。区分发布可用与已观察加载；同一引用后续读取不用 latest。
4. 验证/比较：CON-02/04、VER-01/02、PUB-01/03；比较引用、交付字节、会话/log、发布；runtime 重启后从每个状态恢复。
5. 验收：A1 引用绝不交付 A2 或未显式切换的新修订；撤销阻止新读取；崩溃不重复 commit/对象/激活；未观察加载保持该状态。
6. 交付/恢复：文档/skill 完整 3A 链；只回到兼容且获授权的最后发布，不降级持久格式、不恢复已撤销权限。依赖 3A.3、1.4。

### 阶段 4A：Claude 首个完整循环

结果：提案收到、人工决策、发布、新会话使用改进。要求完成 1 和 3A、有可用 runtime 且 MWT 关闭；不要求先关闭 2。

#### 批次 4A.1：构建并加载首个 Claude 适配器

1. 输入：最小 portable 模型、已认证 manifest、D01 的应用（2.2.1）和重新验证的 Claude 机制。Tooling 实施，架构审查。
2. 新建：`portable/src/adapters/` 中 Claude 适配器、manifest、空间/提案 skills、合成包及 checkout 外安装测试。
3. 修改/修正：资源生成与连接关联，按包位置解析路径。以 host 管理的连接/引用替代共享全局变量；不打包 token 或与 chat/Cowork 不兼容的 `bin/`。
4. 验证/比较：异目录执行 HOST-01、PKG-01、DIST-01、CON-01；清单→包→已加载组件。确认版本、独占数据和授权继承；manifest 验证不等于安装。
5. 验收：Code 加载支持组件并连接本地 runtime；任务前说明不可用能力。无 runtime 时草稿未发送，绝不能模拟 Mesa。
6. 交付/恢复：包及精确 host/version 的加载记录。移除插件、撤销测试连接保留源、提案、修订。依赖 1 和 3A。

#### 批次 4A.2：执行循环并比较各个效果

1. 输入：4A.1、文档/skill fixture、人工用户和另一会话。QA 主导，实现者只修复可复现缺陷。
2. 新建：E2E 场景，model-visible 改动对应 DSH 会话 snapshot，外部 host 日志作为不同证据；回执→Mesa→批准→commit→MinIO→激活→加载比较器。
3. 修改/修正：修正流程中失败的适配器/消费方；接收不确定时保留键，发送至审查期间保留基线版本。
4. 验证/比较：`tools/list`、禁止的直接调用、提案、拒绝、人工批准；PROP-02/06/07/09、PUB-01/02、VER-01、IA-01。模型外重读文件/状态，并确认没有暗中调用其他 AI。
5. 验收：拒绝保持源/发布不变；批准仅改变授权内容；旧会话保持修订，新会话证明新版本；回执对应真实持久记录。
6. 交付/恢复：关联追踪与中断恢复测试。任何一段无证据则循环未关闭，即使聊天回答看似正确。依赖 4A.1。

#### 批次 4A.3：测试最终聊天并观察真实用户

1. 输入：4A.2、D01/D07/D09、开放的 D02 和独立远程环境。证据 agent 与 UX 主导。
2. 新建：实际支持的 web/desktop/mobile 聊天安装/授权/加载证据，以及明确任务和计时方式的可用性观察。
3. 修改/修正：阻碍流程的引导连接、消息、适配。不把 Code 结果当 chat 认证，不用临时隧道连接 home。
4. 验证/比较：UX-01/02/03/05、HOST-03；连接时间、所需帮助、diff 理解和发送/发布失败恢复。与获批准门槛比较，而非开发者估计。
5. 验收：用户在最终应用完成循环，正常流程不用 token/命令；加载记录对应真实修订。不能确认则明确加载未确认，需求保持开放。
6. 交付/恢复：首位用户结果与修正，不泛化易用性。停用问题连接保留工作/修订。依赖 4A.2 和所列决策。

### 阶段 3B：完整生成器、继承与发布

结果：把最小增量扩展到所有可导出组件，并保留控制。要求 3A；声称已替换公布的生成器前必须解决 D13。

#### 批次 3B.1：按贡献授权解析继承与依赖

1. 输入：3A、D05。架构/后端实施，安全审查。
2. 新建：规则/文档/skills 解析器、依赖图、优先级/排除、循环/名称冲突检测，以及同企业私有父空间案例。
3. 修改/修正：`spaces/src/index.ts` 及上下文/记忆消费方；通过授权操作获取数据，不调用无 actor 的 `harness-projection.readUsage()`。未经可见性过滤的标题不能进入发布。
4. 验证/比较：CTX-01/02、PKG-01/02、PUB-06；仅子成员、grant 撤销、不可访问依赖、循环、重复、上下文预算不足；对照贡献 expected，错误不泄露私有名称。
5. 验收：同企业身份不自动授予父贡献导出权；必要依赖不可访问时阻止或显式授权查询。父变更识别受影响子空间，按权限生成修订。
6. 交付/恢复：完整解析与影响矩阵。依赖阻止再生成时保留最后有效发布，绝不静默裁剪上下文。依赖 3A.4。

#### 批次 3B.2：完整路径安全与可恢复更新

1. 输入：3B.1、所有权 manifest。Tooling 实施，QA 使用原生 Windows。
2. 新建：路径规范/校验、staging/替换恢复、手工编辑检测，以及 junction、UNC、Unicode、大小写、等价路径测试。
3. 修改/修正：写入器/投影在删除前检查 ownership 和先前哈希；保留他人文件/块。效果前重验链接/目的地，而非只在开始生成时检查。
4. 验证/比较：FS-01/02/03、PKG-01、PUB-07；文件锁、模拟磁盘满、目的地占用、进程中断、symlink/junction 替换、输出重叠；比较完整树和不可改字节。
5. 验收：源和他人目的地不修改；手工编辑的管理文件产生冲突；始终有可恢复有效版本。不承诺跨卷或同步目录 rename 的普遍原子性。
6. 交付/恢复：相关 Windows/POSIX 恢复证据。仅清理已识别自己所有的 staging，保留旧输出和用户变更。依赖 3B.1。

#### 批次 3B.3：转换组件但不扩大能力

1. 输入：3B.2、既有 KB/skills/上下文/workflows 格式与 D13 审查。Tooling 实施，代码审查。
2. 新建：字段/host 对照表，保留/翻译/有理由省略/拒绝；测试 tools 受限 agent、skill 资源及不支持组件。
3. 修改/修正：适配器/模型，复用既有 parsers 而非重定义格式。清单含最终资源、导出策略、版本和来源；完整 backup 不能作空间分发包。
4. 验证/比较：PKG-03/04、DIST-01、CTR-PORTABLE-01；原型→模型→host 差异需理由。任何适配器不得重新纳入会话/转录。删除 `tools`、重释 `skills` 或把 workflow 转 Markdown 必须拒绝或明确限制，不得自动宣称等价。
5. 验收：最终文件完整覆盖，声明环境下字节可复现；空间身份按约定影响版本/清单。旧生成器消费方保留到迁移已证明，D13 未决就不能声称完全替代。
6. 交付/恢复：转换与兼容报告。拒绝不兼容组件并保留源；可回退适配器选择，但不重发未授权内容。依赖 3B.2，替代还依赖 D13。

#### 批次 3B.4：完成发布、信任轮换与 rollback

1. 输入：3B.3、保留和版本策略。发布/平台实施，安全审查。
2. 新建：所有状态续跑、并发激活、撤回修订、编辑者信任、签名密钥轮换及测试存储恢复案例。
3. 修改/修正：发布持久化、读取器、激活登记；区分恢复存储与重新激活内容。签名 key 已撤销或修订已禁用，不能仅凭哈希相同接受。
4. 验证/比较：PUB-01/03/04/05/06、VER-02；从授权 backup 恢复、验证对象/签名、服务前重新授权；测试旧软件不支持最新修订。
5. 验收：丢失/重启不重复应用/激活，轮换策略明确，rollback 仅用兼容且授权修订。Backup 保留自身领域约定，不代替导出授权。
6. 交付/恢复：完整生成/发布，restore 可复现。不兼容时分发兼容修复或保留当前版本，不降级持久格式。依赖 3B.3。

### 阶段 4B：按应用完成 Claude

结果：逐应用/版本证明支持，涵盖错误与共存。依赖 4A、3B；本试点 MWT 保持关闭。

#### 批次 4B.1：分别关闭 Code、chat、Cowork

1. 输入：4A、3B、带日期官方矩阵。适配器实施，QA 验证 host。
2. 新建：每应用案例、安装/ZIP 机制、已加载/忽略组件清单与独立认证路径。
3. 修改/修正：打包/能力报告。Chat 用远程端点，Cowork 本地能力取决于会话位置，忽略组件不得宣称可用。
4. 验证/比较：每应用 HOST-01/03、CON-01/02、DIST-01；相同任务/预期修订，确认账户/组织权限与连接故障恢复。
5. 验收：每个承诺应用有独立安装/循环证据和版本限制。未测试 host 保持开放，不继承其他结果。
6. 交付/恢复：Claude 矩阵与各版本证据。只停用问题变体及其 grant，保留核心数据。依赖 4A.3、3B.4。

#### 批次 4B.2：共存、更新与上下文加载

1. 输入：4B.1。QA/安全主导 A1/A2、父子和换账户测试。
2. 新建：同连接双会话、双插件启用、恶意提案、会话打开时发布更新等场景。
3. 修改/修正：适配器引用、缓存、加载策略；支持不卸载即停用空间。Host 允许时测量每轮名称/描述和真实内容 tokens。
4. 验证/比较：HOST-02、CON-04、AUTH-08、PROP-06/09、CTX-01/02、VER-01/02、IA-01；测上下文/request 或 host 证据，不以模型自述不知 B 为准。
5. 验收：目的地/授权内容不交叉；host 混入已交付上下文时正式限制该模式，相关隔离要求仍开放。新聊天不证明 ZIP 更新，必须检查安装内容。
6. 交付/恢复：已观察共存和上下文成本。停用不安全组合保留修订/提案，不承诺删除 host 已收到的信息。依赖 4B.1。

#### 批次 4B.3：完善状态、无障碍与用户评估

1. 输入：4B.2、D09、代表性用户。UI/无障碍/证据共享脚本，不提示答案。
2. 新建：连接、选择、发送、审查、更新、断开各控件→动作→状态→恢复矩阵；实际环境键盘/读屏证据。
3. 修改/修正：状态面板、消息/locales，区分发布/加载版本、待办和失败；沿用仓库设计/tokens/slots，不加新视觉框架。
4. 验证/比较：UX-01 至 UX-05；无帮助任务、计时、错误、理解、恢复；组合 web tests 与脱敏 console/network。结果对照约定门槛。
5. 验收：用户理解连接、版本和缺失项；动作可键盘操作，状态与后端一致。理解缺陷和阻塞障碍修正后重测影响范围。
6. 交付/恢复：Claude 完整关闭与残余问题。回到兼容 UI 保留持久状态，不能用标签把待办变成功。依赖 4B.2。

### 阶段 5：同一产物中的可选 MWT

结果：连接、取消、换企业、断开且保留本地能力。要求 2、4B；真实集成前需 D07/D10/D14 和授权环境。

#### 批次 5.1：验证 Consola/IdP 并连接，禁止提权 fallback

1. 输入：D14、真实非秘密 metadata、非管理员测试用户。身份实施，Consola 所有者参与。
2. 新建：按资源的交换/权限约定、grants/缓存清单、联合 OAuth tests。审查 Consola 的 `mcp_device_grant_auth.py`、onboarding/auth、RBAC、签发后才赋予安全结论。
3. 修改/修正：MWT 连接/客户端组合；公有客户端 PKCE 无分发 secret，机密客户端 secret 留服务器。用户失败不得 fallback 到 ServiceToken、gateway key 或更高权限凭据。
4. 验证/比较：AUTH-01/02/03/04、CON-01，错误 issuer/audience/resource/redirect、PKCE、过期会话；比较连接前后软件 digest。
5. 验收：同一软件，身份/企业来自后端，FaberLoom/MWT/MinIO tokens 不交换；host 登录不授予 MWT 权限。
6. 交付/恢复：非管理员集成连接和服务端证据。缺 Consola/IdP 则仅本地约定已证明，阶段 5 开放。依赖 2.3、4B.3、D14。

#### 批次 5.2：分区数据并固定进行中操作身份

1. 输入：5.1、换账户策略。后端/连接实施，QA 比较状态。
2. 新建：热缓存、按账户/企业/空间的 imports/记忆/投影、换连接时待完成操作测试。
3. 修改/修正：缓存键、引用、操作生命周期。选择取消或保留原身份，绝不把 A 的操作用 B 重发。Home 关联远程账户须自愿决策。
4. 验证/比较：AUTH-02/03/08、CON-04；篡改 headers/claims、查询他企业、切换账户、重启；读取 B 的文件/有效上下文寻找 A 合成见证。
5. 验收：无跨分区读取/写入/metadata；操作保留原 principal 或效果前取消；每种情况本地工作仍可用。
6. 交付/恢复：已观察多企业隔离；只失效受影响连接派生状态，已下载数据依访问策略保留，不转为公开。依赖 5.1。

#### 批次 5.3：在活动操作下测撤销与断开

1. 输入：5.2、D10 上限。身份/平台实施，安全从服务器测量。
2. 新建：撤销时钟/控制、不合作客户端、热 JWT/profile/owner cache、停用用户/企业/成员、进行中 bridge。
3. 修改/修正：grants/派生 tokens 失效、teardown、取消、外部效果前复核。停计时器不证明已取消进行中的请求。
4. 验证/比较：AUTH-05/06/07、LIFE-01、过期、合法换网、复制凭据/device_id。从撤销确认测到最后仍可接受操作，包含 gateway 缓存。
5. 验收：有效窗口在批准上限内，无 fallback；断开移除 tools/凭据/重试；已确认效果如实说明，不承诺撤回；每种失败均验证本地能力。
6. 交付/恢复：测量与真实设备限制；撤销新 grants 并关闭 MWT 保留 home，不为恢复服务重新启用已暴露凭据。依赖 5.2、D10。

#### 批次 5.4：关闭受治理写入并迁移 legacy

1. 输入：5.3、MWT 操作清单。后端/tooling 实施，安全及 Consola 所有者审查。
2. 新建：允许直接写入与需 Mesa 写入矩阵、AUTH-09 tests、URL 凭据消费方清单。
3. 修改/修正：新连接 URL 不带秘密；适配消费方并测采用率后另行授权移除 legacy。阻止 MWT、mirror、import 在应用器之外修改受治理编辑知识。
4. 验证/比较：AUTH-09、CON-01、PROP-09、LIFE-01；直接调用、替代入口、诊断、包；按用户比较有效目录前后，每种失败后恢复本地任务。
5. 验收：每项写入有所有者和可执行策略，受治理写入需批准；legacy 只有在约定迁移和采用证据后撤除。文档说明已下载数据和显式删除。
6. 交付/恢复：可选 MWT 关闭；无需重装/删数据即可停用集成，恢复不得使用已撤除的提权路径。依赖 5.3。

### 阶段 6A：可分发 DSH

结果：checkout 外真实安装且 runtime 唯一。要求模型/首 host 稳定，并明确授权本子阶段。

#### 批次 6A.1：准备外部 bundle 与 runtime 兼容性

1. 输入：3B/4B、D12。Tooling/架构实施。
2. 新建：runtime/peers 矩阵、外部分发 manifest，资源及 portable/publication 依赖按批准组合设置。
3. 修改/修正：以 `packages/bundle/faberloom-app/package.json`、`cordis.patch.yml` 为基础，区分内部 bundle 和可安装包要求。Desktop 已有包按管理器要求以 peers 共享身份。
4. 验证/比较：包内容、exports、资源、peers、Cordis 行；`profile-packages`、`runtime-tree`、`prepare-package-set` tests；build/hygiene 和产物加载测试。
5. 验收：不依赖 checkout、不复制/重复挂载保留包；通过支持的 launcher/profile 启动，不兼容时明确失败。
6. 交付/恢复：候选 bundle 与兼容性；撤下问题变体不改变用户 profile/数据，不把分发修复扩大成 runtime 重构。依赖 3B.4/4B.3。

#### 批次 6A.2：安装、更新、移除并保留数据

1. 输入：6A.1、仓库外干净 home。QA/Desktop 主导。
2. 新建：发布/打包产物 smoke、干净安装、已有用户插件/文件的更新场景。
3. 修改/修正：失败的 manifest/资源/说明，复用插件管理器。区分内容 rollback 与可能保留部分变更的插件事务行为。
4. 验证/比较：HOST-01、FS-02/03、LIFE-02、DIST-01；安装→任务→提案→更新→停用→卸载；Workspace/历史前后哈希及不兼容 peer。
5. 验收：单 runtime、有用任务、真实提案；失败更新可按已证明流程恢复；卸载不删个人数据，也不声称自动撤销远程 grant。
6. 交付/恢复：按版本/系统认证 DSH。按现有管理器回退兼容包或修复事务，不承诺其未提供的自动 rollback。依赖 6A.1。

### 阶段 6B：ChatGPT 与 Codex

结果：OpenAI 适配器按选定应用提供支持。要求 3B/4B 与当前官方文档，不继承 Claude 认证。

#### 批次 6B.1：确定 OpenAI 格式、权限与转换

1. 输入：D12、开批时查阅的官方 plugins/auth/desktop 来源。Tooling/身份实施。
2. 新建：`portable/src/adapters/openai.ts`、兼容 schema、打包 fixtures；按验证版本决定根 `plugin.json`/`mcp.json` 与 `.codex-plugin` 兼容。
3. 修改/修正：组件 mapper 与专用连接；区分远程 chat 和本地 Codex，不传递不兼容 agent/hooks，不复用其他 OAuth 客户端 secret。
4. 验证/比较：DIST-01、CON-01/02、PKG-03/04、HOST-01；逐字段转换及每个承诺应用的真实安装证据。
5. 验收：保留限制或明确不兼容；读取/提案权限分离；有效 manifest 本身不代表集成已证明。
6. 交付/恢复：按版本候选适配器；拒绝不兼容安装并保留旧内容，不为掩盖 host 限制改共同格式。依赖 3B.4/4B.3。

#### 批次 6B.2：认证 OpenAI 循环、隔离与维护

1. 输入：6B.1、授权账户/环境、共享 fixtures。QA/证据主导。
2. 新建：任务/提案/批准/发布/新会话、双空间/双会话、更新/断开/卸载案例。
3. 修改/修正：仅受影响适配器/连接；业务修正归核心，并更新其他消费方 tests。
4. 验证/比较：HOST-01/02、CON-03/04、AUTH-04/08、PROP-09、VER-01/02、IA-01、LIFE-02、UX-01/03；使用 Claude 同类效果判定，不要求不同 manifest 字节相同。
5. 验收：提案真实持久、人工批准、新修订加载；无隐藏其他 AI 调用，逐应用发布限制；Codex 成功不关闭待测 ChatGPT。
6. 交付/恢复：OpenAI 矩阵与关联证据；撤销连接/停用适配器保留源/Mesa，只回到兼容格式。依赖 6B.1。

### 阶段 6C：Kimi Code

结果：Kimi 安装与运行，并证明项目作用域。

#### 批次 6C.1：创建 Kimi 转换与安装范围

1. 输入：3B/4B、D12、当前官方 Kimi 文档。Tooling 实施。
2. 新建：`portable/src/adapters/kimi.ts`、manifest、带限制 agent/skills/MCP 映射、全局/项目安装 fixtures。
3. 修改/修正：资源路径和按安装连接配置；全局插件便利性不得当作项目隔离。
4. 验证/比较：HOST-01/02、PKG-01/03、CON-01/02；异目录加载、切换项目、检查 reload 后保留的上下文组件。
5. 验收：官方格式有效且组件实际加载；非等价字段报告清楚；全局/项目范围有证据及限制说明。
6. 交付/恢复：候选 Kimi 适配器；全局混入内容则正式限制该模式，停用不改正式空间。依赖 3B.4/4B.3。

#### 批次 6C.2：认证 Kimi 任务与更新循环

1. 输入：6C.1、授权账户。QA 使用共同任务及独立 A1/A2 引用。
2. 新建：接收、人工批准、新版本、更新失败、reload、卸载案例及有效权限证据。
3. 修改/修正：失败的转换/reload/连接；Mesa/发布业务保留在 FaberLoom。
4. 验证/比较：PROP-02/06/09、AUTH-04/08、CON-04、VER-01/02、LIFE-02、UX-01/03；比较回执、字节、状态和本地文件保留。
5. 验收：有用任务、提案已收到、使用修订可见、认证模式隔离与恢复可复现；模型合理回答不满足任何效果要求。
6. 交付/恢复：按版本 Kimi 支持；撤下问题变体/grant 保留数据和待审提案。依赖 6C.1。

### 阶段 6D：Gemini 或 Antigravity

结果：选定维护中产品的适配器；负面研究结果不等于完成交付。

#### 批次 6D.1：决定产品与官方机制

1. 输入：3B/4B、具体 D12。架构/tooling 调研产品、版本、账户和支持机制。
2. 新建：含日期来源、能力、授权、安装、所选产品与 CLI 差异的兼容记录。
3. 修改/修正：支持矩阵；没有产品决策不得以 Gemini CLI 替代 Antigravity，不按类比虚构 manifest。
4. 验证/比较：授权环境的最小加载/认证测试对照文档；逐能力标记支持、受限、未证明、不兼容。
5. 验收：机制得到证明且具备实施条件；不存在时以阻碍、替代方案、恢复条件关闭研究，但 6D 交付仍待完成。
6. 交付/恢复：批准开工或明确阻塞；不生成伪装兼容的包。依赖 3B.4/4B.3。

#### 批次 6D.2：实现并认证选定适配器

1. 输入：6D.1 正面结果、确认产品/版本。Tooling/身份实施，QA 验证。
2. 新建：以真实产品命名的适配器、fixtures、E2E；skills/agents/MCP 兼容与本地/远程传输按 host 定义。
3. 修改/修正：转换/连接保留限制、固定上下文、无秘密；不存在功能不变成空按钮。
4. 验证/比较：HOST-01/02、CON-01 至 CON-04、AUTH-04/08、PROP-09、VER-01/02、LIFE-02、DIST-01，以及有用任务和更新恢复；效果全部对照核心持久状态。
5. 验收：所选产品安装、任务、提案、更新、卸载均证明，使用前展示限制。
6. 交付/恢复：该 host 认证；移除适配器不改正式数据，必要能力失败则 6D 保持开放并保留恢复条件。依赖 6D.1 正面结果。

### 阶段 7A：真实效用试点

结果：Marluvas 或 Eguisa 的有用改进成为批准知识并被复用。只要求试点实际使用的 host/集成。

#### 批次 7A.1：准备任务并测量参考结果

1. 输入：4B、D04/D11、数据/人员授权；使用 MWT 或其他适配器时要求对应阶段 5/6。Planner 与产品协调。
2. 新建：试点记录，含具体任务、效用标准、允许内容、可比较旧结果、可观察错误、撤回机制。
3. 修改/修正：试点空间配置/导出规则；真实数据复制前修复合成演练发现的问题。
4. 验证/比较：用脱敏 fixture 复演，检查每项资源受众/分类；未改进的初始任务对照业务标准。
5. 验收：人员、数据、host、任务、指标已约定；企业成员资格不推导导出授权。明确是否占用既有 Eguisa 试点同一资源。
6. 交付/恢复：试点准备/排期完成；缺人员/导出则继续合成数据，不能声称 PIL-01 已覆盖。依赖已证明的实际使用能力。

#### 批次 7A.2：复用批准改进并恢复失败

1. 输入：7A.1。真人执行任务，QA 观察记录；除记录的阻塞外不干预。
2. 新建：PIL-01 的任务→解决方案→Mesa→批准→发布→另一任务证据，人工评估效用及结果正确性。
3. 修改/修正：授权范围内可复现流程缺陷；新提案保留修订，内容改变则重审。
4. 验证/比较：PIL-01、UX-02/03/05、PUB-01、VER-01；第二任务用新修订；在授权试点环境制造更新失败并恢复最后有效版本。
5. 验收：改进被复用且业务结果认可，有恢复证据、无泄露。仅更快或赞扬性回答而结果错误不算成功。
6. 交付/恢复：试点报告、发现、分发决策；暂停空间/适配器，保留证据，不删知识、不承诺收回已下载副本。依赖 7A.1。

### 阶段 7B：分发与维护

结果：可安装产品、明确支持、可复现恢复。要求试点和认证能力；生产仍需独立操作授权。

#### 批次 7B.1：准备 release 与按受众划分渠道

1. 输入：7A、已证明 host 矩阵。Tooling/平台实施，安全审查。
2. 新建：版本、兼容、真实性、公有/私有渠道 release manifest；存在时列许可证和声明的可执行程序。
3. 修改/修正：现有打包/release pipeline；通用软件不含私有 KB，内容按空间/受众分发。签名验证信任独立于分发文件。
4. 验证/比较：DIST-01、PKG-01/04、PUB-03/04；构建→分发→安装包比较；logs/reports 不含客户 payload 或凭据。
5. 验收：只宣传已证明 host/功能；hash/签名对应最终字节；无秘密或未声明可执行程序；私有包限授权受众。
6. 交付/恢复：候选 release 和渠道批准；撤回坏版本保留最后有效版本及激活记录，实际发布另行授权。依赖 7A.2。

#### 批次 7B.2：生成可核实文档、诊断与支持

1. 输入：7B.1、已观察行为。技术写作与 QA 维护现有所有者。
2. 新建：逐 host 安装/连接/更新/恢复/卸载指南、支持矩阵、文档对和事件 runbook。
3. 修改/修正：源生成目录及漂移的 MCP/KB/投影/执行文档；诊断区分安装、认证、授权、传输、执行，不含私有数据。
4. 验证/比较：源目录→生成文档→owner/成员/第三方/受限凭据的 `tools/list`；在测试环境执行文档说明；文档 tests、doc-sync、链接验证。
5. 验收：宣传能力均有版本证据，错误说明发生什么/保留什么/下一步；正常流程不要求手动 token，也不隐藏 runtime 要求。
6. 交付/恢复：已验证支持文档；修正说明不重写历史证据；过期指南使受影响支持项保持开放。依赖 7B.1。

#### 批次 7B.3：演练更新、撤回和完整覆盖关闭

1. 输入：7B.2、相关 CI，必要时操作授权。QA/证据执行，reality-checker 判定。
2. 新建：release 档案与恢复演练，涵盖 Git 源、Mesa、发布、配置、信任，并检查兼容性。
3. 修改/修正：仅发现的缺陷和对应测试；不达标版本/系统更新支持矩阵；保留历史 snapshots 和要求的 append-only 迁移。
4. 验证/比较：FS-03、LIFE-02、VER-02、PUB-01/03 及所有适用需求；安装兼容旧版→更新→失败→恢复→卸载；执行孤立需求校验，最终 diff 对照授权。
5. 验收：零无证据必需需求，零未解决严重/高风险发现，所需 checks 通过，恢复已证明。只有实际授权并执行才宣称生产部署；候选 release 不等于部署。
6. 交付/恢复：技术/产品负责人签署、脱敏证据、未交付支持的明确 backlog。失败阻止受影响渠道，保留最后兼容版本。依赖 7B.2。

## 7. Matriz de las 58 pruebas del paquete

本矩阵固定每项义务和主批次。未来实现的每行初始均为 `no-comprobada`。传输、actor、应用、平台变体属于子案例，不作为新需求虚增覆盖率。后续批次影响原案例时复用它们。

2026-11-05 状态：PROP-09 与 BASE-01 依据 1.1 与 2.1 的测试转为 `demostrada`；其余仍为 `no-comprobada`。结果权威是 `scripts/faberloom-portable/requirements.json` 的结构化登记，而非本表，并由 `check-plan.ts` 校验。

| ID | 主批次 | 判定依据与必需结果 |
|---|---|---|
| BASE-01 | 2.1 | 干净 home 无 MWT 登录启动本地，数据持久 |
| BASE-02 | 2.2 | Tools/网络/重试观察确认 MWT 关闭 |
| BASE-03 | 2.3 | SICOP 与自有模型独立工作，无共享 key |
| BASE-04 | 2.3 | 外部失败可恢复，本地服务保留 |
| AUTH-01 | 5.1 | 启用 MWT 前后同一软件 digest |
| AUTH-02 | 5.2 | ORG-A/ORG-B 无跨读取、写入、metadata |
| AUTH-03 | 5.2 | 多企业与篡改选择不混数据 |
| AUTH-04 | 1.3 | HTTP/request/executor 在效果前拒绝禁止直接调用 |
| AUTH-05 | 5.3 | 热缓存撤销在约定窗口内生效 |
| AUTH-06 | 1.3、5.3 | 停用/失去成员资格拒绝新操作，明确处理进行中操作 |
| AUTH-07 | 5.3 | 复制凭据/device_id 与合法换网体现真实限制 |
| AUTH-08 | 5.2 | 换账户不把 A 文件/上下文带到 B |
| PROP-01 | 1.2 | 同内容异键产生两个独立条目 |
| PROP-02 | 1.2 | 同键同内容并发/重启后只有一条 |
| PROP-03 | 1.2 | 同键异内容冲突，不覆盖 |
| PROP-04 | 1.2 | 他人键/权限字段不泄露或改变他人条目 |
| PROP-05 | 1.2 | 业务碰撞不改变计划条目和执行 |
| PROP-06 | 1.2、4B.2 | 代码/自批准保持待审，不进入有效知识 |
| PROP-07 | 3A.1 | 批准后基线变化，零自动应用 |
| PKG-01 | 3A.2、3B.1 | 检出规则、skill、agent、上下文、metadata、资源、继承污染 |
| PKG-02 | 3B.1 | 子空间无逐贡献访问则不导出父私有数据 |
| PKG-03 | 3B.3 | 固定条件下等价输入产生相同清单/digest |
| PKG-04 | 3B.3 | Metadata、身份、内容变化按约定影响版本/哈希 |
| FS-01 | 3B.2 | 重叠、别名、外部链接/junction 写前拒绝 |
| FS-02 | 3B.2 | 他人文件不变，手改管理文件明确冲突 |
| FS-03 | 3B.2 | 中断/锁定保留可恢复最后有效输出 |
| HOST-01 | 4A.1 | 异目录加载正确资源、修订和范围 |
| HOST-02 | 4B.2 | A/B 共存证明隔离，或限制模式并保持需求开放 |
| LIFE-01 | 5.3 | 断开移除 MWT，保留本地数据/能力 |
| LIFE-02 | 6A.2、7B.3 | 卸载不删 Workspace/历史，撤销独立 |
| UX-01 | 1.4、4A.3 | 正常连接零 token 复制、命令、配置编辑 |
| UX-02 | 4A.3、7A.2 | 时间/帮助次数对照批准的连接/循环门槛 |
| UX-03 | 1.5、4B.3 | 用户理解故障、保留工作和下一步 |
| UX-04 | 1.5、4B.3 | 区分已安装、断开、旧版、加载未确认 |
| UX-05 | 1.5、4A.3 | 无需读 JSON 等结构即可解释改动并决策 |
| CTX-01 | 3B.1 | 受限父空间不向子泄露内容、标题、引用 |
| CTX-02 | 3B.1 | 缺依赖/上下文过大则阻止或授权查询，不静默裁剪 |
| CON-01 | 1.4、5.4 | 取消/过期/重复不在 URL、包、日志、模型中暴露秘密 |
| CON-02 | 1.3、3A.4 | 无对应权限则读取与提案互相拒绝 |
| CON-03 | 1.4 | Callback 单次，两并行连接仍验证原选择 |
| CON-04 | 1.4、4B.2 | 两会话各自保持空间/修订，无可变全局状态 |
| PUB-01 | 3A.3、3B.4 | 每步中断后恢复，一次应用一次激活 |
| PUB-02 | 3A.1 | 批准/应用间源变更阻止 diff |
| PUB-03 | 3A.3 | 篡改文件/manifest/签名/身份拒绝整体，保留旧版本 |
| PUB-04 | 3A.3 | 发布凭据不能覆盖/删除受保留策略保护对象 |
| PUB-05 | 3A.3 | 源关闭仍保留批准、说明等待、无重复续跑 |
| PUB-06 | 3B.1 | 父规则变化识别子空间并复核权限生成修订 |
| PUB-07 | 3A.1、3B.2 | 跨路径、隐藏文件、链接变化、并发不能扩大 diff |
| VER-01 | 4A.2、4B.2 | 区分发布与使用，新会话证明新修订 |
| VER-02 | 3B.4 | Rollback 重验权限/兼容，不恢复已撤销内容 |
| HOST-03 | 4B.1 | chat/Cowork/Code 各自组件与连接证据 |
| IA-01 | 4A.2、6B.2 | 调用观察确认无隐藏另一 AI |
| PROP-08 | 1.2 | 超大小/频率明确拒绝，不影响他人提案 |
| PROP-09 | 1.1 | 所有批准、import、替代路径均需准确人工动作 |
| PROP-10 | 1.5 | 打开 HTML/远程图片/恶意链接不执行或传输数据 |
| AUTH-09 | 5.4 | MWT 治理写入不绕过 Mesa，允许直接写入已列举 |
| DIST-01 | 7B.1 | 通用包无私有内容，私有包获授权；两者无秘密/隐藏可执行程序 |
| PIL-01 | 7A.2 | 真实方案批准、发布、复用，效用获认可 |

### 7.1 保留能力回归

F01 至 F50 定义仍由既有清单拥有。执行登记按 ID 导入，根据 delta 判断适用性，提议不适用需审查认可。VPS 手动案例先适配非生产环境；原文字不授权访问 VPS。

| 保留组 | 应考虑的现有测试 | 必需比较 |
|---|---|---|
| REG-SPACE | `spaces/tests/{spaces,reference}.spec.ts`、`context/tests/context.spec.ts` | 空间/子空间、ownership、继承、import/export、隔离 |
| REG-AGENT | `agents/tests/{agents,reconcile}.spec.ts`、`defaults/tests/defaults.spec.ts` | 策略、预算、显式选择/fallback、目录、无他人记忆 |
| REG-MEMORY | `learning/tests/{memory,corrections}.spec.ts` | 修正、候选、晋升、撤销、沿袭 |
| REG-RUN | `routines/tests/routines.spec.ts`、`workflows/tests/{workflows,compile,e2e}.spec.ts` | 固定版本、权威图、等待、编译 |
| REG-EXEC | `execution/tests/{dispatcher,liveness}.spec.ts` | 去重、恢复、效果权限、既有调度 |
| REG-BOARD | `board/tests/{board,board-identity,board-tenant,board-effects,board-checks,board-bulk-shadow,board-e10}.spec.ts` | 保留通用 submit/业务控制，新提案不替代其语义 |
| REG-PROJECTION | `harness-projection/tests/{harness-projection,loader-composition}.spec.ts`、`skill-install` | 用户块、已安装资源，导出另需授权 |
| REG-BACKUP | `backup/tests/{backup,migrations}.spec.ts`、mirror/bridge tests | 完整性/restore/复制不制造未认证编辑知识决策 |
| REG-DESKTOP | `apps/desktop/tests/{identity,product-mcp,main-startup,profile-packages,backend-controller}.spec.ts` | 保留适用远程模式；新本地模式无隐式激活 |
| REG-SESSION | 受影响 session/SDK/ACP/Web snapshots，Session 变更时 Python 投影 | 日志可重构、旧 generation 不变、消费方更新 |

若历史测试期望的正是需修正行为，记录改变的需求并添加后继；不删除 assertions 求绿。逐案例审查有意差异，不整体接受 snapshot 再生成。

## 8. Recorrido completo de validación

以下是集成验收演练，先用合成数据，再在适用处使用授权试点数据。每步以 runId、提案、空间、修订关联证据。

| 步骤 | 动作与外部观察 | 比较条件 | 必须演练的失败 |
|---|---|---|---|
| 1 | 记录环境、HEAD/diff、需求、工具可用性 | 代码/fixtures 身份与执行一致 | 旧证据或 runner 不存在 |
| 2 | 无 MWT 建 home、Workspace、父子空间 | 持久化/权限/网络对照 expected 配置 | 目录不可访问、他人 home 数据 |
| 3 | 独立配置模型/SICOP | 凭据/消费独立，本地服务不变 | 缺 key、SICOP 故障 |
| 4 | 从授权 Git 生成/发布初始修订 | 清单→字节→签名→取回对象→激活 | 私有依赖、污染、MinIO 故障 |
| 5 | 异目录安装适配器 | 按 host 加载组件/资源 | 格式不兼容、runtime 缺失 |
| 6 | 授权读取/提案并选 A1 | 同意/引用绑定 actor/连接/A1/修订 | 取消、重复或替换 callback |
| 7 | 打开 A1/A2 两会话并工作 | 各引用固定目的地/修订，无交叉内容 | 换账户、撤销 grant |
| 8 | 列 tools 并直接调用禁止操作 | Executor 拒绝且无效果 | 宽/legacy/mirror token 尝试批准 |
| 9 | 发送提案，响应不确定时重试 | 回执对应唯一持久条目及 expected hash | 同键异内容 |
| 10 | Mesa 查看前后/原因/证据 | 可审查且无远程加载/执行 | HTML、外部图片、自批准命令 |
| 11 | 拒绝一个，人工批准另一个 | 拒绝不改 Git；批准绑定 diff/base/hash | 重复批准、基线变化 |
| 12 | 应用并在 commit 后中断 | 只有批准文件，重启无重复 | 多文件 patch、链接变化、脏 checkout |
| 13 | 发布/取回/激活，每转换中断 | 一次已验证发布、一次持久激活 | 无效签名、未完整上传、禁止删除 |
| 14 | 比较旧/新会话，内嵌内容时更新包 | 旧会话固定，新会话用新修订字节 | Host 仍使用旧 ZIP |
| 15 | 非管理员连接 MWT，换企业 | 同一产物、数据分区、principal 固定 | 过期 token、改 claims、效果期间切换 |
| 16 | 热缓存下撤销/断开 | 测得窗口、工具撤除、本地可用 | 客户端不合作、bridge 进行中 |
| 17 | 更新软件、恢复、卸载适配器 | 个人文件/历史不变，格式兼容 | 更新中断、peer 不兼容 |
| 18 | 覆盖校验与独立审查 | 每必需需求均有关联案例/证据/判定 | 隐藏 skip、零测试、未审 expected 改动 |

### 8.1 最少演练证据

保留清单、重算哈希、脱敏执行日志、带数量 test reports、持久状态前后、合成源 Git diff、manifest/签名、MinIO 取回证明、激活记录、各身份工具、host 修订确认、UI 截图和用户观察。截图不代替读取存储，日志不代替可用性真人交互。

共享证据不得含 token、cookie、授权码、私有 headers、密码或真实 payload。合成不透明 ID 可用于关联；真实试点档案需限制访问并提供仓库脱敏版本。7A 前与所有者决定证据保留期。

### 8.2 状态与效果协调

每提案联合校验：独占身份、内容 digest、Mesa 状态、有效人工证明、Git 基线、应用 commit、生成修订、验证对象、激活、已观察加载。通知/UI 不得先于其声明的持久提交。Git/Mesa/MinIO 没有共同事务，每步有幂等键和协调状态。

模型 replay 只重复输入，不生成系统 expected 真值。比较器使用 QA 准备的外部效果。Crash 后若效果已发生但状态未更新，下次尝试先按身份核实效果；不能辨别时进入明确协调状态，不盲目重写。

## 9. Evaluación y cierre

评估分开报告计划覆盖、测试执行、产品符合度，避免完整计划被当作完成实现。

### 9.1 每批共同验收条件

- [ ] 所有前置决策已解决，否则明确阻塞。
- [ ] 变更文件属于任务范围，原工作保留。
- [ ] 每需求有正反例；存在状态/效果时有恢复案例。
- [ ] 相关测试已执行，数量、环境、版本可核查。
- [ ] 字节、权限、状态、效果对照独立判定依据。
- [ ] 持久变更有迁移/确认，历史日志不变。
- [ ] 更新消费方、README、类型、生成文档和要求的 snapshots。
- [ ] 独立审查已解决阻塞发现并复核修正。
- [ ] 恢复已测试；无效果批次记录文档回退。
- [ ] 关闭说明下一步并保留全部待办需求。

### 9.2 决策规则

`规划覆盖率 = 有批次、负责人、验证的需求 / 全部登记需求`。资料包案例固定分母 58。`执行覆盖率 = 已执行适用案例 / 登记的适用案例`。`符合度 = 已证明适用案例 / 登记的适用案例`。Skip、环境失败、手动待测不从适用分母排除。

批次通过需所有必需需求已证明，相关文档/技术检查通过。阶段还需批次集成、相关用户演示和恢复。授权、完整性、数据丢失、人工批准或隔离的严重/高风险缺陷阻止关闭，高平均分不能抵消。

| 维度 | 证据 | 验收条件 |
|---|---|---|
| 正确性 | Tests、状态、效果比较 | 适用功能需求已证明 |
| 隔离与权限 | 各 actor/路径反例、导出 | 治理入口不能绕过权限/人工审查 |
| 完整性与恢复 | 真实中断、manifests、restores | 最后有效版本可恢复，无重复/丢失 |
| 兼容性 | Host/SO/runtime、安装产物 | 只有已测试组合获支持 |
| 体验与无障碍 | 用户观察、真实控件 | 达到约定门槛，无阻塞障碍 |
| 保留 | 适用 REG-*、F01 至 F50 | 新适配器不丢原能力 |
| 可维护性 | 所有者、约定、文档、审查代码 | 无重复业务规则、无手工漂移目录 |

各 agent 按准确、完整、清晰、可行动、简洁五轴 1 至 5 自评，给证据和具体改进。自评衡量交付质量，不代替测试或产品验收。`reality-checker` 判定最终证据，产品按授权范围决定继续。

### 9.3 明确停止条件

权限未证明、必需项未证明、跨空间/企业泄露、未批准效果、基线改变、个人数据丢失、内容/hash 无关联、产物秘密、必要依赖缺失、manifest 不兼容时停止依赖工作。创建可复现问题并保留证据，仅继续授权内独立工作。不得缩测试或改 expected 掩盖问题。

## 10. Esfuerzo y coordinación

以下是初始工程工作量估计，不是实测或日历承诺。每人日最多八小时专注工作，含该阶段实施/验证，不含等待账户、决策、环境、人员。0.3 和 4A 关闭后重估。

| 阶段 | 批数 | 初始估计 | 主要不确定性 |
|---|---:|---|---|
| 0 | 4 | 5 至 8 人日 | 约定、消费方、工具可用性 |
| 1 | 5 | 12 至 20 | 批准/import、持久化、host OAuth |
| 2 | 3 | 7 至 12 | Desktop 组合、既有 homes、提供方 |
| 3A | 4 | 10 至 16 | 应用器、持久性、真实测试 MinIO |
| 4A | 3 | 5 至 9 | Chat 限制和用户可用性 |
| 3B | 4 | 10 至 16 | 继承、Windows 路径、组件兼容 |
| 4B | 3 | 7 至 12 | 三类 Claude 应用和代表性用户 |
| 5 | 4 | 10 至 18 | Consola/IdP、缓存、legacy 策略 |
| 6A | 2 | 4 至 7 | Runtime/peers、插件管理器 |
| 6B | 2 | 5 至 9 | ChatGPT/Codex 差异和 OAuth |
| 6C | 2 | 4 至 7 | 全局/项目安装和 reload |
| 6D | 2 | 研究 2 至 4；可行时实施 4 至 8 | 产品/官方机制待定 |
| 7A | 2 | 3 至 6 | 允许数据、人员、真实任务 |
| 7B | 3 | 6 至 10 | 渠道、文档、最终恢复 |

不可直接相加为日历，因为有依赖和部分并行。UX、安全、平台共享同一出口演示。`board/src/index.ts`、`mcp-server/src/index.ts`、组合、`package.json` 每批只有一名集成人员，共享变更按序执行。

无排期、负责人、共享环境信息，无法断言是否与 Eguisa 试点竞争。0.2 协调时登记容量：同一 Consola 操作者、验证人员或测试窗口则串行安排；本地合成增量可并行。7A 使用 Eguisa 需明确任务和优先级决策。

## 11. Entrega entre agentes

以下格式进入任务分配与返回消息，是工作模板，不是可执行 OpenCode 配置。

```text
Asignacion
  ola: identificador de esta referencia
  agente: ID exacto del catalogo
  revisor: ID distinto para decisiones de riesgo
  objetivo: resultado observable
  requisitos: IDs y variantes aplicables
  entradas: archivos, decisiones, revisiones, resultados previos
  archivos_permitidos: lista cerrada; integrador de cada compartido
  contratos: precondiciones, postcondiciones, errores, persistencia
  autorizacion: tareas/comandos/entornos permitidos
  pruebas: positivas, negativas, recuperacion y comparadores
  salida: cambios, logs, artefactos, diferencias y bloqueos
  parada: dependencias ausentes, conflicto o segundo fallo repetido

Devolucion
  estado: demostrada | refutada | no-comprobada | no-aplicable
  archivos_cambiados: lista y motivo por requisito
  comandos: argv, cwd, entorno, exitCode y conteos reales
  evidencia: rutas y digests calculados
  comparacion: cambios intencionales, regresiones, desconocidos
  recuperacion: escenario ejecutado y estado final
  hallazgos: severidad, reproduccion y propietario
  autoevaluacion: cinco ejes con evidencia
  siguiente_ola: precondiciones pendientes y propuesta concreta
```

集成前协调者将返回内容对照 diff 和测试登记。关闭前审查者读取原证据并确认同一代码状态。其他 agent 修正后旧证据保留，但受影响案例标为过期；只重跑这些案例及其消费方。

## Dev Note

本计划是临时提案，不是既有功能权威。准备过程完整阅读资料包，并使用两个只读检查约定：`architect` 负责本地/生成/分发，`security-architect` 负责 token/Mesa/继承/替代入口。报告是静态证据，不是运行或生产认证。

影响实施的主要发现包括 mirror 直接写 Mesa 行、列表完整 token 暴露、Desktop 启动依赖远程身份、选择本地模式前激活远程、投影无 actor 获取标题，分别分配到 1.1、1.3、2.1、2.2、3B.1。生成器分支、Consola、MinIO、真实 hosts 保持未决。每项发现都在其批次开启时确认：`mirror/src/sync.ts` 的阅读尚未定位写行位置，因此 1.1 必须固定该点后才能宣称批准控制已关闭。

2026-11-05 由架构解决了 D01 至 D05 与 D08，详见 2.2.1。它们固定首认证应用与账户、首增量不使用远程服务、按组织的正式 Git 仓库与单一技术 actor、以允许清单排除 CEO-ONLY/N3/N4、逐贡献继承规则，以及 home 位于同步目录之外的提供方模式。D06、D07 与 D09 至 D14 仍开放，只阻塞消费它们的批次。首个代码增量为 1.1 加 H0。

2026-11-05 完成了 0.1 至 0.4 以及 1.1、2.1 两个代码增量。0.1 留下含六个文件哈希的 `baseline.json` 与含 58 个 ID 的 `requirements.json`；0.3 留下 `owners.json`；0.4 留下 H0 规范。1.1 构建了 H0（`check-plan.ts`、`compare.ts`、`run.ts` 及三个 specs），并以可验证证据关闭知识批准：写入绑定修订/哈希的证据、读取时降级、mirror 不传输裁决。2.1 以持久模式、home 自有身份和同步目录拒绝分离了本地启动与远程身份。board、mirror、desktop 与 scripts 的测试通过；L3 干净安装与 L5 试点仍属于 6A 与 7A/7B。

预定提升路径：设计决策进入 `.agents/notes/proposed/`，实施后才进 `implemented/`；格式约定进入 `portable` 所有者文档；发布进入其 README；已验证命令进入用户/开发指南。结构化需求登记在首个获授权代码批次中构建 H0 后成为结果权威；本文保留批次定义，不虚构执行状态。

[验证 Agent Note](../../.agents/notes/proposed/testing/2026-11-05-faberloom-portable-verification.zh.md)记录提案、替代方案及与既有决策的关系。独立 `reality-checker` 发现后已修正 1.4/3A.4/1.5 读取依赖、0.4 纯文档范围、会话/转录显式排除。由于 3A.1 依赖 1.1，也已从 H0 首批候选中移除。

本文档交付验证：自动对照源计划确认全部 58 个唯一 ID、43 个唯一批次，每批六个工作字段。`pnpm run check-faberloom-portable-plan` 还校验每个 ID 的负责人、批次、测试、比较器与环境，计划摘要一致，且没有缺少现存测试的 `demostrada` 行。现有 Markdown 段落、链接/片段、预算和计划 pairing 校验经 `node --import tsx` 通过；Agent Note 格式/分类校验也通过。这不执行拟议 harness 或产品测试。`pnpm` 不在 PATH 中，但 `corepack pnpm` 返回 `packageManager` 声明的版本；`pnpm run test:docs`、`pnpm run doc-sync`、`pnpm run lint` 从该调用执行，结果登记为执行批次的证据。

文档自评，与产品验收分离：

| 维度 | 分数 | 证据与具体改进 |
|---|---:|---|
| 准确性 | 4/5 | 已对照来源/路径；新模块名称仍需在 0.3 关闭时确定 |
| 完整性 | 4/5 | 六文件、43 批、58 案例保留；外部输入仍待补且有负责人 |
| 清晰度 | 4/5 | 目录、依赖、统一模板；执行时提取当前批次以减少阅读 |
| 可行动性 | 4/5 | 每批有变更、测试、验收、恢复；执行前需解决决策/环境 |
| 简洁性 | 4/5 | 所需细节集中一份参考；tickets 只链接批次 ID，避免重复 |

平均 4.0/5。2026-11-05 执行状态：D01–D05 与 D08 已关闭，消费方映射在 `owners.json`，0.1–0.4 完成，1.1/2.1 测试为绿。下一优先级：在已关闭的批准之上开启 1.2，为 3A 环境解决 D06/D07，并在 7B 前执行 L3 干净安装。评分有计数和审查依据，细节程度是否满足仍由用户判断。
