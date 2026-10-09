# Agent Note: Space agent assignment and capability flags on the tool surface

Status: implemented

[English](2026-10-08-space-agent-assignment-tool-surface.md) | 中文

## Problem

部署后的 harness 上进行的 F50 冒烟显示，代理与 Space 的分配以及每代理能力面从模型面不可达。`faberloom_spaces_update` 接受分配键并返回成功，但其声明的参数不含 `agentId`，因此该参数被丢弃，只有版本递增；随后 `faberloom_spaces_reference` 报告没有负责代理，`faberloom_spaces_ask` 以 "este Space no tiene un agente responsable" 失败。同样，`faberloom_agents_create` 与 `faberloom_agents_update` 未暴露 `mwtMcp`、`sicopMcp` 或 `webAccess`，因此通过工具创建的代理始终保留服务默认值（`mwtMcp: true`），无法收窄其能力面。自有服务本已接受这些字段；缺失的只是工具 schema 及其参数接线。

## Decision

为 `faberloom_spaces_update` 增加可选参数 `agentId`（空字符串清除分配，映射到该域的 `null`）并将其转发进 space patch。为 `faberloom_agents_create` 与 `faberloom_agents_update` 增加可选参数 `webAccess`、`mwtMcp` 与 `sicopMcp`，并把每个已提供值转发进自有服务的调用。工具目录及其中文配对记录这些新参数以及被扩宽的 `faberloom_spaces_update` 描述。

## Alternatives considered

**仅在 Web 控制台分配。** 否决：同一能力必须从 Service Definition 服务的每个消费方可达；把它仅留在 UI 正是冒烟发现的缺陷，而非边界。

**从 Space 上下文推断负责代理。** 否决：分配是所有者对明确目标的操作，不是派生值。

## Consequences

通过工具创建的代理可以设置其 MWT/SICOP-MCP 与 web 标志，Space 也可以通过 `faberloom_spaces_update` 指定其负责代理，于是 `faberloom_spaces_reference` 会显示该代理，`faberloom_spaces_ask` 无需 override 即可委托——F50 路径从模型面端到端可达。tool-faberloom 的测试固定转发的 `agentId`（设置与清除）以及 create 与 update 上的三个能力标志。
