---
description: "本 DeepSeek Harness 构建中的原生产品模块（ctx.faberloomSpaces）：主题空间与有效上下文。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-spaces

[English](README.md) | 中文

## 概述

此包承载主题空间与有效上下文。它通过存储域与控制台角色访问控制注册 `ctx.faberloomSpaces` 主机服务并保存持久记录；模型工具位于 `dsh-tool-faberloom`。它还会通过词法查找解析被引用的空间，并返回其有效上下文、记忆与附件元数据。

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

- **控制台角色范围** — 访问使用网关注入的控制台角色、公司与只读标志；其他公司的成员被拒绝，而只读角色仍可创建并管理自己的空间（空间是用户自己的容器，不是公司数据）。
- **工作区镜像** — 当某个工作区被采纳为空间时，空间可存储它镜像的 harness 工作区 id；服务只保留 id（绝不保留路径），由 view 通过工作区注册表解析它。没有镜像的空间使用确定性的 `<DSH_HOME>/spaces/<ref>` 区域。
- **词法引用查找（v1）** — `find` 以折叠后的词项匹配空间标题、其上下文值与记忆文本；它不搜索附件内容，且排除已归档空间。`reference` 只返回文件元数据，不含字节。
- **可插拔排序接缝（6.1）** — 当挂载 provider 时，`find` 通过 `ctx.spaceIndex` 排序，否则使用内置词法排序器；该接缝让 embeddings 或知识中枢 provider 在不接触存储或访问控制的情况下替换排序。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
