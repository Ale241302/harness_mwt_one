---
description: "原生产品模块 bundle：作为 faberloom 配置文件的最后补丁层，挂载 FaberLoom 服务行及其模型工具。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-faberloom-app

[English](README.md) | 中文

## 概述

此 bundle 承载 `cordis.patch.yml`，即挂载原生产品服务行与 `@deepseek-ai/dsh-tool-faberloom` 的补丁层。`faberloom` 配置文件将其组合在 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app` 之后，因此所服务的 harness 以一等行承载产品模块。

## 目录

- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

### 挂载的行

#### 模型看到的内容

没有直接内容：此 bundle 挂载产品服务行与 `@deepseek-ai/dsh-tool-faberloom`，由该工具包拥有面向模型的 schema。

#### Token 影响

直接消耗为零；挂载的工具包贡献其 schema。

#### KV 缓存影响

无关：补丁层本身从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **挂载骨架行** — 在领域切片落地前，产品服务只承载其服务面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
