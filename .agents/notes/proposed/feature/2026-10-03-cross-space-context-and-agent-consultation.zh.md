# Agent Note: 跨 Space 的上下文解析与 Space 代理咨询

Status: proposed

[English](2026-10-03-cross-space-context-and-agent-consultation.md) | 中文

## 问题

产品 Space 承载持久上下文、Space 范围内的记忆、商业来源指令、附件以及负责的目录代理，其对话区域就是 harness 的 Workspace，因此一个 Space 与其 Workspace 指向同一工作区域。[spaces 服务](../../../../packages/faberloom/spaces/src/index.ts) 只会针对调用方已经持有的 id 通过 `effectiveContext` 解析 Space 上下文，而且该解析只沿祖先链上溯。因此模型无法解析请求中具名的任意 Space，无法咨询另一个 Space 所负责的代理，也无法在请求未具名时推断出该 Space。跨 Space 的工作，例如在客户 Space 中利用位于“格式”Space 里的模板生成报告，只能依赖用户手工粘贴上下文。

## 提案

为原生产品模块增加跨 Space 解析与 Space 代理咨询，并确定上下文与记忆的保存策略。面向模型的入口通过[产品工具](../../../../packages/faberloom/tool-faberloom/src/index.ts)注册，且每一次读取都保留现有的访问检查。

### 决策

- Space 是产品容器，Workspace 是 harness 容器；`FaberLoomSpace.workspaceId` 将两者关联，Space 的对话区域就是该 Workspace，因此上下文绝不在两者之间重复保存。
- 版本 1 只通过显式的模型工具解析 Space 上下文；对请求前缀的自动注入延后。
- 每一次跨 Space 读取都强制执行现有的 `canRead` 检查、公司范围与角色，因此任何读取都不会跨越租户。
- 咨询另一个 Space 的代理是通过 `ctx.subagents.start` 发起的父级委托，而不是跨树的代理消息。
- 会话日志就是对话，绝不复制进上下文；`Space.context` 保存稳定的共享配置，`FaberLoomSpaceMemory` 保存带 `source` 的案例学习，`ctx.faberloomMemory` 的 teachings 保存蒸馏后的规则，并且保持候选状态直到用户确认一条显式指令。
- 版本 1 的 `find` 按确定性的词法匹配排序；嵌入模型或外部索引延后。

### 1. Space 解析与上下文引用

`FaberLoomSpaces.find(actor, query, limit?)` 返回 `SpaceMatch[]`，按 Space 标题、其上下文键与值以及其记忆文本排序，且只包含该 actor 可读取的 Space。`FaberLoomSpaces.reference(actor, id)` 返回 `SpaceReference`，组合 `effectiveContext`、`effectiveMemory`、不含字节的附件元数据、负责的 `agentId` 与 `workspaceId`。两个方法都强制执行 `canRead`。

### 2. 模型工具

注册 `faberloom_spaces_find` 与 `faberloom_spaces_reference`，并增加一条系统提示指令，要求模型先用 `find` 解析被引用的 Space、再用 `reference`，且绝不臆造上下文。

### 3. Space 代理咨询

注册 `faberloom_spaces_ask({ spaceId, question, agentId?, continuable? })`。它解析 Space 引用，通过 `ctx.faberloomAgents.getAgent` 解析负责的目录代理，用代理职责、Space 指令与引用组合出提示，并通过[子代理能力](../../../../docs/subsystems/subagent.zh.md)以 `ctx.subagents.start(config.askProvider, { prompt, parent: exec.agent, signal })` 发起委托。它返回子代理输出与会话 id，并释放该运行。没有负责代理的 Space 会显式失败。

### 4. 上下文与记忆工具

基于现有的 Space 记忆方法注册 `faberloom_spaces_remember`、`faberloom_spaces_memory_list` 与 `faberloom_spaces_forget`，并基于[记忆服务](../../../../packages/faberloom/learning/src/index.ts)注册 `faberloom_memory_teach`、`faberloom_memory_teachings` 与 `faberloom_memory_revoke`。外部代理记忆服务器继续负责自动的情景蒸馏；这些工具只负责显式且带版本的那一层。

### 5. 交付阶段

阶段 0 记录本笔记。阶段 1 增加 `find` 与 `reference` 及其单元测试。阶段 2 增加两个解析工具、提示指令、重新生成的工具目录以及一个无密钥的录制会话快照。阶段 3 增加隐式解析。阶段 4 增加 `faberloom_spaces_ask`。阶段 5 增加记忆与 teaching 工具。阶段 6 延后语义检索、活动 Space 的自动注入、真实 Space 工作目录解析以及记忆蒸馏。

## 类型约定

| 记录 | 字段 | 含义 |
|---|---|---|
| `SpaceMatch` | `id` | Space id。 |
| `SpaceMatch` | `title` | 显示标题。 |
| `SpaceMatch` | `score` | 词法匹配得分。 |
| `SpaceMatch` | `reasons` | 命中的字段。 |
| `SpaceReference` | `space` | 解析出的 Space 记录。 |
| `SpaceReference` | `context` | `effectiveContext` 的结果。 |
| `SpaceReference` | `memory` | `effectiveMemory` 的条目。 |
| `SpaceReference` | `files` | 不含字节的附件元数据。 |
| `SpaceReference` | `agentId` | 负责的目录代理。 |
| `SpaceReference` | `workspaceId` | 所镜像的 harness Workspace。 |

## 备选方案

**复用 `sessionReference` 承载 Space 上下文。** 它从某个具体的源会话召回会话记录；一个 Space 没有单一会话，其配置与记忆也不是记录字节，因此 recall 形式并不承载所需数据。

**用 `sendMessage` 发送代理到代理的消息。** 该能力只授权相邻的活跃代理，绝不跨越 Space 边界；发起询问的代理并不是被引用 Space 的父级，因此该消息会被拒绝。

**在版本 1 用嵌入模型或外部索引排序。** 它会在词法基线与测试尚未建立之前引入一个提供方、一个网络依赖以及不确定性；因此延后到阶段 6。

**在版本 1 自动注入活动 Space 上下文。** 它会在每次请求上改变请求前缀，无法区分显式的用户引用，并且会先于让该引用可审计的查找工具出现。

## 验收标准

- `FaberLoomSpaces.find` 与 `FaberLoomSpaces.reference` 通过排序、继承、排除、冲突、记忆继承、不含字节的文件元数据以及读取拒绝的单元测试，且没有结果跨越租户。
- `faberloom_spaces_find` 与 `faberloom_spaces_reference` 完成注册，生成的工具目录反映它们，提示指令存在，且有一个无密钥的录制会话快照固定模型可见文本。
- `faberloom_spaces_ask` 以 `exec.agent` 为父级发起委托，返回子代理输出与会话 id，释放该运行，并在 Space 没有负责代理时显式失败。
- Space 记忆与 teaching 工具强制执行其范围与所有权，且外部记忆服务器仍是唯一自动的情景层。
- 阶段 0 至 5 在格式、配对、单元、覆盖率、类型检查与目录等门禁全绿的前提下合入；阶段 6 保持为已记录的延后项。
- 上下文与记忆的策略在 Space 与记忆的 README 中写明，且不与已发布行为相矛盾。

## 风险

词法匹配会漏掉同义词与跨语言措辞；其不确定性必须以排序后的候选呈现，而不是悄悄选错 Space，语义检索则延后。一次咨询会在部署的共享预算上运行一个子模型回合，因此深度限制与提供方可用性可能使其被拒绝，而这种拒绝必须呈现出来，而不是给出空答案。提示指令是由快照固定的模型可见文本，因此措辞变更需要更新快照。每个注册的工具都会为每次请求增加常驻的 schema token，因此记忆与 teaching 工具保持可选，直到用户启用它们。

[Space 与 Workspace 关联](../../implemented/feature/2026-09-22-spaces-workspace-link-and-bench.zh.md)与[记忆比其来源更长寿](../../implemented/feature/2026-09-27-memory-outlives-its-origin.zh.md)两项决策仍是这些机制的独立权威；本提案不取代其中任何一项，也不归档任何活跃笔记。
