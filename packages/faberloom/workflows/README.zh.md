---
description: "本 DeepSeek Harness 构建中的原生产品模块（ctx.faberloomWorkflows）：带版本的工作流图、其编译为 routine，以及离线运行时。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-workflows

[English](README.md) | 中文

## 概述

此包承载原生 Work Flow 模块：一个按 Space 或个人范围划分的版本化节点与边图，其运行时是由图编译出的 Routine。`ctx.faberloomWorkflows` 拥有持久记录（创建、列出、读取、更新、状态、校验、编译、删除），并带 DAG 校验与 `compileWorkFlow`。激活流程会创建并激活其 routine；编辑流程会生成新版本并迁移等待中的执行。内置模板目录（`templates()`、`createFromTemplate()`）与可移植 JSON（`exportFlow()`、`importFlow()`）让用户从已校验的图起步并在部署间搬运流程；同一 JSON 存于知识中枢，并在 `graphify-out/templates/` 建立图。模型工具位于 `dsh-tool-faberloom`。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在存在 `ctx.storageDomain` 与 `ctx.faberloomRoutines` 处挂载此行。该服务在首次使用时惰性打开 `faberloom_workflows` 域，并随调用插件的 fiber 一起关闭，因此释放该 fiber 即移除。每个操作都携带已认证执行者；本切片仅允许所有者读取或管理其流程。激活会拒绝无效图，也会拒绝处理器名称未被已挂载处理器注册的图。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomWorkflows` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件；图工具位于 `dsh-tool-faberloom` 且可选启用。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **控制流是被门控的，而非循环的** — 来自 `condition` 节点、分支条件以 `== true` 或 `== false` 结尾的边会编译为步骤 gate：目标步骤仅在条件的 `{passed}` 结果匹配时运行，否则被跳过。循环与更丰富的控制流仍要等 v2 图执行器；聊天工具、浏览器编辑器、调度、共享、存活检测与本模板目录均已就位。
- **模板只提出图，绝不携带凭据** — 模板带有节点、边与权限，但不含邮箱、Space 或代理绑定；所有者在激活时选择这些，导入会在存储前校验图。
- **访问是按操作的，而非仅所有者** — 读取与编辑会查询 `ctx.faberloomShares`；共享授权以 `pending` 起始，只有 `active` 授权才放行，跨用户授权镜像到 MWT.ONE 控制台。

未发布 invariant companion，因为该服务只拥有一个持久图关系，且其单元与集成测试已断言它；这些测试之外不存在会分叉的观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

图是事实来源，编译出的 `routineId` 是派生产物；运行时复用 routines 引擎及其调度器，而不新增第二个执行器。契约与阶段见 Work Flow 模块的提案 Agent Note。

</details>
