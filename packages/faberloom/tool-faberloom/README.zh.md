---
description: "本 DeepSeek Harness 构建中，面向模型的原生产品工具（faberloom_*），包括多公司 MWT.ONE 租户路由器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-faberloom

[English](README.md) | 中文

## 概述

此包在原生产品服务之上注册面向模型的 `faberloom_*` 工具：空间、agent、模型、例程、执行、工作台、来源、邮件、MWT.ONE 租户路由器、跨空间解析（`faberloom_spaces_find`、`_reference`、`_ask`）、技能安装（`faberloom_skill_install`：把一个文件夹安装到工作区或全局根目录，并报告每个候选）、MCP 服务器安装（`faberloom_mcp_install` 读取用户交来的文档页面，`faberloom_mcp_add` 直接接收已知的连接事实，`_list`/`_remove` 管理其余部分：用户交来的服务器先用一次连接验证，通过后才保存；凭证值进入凭证接缝）、工作区文件改动（`faberloom_files_create`/`_rename`/`_delete`，经 `workspaceFiles` 能力），以及可选启用的空间记忆、teaching 与 Work Flow 图工具。路由器把同一条读查询扇出到每个 `legal_entity_ids` 租户；控制台对每次调用仍强制执行角色与权限。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在存在 `ctx.tools` 与产品服务处挂载此行。工具注册在调用插件的 fiber 上，随其释放而消失。工作区文件工具还需要挂载 `workspaceFiles` 能力：它们在那里解析调用会话自己的工作区根，并通过它完成每一次改动，因此缺少该能力时调用会直接失败，而不是猜测一个路径。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

模型看到生成的 [`faberloom_*` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-faberloom)。

#### Token 影响

挂载期间，每个工具 schema 随每次请求发送；其结果只是普通文本块。

#### KV 缓存影响

增删工具会改变工具块，可能从首个变化的 token 起使复用失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **租户路由器把副作用交给控制台裁决。** `faberloom_mwt_call` 与 `faberloom_mwt_find` 只约束租户（绝不超出用户的公司）；一个工具是读还是写由 MWT.ONE 控制台的 RBAC 决定，而不是 FaberLoom 侧的允许名单。
- **公司名即 id。** 控制台返回的 `legal_entity_ids` 是不透明 id；显示名映射推迟到控制台提供为止。
- **空间查找。** `faberloom_spaces_find` 按折叠词项对空间标题、上下文、记忆与该空间的精选上下文条目排序；当挂载 `ctx.spaceIndex` 排序器时，它也会对该空间附件的可读文本排序。空查询列出最近创建的可读空间。`faberloom_spaces_reference` 只返回文件元数据，不含字节。
- **委托咨询。** `faberloom_spaces_ask` 通过 `askProvider`（默认 `spawn`）运行一次委托并返回其答复；`continuable: true` 会启动一个持久子会话，由 `faberloom_spaces_followup` 继续。委托深度适用，子代理继承负责代理的工具面，并在该代理保存了 key 时继承其凭证引用，因此咨询运行在被咨询代理自己的 provider 账户上。子代理在父级工作区中运行，因为 `resolveWorkdir` 返回的是不透明引用而非路径；在空间真实工作目录中运行推迟到后续。
- **记忆工具为可选启用。** `memoryTools`（默认关闭）注册空间记忆（`faberloom_spaces_remember`/`_memory_list`/`_forget`）与 teaching（`faberloom_memory_teach`/`_teachings`/`_revoke`/`_retrieve`）工具；默认关闭是因为它们会增加常驻请求 schema。这一显式且带版本的层归 FaberLoom 所有；自动情景记忆由外部记忆服务器蒸馏（见 `MANIFEST.md`），不是这些工具。
- **Work Flow 工具为可选启用。** `workflowTools`（默认关闭）注册图工具（`faberloom_workflows_list`/`_get`/`_create`/`_add_node`/`_update_node`/`_remove_node`/`_connect`/`_disconnect`/`_set_trigger`/`_validate`/`_activate`/`_pause`/`_run_now`/`_runs`）以及"把自动化编辑为图并在激活前校验"的指令。默认关闭是因为它们会增加常驻请求 schema。
- **MCP 安装先探针后保存。** `faberloom_mcp_add` 先连接一次以证明服务器可用，只有探针成功才记录它；无法连接、拒绝所给凭证、或未按 MCP 服务器应答的服务器会被报告，且不保存任何内容。`faberloom_mcp_install` 读取用户交来的文档（`mcpServers` JSON 块、启动命令或服务器 URL），列出页面要求的所有环境变量或请求头值，并在连接前通过 `ctx.userQuestions` 向用户索取；拿不到的值会作为缺失输入列表返回，由模型向用户询问，服务器绝不会带着编造的值被保存。每次安装只新增或替换一个服务器，其余照旧可用；用户可能有很多服务器，各有用途。某个名称若已安装，会连同现有服务器的状态一并报告；除非 `replace` 为 true，否则不会保存任何内容，因此可用服务器绝不会被静默覆盖。探针只携带本次调用提供的值，因此要重新测试一个需要密钥的已保存服务器，必须再次提供该值；该工具从不读回已保存的值。`faberloom_mcp_list` 报告每个服务器的传输方式、是否已验证并可用（已启用但挂载失败的服务器读作 `saved but not proven yet`，并附上遮蔽后的原因）、以及哪些条目存在，绝不返回值。保存的服务器属于该用户，因此他的每个工作区和空间都能使用其工具。
- **工作区文件工具不自带文件系统规则。** `faberloom_files_create`、`_rename` 与 `_delete` 以调用会话自己的 scope 调用已挂载的 `workspaceFiles` 能力，因此包含、拒绝与答案（改动了什么、在哪里）都属于该能力；工具只校验自己的参数并把答案转成一行面向模型的文字。`_rename` 只替换一个路径段，绝不移动到别的目录，并在发送任何请求前拒绝含分隔符的名称。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
