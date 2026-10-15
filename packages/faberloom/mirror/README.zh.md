---
description: "原生产品模块（ctx.faberloomMirror）：让桌面端的本地 home 与部署端 home 承载同一批产品行与技能文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-mirror

[English](README.md) | 中文

## 概述

部署端为每个账号保留一个 home（`/data/users/<id>`）；桌面端保留 `%USERPROFILE%\.dsh`。本包是二者之间镜像的桌面半边。`ctx.faberloomMirror` 在启动时以及按间隔拉取部署端带版本的传输文档，把其中的行应用到本地存储域，写入随文档而来的技能文件，监听被镜像域的 `domain/changed`，并以退避延迟经网关的镜像路由推送本地改动。另一半是 `gateway/mirror-route.mjs`。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

`faberloom-app` bundle 以停用状态挂载此行；部署端通过环境变量开启并命名其接线：

```yaml
- id: faberloom-mirror
  name: '@deepseek-ai/dsh-faberloom-mirror'
  disabled: !!js process.env.FABERLOOM_MIRROR_ENABLED !== '1'
```

| Config | 环境变量 | 含义 |
|---|---|---|
| `enabled` | `FABERLOOM_MIRROR_ENABLED` | 镜像是否运行。缺失即为关闭。 |
| `gatewayUrl` | `FABERLOOM_MIRROR_URL` | 承载镜像路由的 harness 源。 |
| `consoleBase` | `CONSOLA_API_BASE` | 控制台 API 基址；由 `consola.<host>` 推导出 `<host>`。 |
| `ownerId` | `FABERLOOM_MIRROR_OWNER` | 已登录的账号邮箱。 |
| `consoleToken` | `CONSOLA_TOKEN` | 桌面端登录时写入的控制台 bearer 令牌。 |
| `mirrorKey` | `FABERLOOM_MIRROR_KEY` | 该 owner 的产品 MCP 服务器接受的内部凭据。 |
| `skillsRoot` | - | owner 技能根；默认为 `$DSH_HOME/skills`。 |
| `intervalMs` | - | 两轮之间的毫秒数；默认 120000。 |
| `debounceMs` | - | 本地改动在推送前等待的毫秒数；默认 3000。 |

缺失的每一项接线都会在日志中指名，随后镜像保持关闭。它绝不半接线运行，且失败的一轮只记日志：下一个间隔重试，因此网关中断永远不会破坏 Host。

内部凭据是部署端在两侧设置的同一个共享密钥（`FABERLOOM_MIRROR_KEY`）：网关把它注入每个子进程并在路由上比对，owner 的 `dsh` 则在每次镜像工具调用时校验它。偏好每账号一把密钥的部署写入 `<dataDir>/<id>/.mirror-key`，路由会先于共享值读取它。

### 承载什么

`src/domains.ts` 中的 `FABERLOOM_MIRROR_DOMAINS` 即传输范围：代理、例程、工作流、空间（含捕获的 Space 记忆）、上下文、连接、授权、看板、入站、MCP 令牌、Space 与会话共享，以及工作区实体。本进程未挂载的域会被报告为跳过，绝不读作空，因为两个 home 保有不同行，缺失的域并不是删除。

技能以文件形式传输：`$DSH_HOME/skills/<name>/SKILL.md` 成为文档 `skills` 映射中的一条。部署端自己的只读目录（`/opt/skills-catalog/<role>`、`/opt/skills-shared`）不被镜像，owner 技能根之外的一切同样不被镜像。

### 冲突规则

每个被同步的行都有一条日志条目，持有两个摘要：本地值，以及上次触碰它的同步所记录的远端值。仅当本地仍持有那次同步留下的内容、且远端值此后发生了变化时，传入的远端行才会被写入。两侧都改过的行保留本地值，报告为 `keptLocal`，并被推回。只有本地改过的行会被推送。本地完全不持有的行会被写入，首次拉取正是借此落入另一个 home 的行。

本地删除以墓碑形式推送，远端墓碑会被应用，因此删除在同一个规则下双向通行。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

本身没有。`ctx.faberloomMirror` 不注册工具、不写提示文本。它对模型可见的面孔，是原生产品 MCP 服务器在其之上发布的两个工具：`faberloom_mirror_export` 返回一份文档，`faberloom_mirror_apply` 应用一份。

#### Token 影响

每次请求直接消耗为零：一轮是一次 HTTP 调用，不是模型调用。这两个工具只在另一个智能体调用它们时，为各自 JSON 参数与结果的代价计费。

#### KV 缓存影响

与实时请求无关：一轮从不触碰请求前缀。

-----

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **整文档请求。** 每一轮拉取完整文档并推送变化子集；行数极多的 home 会为每个间隔的整读付出代价。按表分页是下一片工作。
- **部署端需要两行改动。** 网关必须把 `FABERLOOM_MIRROR_KEY` 注入每个子进程，owner 的 `dsh` 才会接受镜像调用；它还必须挂载该路由（`installMirrorRoute(app, { dataDir: DATA_DIR })`）。在完成之前，镜像关闭并在日志中说明。
- **会话不传输。** 会话日志是按 cwd 的产物；共享一个会话的路径是 `faberloom-session-shares`，镜像不承载它们。
- **技能是文件，不是行。** 技能除内容摘要外没有日志条目，因此两侧同时重命名的技能包会保留两个名字。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

`src/document.ts` 持有版本规则、路由路径以及行与技能的摘要；`src/domains.ts` 持有传输范围；`src/sync.ts` 持有产品备份同样使用的存储域遍历。文档版本在任何行被检查之前就被拒绝，因此未知格式永远不会走到写入。

</details>
