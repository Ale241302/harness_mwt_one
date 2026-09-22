---
description: "本 DeepSeek Harness 构建中，面向模型的原生产品工具（faberloom_*），包括多公司 MWT.ONE 租户路由器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-faberloom

[English](README.md) | 中文

## 概述

此包注册读写原生产品服务的、面向模型的工具：空间、agent、模型、例程、执行、工作台、来源、邮件（IMAP 搜索与 SMTP 发送），以及 MWT.ONE 租户路由器。路由器——`faberloom_companies`、`faberloom_mwt_call`、`faberloom_mwt_find`——通过把同一条读查询扇出到用户 `legal_entity_ids` 中的每个租户（绝不越界）来回答"这份数据在用户的哪家公司"；每次按公司调用都经过同一个 JSON-RPC 客户端，在 `X-MWT-Client-ID` 中携带该租户，且控制台对每次调用仍强制执行角色与权限。

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

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
