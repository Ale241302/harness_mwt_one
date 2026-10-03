# Agent Note: Work Flow 模块 —— 基于 Space 的图自动化

Status: proposed

[English](2026-10-03-workflow-module.md) | 中文

## 问题

FaberLoom 已经具备自主工作所需的原语——持久的 Space、agent 目录、带调度器的持久 [routines](../../../../packages/faberloom/routines/src/types.ts)、IMAP [inbound](../../../../packages/faberloom/inbound/src/index.ts) 轮询器、每个用户的 IMAP/SMTP 连接、工作台与记忆——但没有任何一个面板能把它们组合成一项自动化、以图的形式查看、从聊天中编辑、共享，并在用户离线时继续运行。今天所谓的 “workflow” 要么是 harness 的代码脚本，要么是步骤手写的 routine；两者都不是绑定到某个 Space 的有向图，因此 spam 分类用例（读取邮件、分类、删除垃圾邮件、记住模式）无法在产品层面被组装、检视或委派。

## 提案

新增原生模块 `ctx.faberloomWorkflows`，其事实来源是一个按 Space 或个人范围划分的、带版本的有向节点与边图。图编译为一个 Routine 并在现有调度器上运行，因此不依赖任何浏览器会话；该模块增加图形编辑器、聊天工具、权限与共享，并复用每个现有模块而非取代它们。

### 图模型

一个 workflow 拥有 `nodes`、`edges`、一个 `definition`、一个 `scope`、生命周期 `status`（`draft`/`active`/`paused`）以及单调递增的 `version`。节点携带可辨识的 `kind` 与按 `kind` 区分的 `config`；边携带可选的 `condition`。校验会拒绝环、不可达节点、未知 kind、格式错误的 `config` 以及指向不存在节点的边。图是事实来源；编译出的 `routineId` 是派生产物。

### 编译为 Routine

`compileWorkFlow(workflow)` 把每个节点映射为一个 routine 步骤、每条边映射为 `dependsOn`、每个触发节点映射为一个 `RoutineTrigger`，产出 [routines 服务](../../../../packages/faberloom/routines/src/index.ts) 可接受的 `RoutineDefinitionInput`。`active` 会激活编译后的 routine；编辑会重新编译并产生新版本，进行中的执行通过引擎的 `previewMigration`/`migrate` 迁移。新的步骤处理器位于 [handlers](../../../../packages/faberloom/handlers/src/index.ts)：`condition`、`imap`、`smtp`、`mcp`、`agent`、`delay`、`subroutine`、`transform`、`notify` 与 `deadletter`。

### 节点目录

| 家族 | `kind` | 配置 |
|---|---|---|
| 触发 | `trigger.manual` | 无 |
| 触发 | `trigger.schedule` | 重复或 cron、时区、时间窗 |
| 触发 | `trigger.email` | 连接、邮箱、匹配、unseenOnly |
| 触发 | `trigger.event` | 事件来源、匹配 |
| 触发 | `trigger.board` | 条目、状态 |
| 动作 | `agent` | agentId、instruction、useSpaceContext、skills |
| 动作 | `skill` | skill 名称、参数 |
| 动作 | `mcp.call` | server、tool、arguments、allow |
| 动作 | `imap.action` | 连接、op、query、folder |
| 动作 | `smtp.send` | 连接、to、subject、template |
| 动作 | `memory.remember` | space、text |
| 动作 | `memory.teach` | scope、text、source、active |
| 动作 | `board.create` | title、summary、evidence |
| 动作 | `space.reference` | space id |
| 动作 | `routine.invoke` | routine id |

### 权限与共享

`ShareGrant` 指明一个资源（`space` 或 `workflow`）、一个 `granteeEmail`、一组 `SharePermission`（`view`、`run`、`edit-graph`、`add-nodes`、`remove-nodes`、`edit-agents`、`manage-triggers`、`manage-connections`、`approve-effects`、`share`、`manage-members`）以及生命周期 `status`。执法会扩展 Spaces 的 `canRead`/`canManage` 检查，使每个动作由权限而非单一成员标志决定。共享会通过共享者的 SMTP 连接通知受邀者；跨用户共享会把授权与可移植的图快照发布到 MWT.ONE 控制台——与 agent 和 skill 已经使用的同一条路径——因为每个用户运行在拥有独立主目录的隔离进程中。

### 离线运行时与存活

调度器与 inbound 轮询器本就无需有人在线即可运行；workflow 继承这一点。每个执行记录逐节点状态、在限定次数内重试失败节点，并在重试耗尽时移至复核并生成一条 dead-letter 条目。存活视图展示最近一次运行、失败与下一个到期时隙，并通过邮件提醒所有者。

### 编辑入口

模型通过可选启用的工具（`workflowTools`，默认关闭）编辑图，浏览器在交互式画布上编辑，`exportWorkflow` 产出可移植 JSON 以及只读的 Archify HTML/SVG 图。Space 拓扑视图列出该 Space 的 agent、MCP 服务器、IMAP/SMTP 连接与 workdir，用于填充调色板。

### 仓库职责

运行时位于本仓库；mwt-one-harness 在 `faberloom` profile 中挂载该模块并负责部署与发布清单；mwt-knowledge-hub 存放模板、企业 schema 与保留策略；ECC 提供工程技能与 schema，绝不提供运行时代码。

## 类型约定

```text
WorkFlowNode   = { id, kind, title, config, agentId?, position: { x, y } }
WorkFlowEdge   = { id, from, to, condition? }
WorkFlowDef    = { intent, nodes[], edges[], permissions[], failurePolicy }
WorkFlow       = { id, ownerId, scope, name, status, version, definition, routineId?, createdAt, updatedAt }
WorkFlowScope  = { kind: 'personal' } | { kind: 'space', spaceId }
ShareGrant     = { id, resource, granteeEmail, permissions[], status, createdAt, acceptedAt? }
ShareResource  = { kind: 'space' | 'workflow', id }
SharePermission = 'view' | 'run' | 'edit-graph' | 'add-nodes' | 'remove-nodes' | 'edit-agents' | 'manage-triggers' | 'manage-connections' | 'approve-effects' | 'share' | 'manage-members'
```

## 子系统表面草稿

当该包在阶段 1 落地时，生成的子系统页面会获得此服务区段。

```text
ctx.faberloomWorkflows — FaberLoomWorkflows
async create(actor, input): Promise<WorkFlow>
async list(actor, scope?): Promise<WorkFlow[]>
async get(actor, id): Promise<WorkFlow>
async update(actor, id, patch): Promise<WorkFlow>
async setStatus(actor, id, status): Promise<WorkFlow>
async validate(actor, id): Promise<WorkFlowValidation>
async compile(actor, id): Promise<RoutineDefinitionInput>
async remove(actor, id): Promise<boolean>
async share(actor, id, granteeEmail, permissions): Promise<ShareGrant>
async revokeShare(actor, grantId): Promise<ShareGrant>
```

## 备选方案

**专用的图执行器。** 它能精确控制循环、扇出与汇聚，但会重复 routines 引擎已经交付并持续测试的调度器、等待、效果账本、幂等与迁移；本提案先编译为 Routine，并推迟图执行器，直到出现引擎无法表达的流程。

**复用 harness 的 workflow 工具。** harness workflow 在一个回合内运行 subagent 的 JavaScript 编排；它不是绑定到 Space 的持久产品图，没有图形界面，并会随回合结束而停止，因此无法在用户离线时运行。

**直接以 Routine 建模自动化而不使用图。** Routine 已能表达步骤与触发，但它是带依赖的线性列表，无法作为图被绘制、拖拽或检视，而这正是所要求的编辑体验。

**保留图但跳过编译。** 仅存储图会把执行、重试、等待、迁移与离线调度器丢给第二个引擎；编译则保持一个运行时与一份执行历史。

**仅通过本地 Space 成员共享。** 成员把读取授予同一进程内的身份，但每个用户是拥有独立主目录的隔离进程，因此跨用户共享需要控制台；仅靠本地成员无法通知或撤销另一个用户。

## 验收标准

- 图模型校验环、不可达节点、未知 kind 与格式错误的 config，并在编译前拒绝无效图。
- 一个 anti-spam 图确定性地编译为 Routine，并在没有打开会话的情况下经调度器运行，每个触发时隙或消息恰好一次。
- 每个目录 kind 都有处理器与单元测试；一个端到端用例针对假 IMAP/SMTP 服务器读取邮件、分类垃圾邮件、删除它并记录一条记忆。
- 聊天工具可创建、编辑并激活 anti-spam 图，并由一个无密钥快照固定；画布可添加、连接、编辑、删除节点并更换 agent。
- 权限决定每个动作，共享会通知受邀者邮箱，撤销授权会移除访问。
- 目录、工具目录、子系统页面、i18n 配对、快照、lint、重复与 typecheck 等门禁通过，且模块已挂载到 `faberloom` profile。

## 风险

编译图继承了 routines 引擎的限制：控制流是带等待的依赖图，因此丰富的循环与汇聚可能迫使启用被推迟的执行器。真实效果（删除、发送、MCP 调用）会触及用户邮箱与账户，因此每个效果节点都需要显式权限、幂等与 dry-run，且效果账本必须在崩溃后存活。跨用户共享依赖 MWT.ONE 控制台契约，并引入由部署而非 harness 承担的数据保留与驻留义务。知识中枢与企业 schema 假定每个控制台公司一个租户，因此共享图绝不能跨租户泄漏。最后，向请求增加工具会改变其 schema 并使 KV 复用失效，因此编辑工具可选启用，而编辑器本身绝不触碰提示。

## 实施状态

- Fase 0 —— 设计与契约（本 note、`packages/faberloom/workflows/README.md`，以及知识库规格 `SPEC_WORKFLOW_ANTI_SPAM_v1` 与 `SPEC_WORKFLOW_GLOSARIO_v1`）：已完成。
- Fase 1 —— 模型与存储：已完成。`@deepseek-ai/dsh-faberloom-workflows` 交付带 brand 的类型、判别节点目录、`faberloom_workflows` 域、带版本递增的所有者限定 CRUD、DAG 校验与 `compileWorkFlow`；anti-spam 图可确定性校验并编译，且每个文件 100% 覆盖率。`SPEC_WORKFLOW_MODEL_v1` 记录该模型。
- Fase 2 —— 持久执行：已完成。编译出的 routine 携带每个节点的 `config`；激活流程会经 `ctx.faberloomRoutines` 创建并激活 routine，编辑活动流程会为其生成新版本并迁移等待中的执行，`faberloom-handlers` 包注册配置驱动的处理器（`condition`、`transform`、`delay`、`imap`、`smtp`、`memory.remember`、`memory.teach`、`board.create`、`reference`、`subroutine`、`notify`、`deadletter`）以及 agent 的 Space 上下文。一个无密钥端到端用例在没有用户连接的情况下，用假 IMAP 与 SMTP 服务器驱动 anti-spam 图，并在重启后不重复运行。`faberloom` bundle 挂载 workflows 行，网关按用户保持调度器与 inbound 轮询开启。
- Fase 3 —— 丰富的连通性：已完成。`mcp.call` 在 `mcp:<server>:<tool>` 白名单校验后经 `ctx.tools` 调用一个 MCP 工具；agent 步骤解析 Space 的有效上下文与记忆、负责的代理及其技能、被调用技能的正文，在 Space 镜像的工作区路径中运行其隐藏会话，并使用目录代理的 provider 与 model；`ctx.faberloomView.spaceMap()` 返回调色板与画布读取的 Space、代理、MCP 访问、邮件连接与工作区。routines 引擎还会按条件结果门控分支步骤，并按引擎时钟恢复 `@delay:` 等待。
- Fase 4 —— 聊天编辑：已完成。启用 `workflowTools`（默认关闭）后，`dsh-tool-faberloom` 注册 `faberloom_workflows_list/get/create/add_node/update_node/remove_node/connect/disconnect/set_trigger/validate/activate/pause/run_now/runs` 以及"把自动化编辑为图并在激活前校验"的指令；workflows 服务补齐了对应的逐节点编辑方法。一个无密钥端到端用例通过工具在真实服务上创建并激活 anti-spam 流程。图形编辑器、调度、共享、存活检测与模板留给后续阶段。
- Fase 5 —— 图形界面：已完成。`ctx.faberloomView` 暴露 `workflowOverview`、`workflowDetail`、`createWorkflow`、`saveWorkflow`、`addNode`、`updateNode`、`removeNode`、`connect`、`disconnect`、`setWorkflowStatus`、`workflowRuns`、`spaceTopology` 与 `exportWorkflow`（JSON 或带内联 SVG 的只读 Archify HTML）；`ui-faberloom` 的 Workflows 面板（`nav.workflows`）在 SVG 画布上绘制图，支持指针拖拽、点击连接、键盘删除，按 kind 的检查器可选择代理、MCP 工具、邮件连接或技能，实时运行历史按执行状态着色，并显示 Space 拓扑与导出按钮；英文 Work bench 标签显示为 `Mesa de trabajo`。所有新字符串都是类型化字典键；client 用例覆盖画布几何与面板交互，view Remote 层有独立的投射用例。调度、跨用户共享、存活告警与模板留给后续阶段。
