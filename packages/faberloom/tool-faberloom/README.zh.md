---
description: "本 DeepSeek Harness 构建中，面向模型的原生产品工具（faberloom_spaces_create、faberloom_spaces_list）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-faberloom

[English](README.md) | 中文

## 概述

此包注册读写原生产品服务的、面向模型的工具。本切片通过 `ctx.faberloomSpaces` 暴露空间工具；工具集随领域切片增长。

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

模型看到生成的 [`faberloom_spaces_create` 与 `faberloom_spaces_list` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-faberloom)。

#### Token 影响

挂载期间，两个工具 schema 随每次请求发送；其结果只是普通文本块。

#### KV 缓存影响

增删工具会改变工具块，可能从首个变化的 token 起使复用失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **空间切片** — 工具覆盖 `ctx.faberloomSpaces` 上的空间服务；其他产品领域在后续切片加入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
