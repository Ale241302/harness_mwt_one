# Agent Note: 上下文工具、Work Flow 提案与审批收件箱

Status: implemented

[English](2026-10-04-context-tools-and-approval-inbox.md) | 中文

## Problem

FaberLoom 已交付上下文面板与共享会话目录，但仍有四个缺口。模型无法在对话中触及工作区/Space 上下文，因此「记住这条规则」需要打开面板。只有用户提出时才会创建工作流，没有让模型自行发现可自动化流程的途径。成员的 Work Flow 编辑与成员的 Space 上下文贡献没有单一的面向所有者的接受或拒绝之处，而且成员的 Work Flow 编辑会直接写入实时图，没有可对比的待定修订。上下文共享停留在一台主机上，因为没有像共享授权那样把它带到控制台的传输。

## Decision

`Config.contextTools` 选择启用基于 `ctx.faberloomContext` 的 `faberloom_context_*` 工具（`list`、`create`、`update`、`versions`、`restore`、`approve`、`reject`、`remove`），并加入 `faberloom:context` 提示指令，告诉模型无需被要求就记录事实与规则，并在它拥有该 Space 时索引或保持一条待定记录。

`faberloom_workflows_propose` 由一个名称、一个意图和一组有序步骤构建草稿 Work Flow：`trigger.*` 步骤（否则 `trigger.manual`）成为触发器，其余按顺序以有向边串联，流程被校验但绝不激活。`faberloom:workflows` 指令现在告诉模型在对话暴露出可重复流程时自行提案，并等待用户确认。

工作流域新增 `pending` 表，每个流程至多一条待定修订；域版本保持 1，因为存储把缺失的表读作空，而提高版本会让每个已有存储在打开时被拒绝。非所有者的编辑——`update`、`addNode`、`updateNode`、`removeNode`、`connect`、`disconnect`、`setTrigger`、`setConcurrency` 或 `restore`——会把建议的名称、范围与定义暂存（后一次提案替换前一次），并保持实时流程不变。`pendingChanges(actor)` 列出所有者的待定修订及其 base 与 proposed 定义，`acceptPending`/`rejectPending` 应用或丢弃其一。所有者自己的编辑仍然直接应用。

上下文域新增 `origin` 与 `consoleId`，二者均可选且带缺省值，因此域版本保持 1。成员的 Space 记录会发布到 `${consoleBase}/harness/context`；通过或拒绝会重新发布其状态；删除会删除镜像；`sync(readerId)` 把控制台的记录导入为该读者所拥有、状态为 `pending` 的条目，并清理控制台不再携带的记录。

视图暴露 `syncContext`、`workflowPendingChanges`、`acceptWorkflowChange` 与 `rejectWorkflowChange`。Espacios 面板新增 `Sesiones compartidas` 字段，并新增 **Aprobaciones** 面板，列出待批上下文与暂存流程变更，带有接受/拒绝操作，以及每条提案相对其 base 的节点/边差异。

## Alternatives considered

**在代码中强制自动提案的检测。** 否决：判断一段对话是否可自动化是模型的判断，而非宿主规则；该工具创建安全草稿，指令让提案明确且可确认。

**先应用成员的编辑，再提供「撤销」。** 否决：需求是一条待定修订，由所有者对比后接受或拒绝；在变更处暂存是唯一能在未应用的前提下把建议图与实时图并排展示的方式。

**把共享上下文作为所有者自己的条目导入本地。** 否决：导入的记录是成员的提案，因此它落到 `pending`，只有在所有者索引后才 `shared`，与同主机审批语义一致。

**为 Work Flow 提案工具单独设一个开关。** 否决：它属于现有的 `workflowTools` 图工具集，共用其 schema 与指令。

## Consequences

Context 与 Work Flow 工具保持选择启用，因此想要它们的部署会设置 `contextTools` 与 `workflowTools`；指令文本与工具一同固定。暂存是每个流程一条修订，因此第二次成员编辑会替换第一次——所有者始终审阅最新提案，而非队列。审批收件箱是上下文与流程决策单一的面向所有者之处。跨主机上下文需要 `${consoleBase}/harness/context` 端点，正如共享授权与共享会话；没有它，成员的上下文保持本地且 `sync` 为空操作。两个域各新增一个持久字段与一张表而**不改变其版本**——存储层从不迁移版本变更，因此新增的表或可选字段保持版本 1，已有存储继续可打开——持久化目录记录这些新表与字段。

测试覆盖上下文工具（list、create、update、versions、restore、approve、reject、remove、未挂载失败与空列表）、提案工具（带范围的步骤列表与报为无效的裸手动草稿）、待定 Work Flow 生命周期（在 update、add、restore 与并发上暂存；接受；拒绝；仅所有者与缺失暂存的失败）、上下文控制台传输（发布、通过时重新发布状态、删除时撤回、带缺省值的导入、清理、环境回退与显式失败），以及视图的待定映射与 `syncContext`。
