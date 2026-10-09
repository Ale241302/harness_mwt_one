# Agent Note: Space 会话组合

Status: implemented

[English](2026-10-08-space-session-agent.md) | 中文

## Problem

Space 携带一个负责代理，带有 persona、能力平面与技能，但只有一次委托咨询（`faberloom_spaces_ask`）以该代理的身份运行。在 Space 中打开的会话以部署组合运行，因此行为如同通才：代理的指令、其 MCP 掩码与技能从未到达用户实际进行的对话。

## Decision

新增包 `@deepseek-ai/dsh-faberloom-session-agent` 及主机服务 `ctx.faberloomSessionAgent`。在被等待的 `agent/created` 窗口内，它从工作目录链解析会话的 Space 代理——`cwd` 到已注册工作区、工作区到镜像它的 Space、Space 到其 `agentId`——与 `faberloom_spaces_ask` 调用方检查所用的链相同。当解析出代理时，它在该代理的作用域上安装：代理的 persona 作为 `deployment:persona-prefix` 段落（遮蔽部署 persona，子代理组合的先例）、`faberloomAgentPlane.resolve` 对代理无权使用的来源的工具掩码，以及列出代理技能的简短指令。组合在首个轮次之前安装一次，并随其代理释放；Space 之外的会话、没有代理的 Space，或缺失服务，都会让会话保持不变。`toolSourcesOf` 移入 `agent-plane`，使被委托的子代理与会话从实时注册表构建同一来源集合。网关按用户注入行为身份，faberloom bundle 挂载该行。

## Alternatives considered

**通过改写代理的 `options` 设置模型路由。** 否决：`options` 只读，且不存在按代理的创建接缝；会话从自身记录的 header 或部署默认值解析路由，代理的模型策略在其委托时已生效。

**为代理 persona 注册新的提示槽。** 否决：在代理作用域遮蔽 `deployment:persona-prefix` 是子代理组合与 preset 改变代理身份的既有方式，因此 Space 会话无需新槽。

**通过客户端解析 Space。** 否决：浏览器从不携带身份；主机从配置解析行为者，与视图和工具一致。

## Consequences

Space 会话现在读作其负责代理，并在其平面下执行：模型看到代理的 persona 与技能指令，且被禁用来源的工具从请求中缺失。模型路由不在此组合；它仍由会话的 header 或部署默认值决定。解析按工作目录进行，因此被采纳的工作区或 Space 的确定性区域都可行，而在工作区注册之前启动的 Space 会话不会被组合。该服务在组合层面是可选的（`ctx.get`），因此没有产品平面的部署保持其普通会话，且空间快照夹具保持不变，因为其组合既不挂载该服务也不挂载 MCP 工具。

测试覆盖组合矩阵：persona 加掩码加技能、仅 persona 的情况，以及每一条提前返回（无身份、无工作目录、各缺失服务、Space 之外的会话、没有代理的 Space）。
