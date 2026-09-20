---
description: "本 DeepSeek Harness 构建中的原生产品模块（ctx.faberloomSpaces）：主题空间与有效上下文。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-spaces

[English](README.md) | 中文

## 概述

此包承载主题空间与有效上下文。它注册 `ctx.faberloomSpaces` 主机服务；工具、设置与持久化记录在后续切片加入。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在组合中挂载此行即可暴露 `ctx.faberloomSpaces`。该服务是调用插件 fiber 上的副作用，释放该 fiber 即移除。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomSpaces` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **控制台角色范围** — 访问使用网关注入的控制台角色、公司与只读标志；其他公司的成员被拒绝，只读角色不能变更空间。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
