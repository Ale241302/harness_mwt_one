# Agent Note: The Space agent directive

Status: implemented

[English](2026-10-11-space-directive.md) | 中文

## Problem

一个 Space 会点名其负责 agent、上下文、商业来源与工作区，但没有任何东西让 owner 为**该 Space** 写下指令：“这里用西班牙语并附客户料号回答”、“报价前先查库存”、“未含毛利的报价绝不发出”。这些只存在于 owner 脑中或 agent 从不读取的便签里。Space 唯一带有的按部署提示是由其来源生成的 `Directiva MWT` 行，它只固定控制台查询，其他一概不管。

## Decision

Space 记录携带一个 owner 指令，且该 Space 的会话会注入它。

- **持久字段。** `faberloom-spaces` 在 `SpaceRecord` 上新增 `prompt: z.string().default('')`，以及 `FaberLoomSpace.prompt` 与 `CreateSpaceInput.prompt` / `UpdateSpaceInput.prompt`（`null` 表示清除）。该默认值保持域版本不变，并使字段之前写入的每条记录照常加载。
- **Remote 表面。** `faberloom-view` 的 `spaceDetail` 返回该指令，`saveSpace` 接受它（`SpaceSaveInput.prompt`），因此既有的 detail/save 路径即可承载，无需新 Remote。
- **会话组合。** `faberloom-session-agent` 从它本就解析的 Space 读取该指令，非空时注入一个 `faberloom:space-directive` 系统提示段落，位置紧跟 persona 且在技能行之前。空指令不注入任何内容，因此没有指令的 Space 读起来与从前完全一致。
- **面板。** Espacios 详情新增 **directive** 文本域，从 detail 载入并与标题、继承、成员、agent 一并保存。

该指令是 **Space owner** 写给该 Space's agent 的文本，区别于 agent 自身的 `responsibility`（其 persona）以及生成的来源指令：它与二者组合而非取代任一。

## Alternatives considered

**复用 Space 的 `context` 条目。** 否决：context 可共享，Space 被共享时发布到控制台，且以键检索；写给自己的 agent 的指令两样都不是。混用会在 Space 一旦外传时泄露内部指令。

**放在 agent 上（`responsibility`）。** 否决：一个 agent 可能领导多个 Space（父空间与其子空间，且同一专家跨客户），因此单一 agent 作用域的提示无法按 Space 说不同的话。

**新增 Remote 而不是扩展 `spaceDetail`/`saveSpace`。** 否决：detail 已携带每个可编辑字段，save 已对它们打补丁；独立调用会把一个编辑面拆成两次往返与两个 revision 游标。

**在会话开始时作为用户消息注入。** 否决：它是常驻指令而非一轮发言；系统提示段落让它不进入记录、经受压缩，且不会被误认为用户所言。

## Consequences

owner 可以规定某个 Space 的 agent 应如何行动，该 Space 的会话据此执行而无需编辑 agent。指令按 Space 生效，因此同一专家按客户有不同表现。空指令不改变任何行为，且注入是追加式的，故既有会话与每个种子 agent 照常工作。该指令是 owner 作用域：它存于 Space 记录，共享时不会发布（只有 context、memory 与 Work Flow 会外传）。

## Testing

`packages/faberloom/spaces` 通过既有套件覆盖记录往返与 `prompt` 更新。`packages/faberloom/session-agent/tests/session-agent.spec.ts` 断言注入的 `faberloom:space-directive` 段落携带该 Space 的文本，且空指令只留下 persona。`packages/faberloom/view` 覆盖 detail 投影与 save 入参，`ui-faberloom` 面板套件在 stub 视图上渲染 Espacios 详情。
