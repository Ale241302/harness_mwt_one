# Agent Note：按名称列出智能体的空间，且空间可以有多个

Status: implemented

[English](2026-09-24-faberloom-agent-spaces.md) | 中文

## 问题

Agentes 面板的 SPACE 列渲染的是原始空间 id，因此领导某个空间的智能体显示的是一串 UUID，而不是空间名称；而且总览把每个智能体都收敛为单一空间，尽管模型本就允许一个智能体领导多个空间（一个父空间及其子空间）。

## 决定

`FaberLoomAgentRow` 改为携带 `spaceIds: readonly string[]`，面板把每个 id 解析为空间标题。

- `overview()` 依据每个空间的 `agentId` 构建 `spacesByAgent`（不再只取第一个），从而报告智能体的完整集合。
- Agentes 面板从 `overview.spaces` 把 id 映射为标题并以 `, ` 连接显示；当智能体不领导任何空间时回退到 personal 文案。
- `@` 智能体触发器用同一列表生成描述。

## 考虑过的替代方案

**保留 `spaceId` 并增加 `spaceName`。** 它能修好 UUID，却仍隐藏了“一个智能体可领导多个空间”这一事实；报告 id 能如实保留基数。

**只在客户端 store 里解析标题。** 面板已经在读 `overview.spaces`，因此映射放在那里；视图保留 id。

## 后果

- 领导多个空间的智能体会在面板与 `@` 触发器中显示每一个空间名称。
- `FaberLoomAgentRow.spaceId` 改为 `spaceIds`；视图与客户端测试使用新字段。
- 从 `@` 手势选择智能体仍插入智能体名称，行为不变。

## 测试

`packages/faberloom/view/tests/workspace-board.spec.ts` 断言 `overview.agents` 报告 `spaceIds: ['sp1']`；`packages/client/ui-faberloom/tests/gestures.client.spec.ts` 与 `registration.client.spec.tsx` 携带新字段。
