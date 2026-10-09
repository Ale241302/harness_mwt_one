---
description: "本 DeepSeek Harness 构建中，面向模型的原生产品工具（faberloom_*），包括多公司 MWT.ONE 租户路由器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-faberloom

[English](README.md) | 中文

## 概述

此包在原生产品服务之上注册面向模型的 `faberloom_*` 工具：空间、agent、模型、例程、执行、工作台、来源、邮件、MWT.ONE 租户路由器、跨空间解析（`faberloom_spaces_find`、`_reference`、`_ask`），以及可选启用的空间记忆、teaching 与 Work Flow 图工具。路由器把同一条读查询扇出到每个 `legal_entity_ids` 租户（绝不越界），控制台对每次调用仍强制执行角色与权限。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在存在 `ctx.tools` 与产品服务处挂载此行。工具注册在调用插件的 fiber 上，随其释放而消失。

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
- **委托咨询。** `faberloom_spaces_ask` 通过 `askProvider`（默认 `spawn`）运行一次委托并返回其答复；`continuable: true` 会启动一个持久子会话，由 `faberloom_spaces_followup` 继续。委托深度适用，子代理继承负责代理的工具面。子代理在父级工作区中运行，因为 `resolveWorkdir` 返回的是不透明引用而非路径；在空间真实工作目录中运行推迟到后续。
- **记忆工具为可选启用。** `memoryTools`（默认关闭）注册空间记忆（`faberloom_spaces_remember`/`_memory_list`/`_forget`）与 teaching（`faberloom_memory_teach`/`_teachings`/`_revoke`/`_retrieve`）工具；默认关闭是因为它们会增加常驻请求 schema。这一显式且带版本的层归 FaberLoom 所有；自动情景记忆由外部记忆服务器蒸馏（见 `MANIFEST.md`），不是这些工具。
- **Work Flow 工具为可选启用。** `workflowTools`（默认关闭）注册图工具（`faberloom_workflows_list`/`_get`/`_create`/`_add_node`/`_update_node`/`_remove_node`/`_connect`/`_disconnect`/`_set_trigger`/`_validate`/`_activate`/`_pause`/`_run_now`/`_runs`）以及"把自动化编辑为图并在激活前校验"的指令。默认关闭是因为它们会增加常驻请求 schema。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
