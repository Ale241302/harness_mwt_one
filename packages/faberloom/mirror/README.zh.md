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
| `skillsRoot` | - | owner 技能根；默认为 `<home>/skills`。 |
| `globalSkillsRoot` | - | 提供文档的一侧向对端提供的部署范围 Admin/CEO 技能版本；从不写入。 |
| `storagesRoot` | - | `single` 布局域文档的根；默认为 `<home>/storages`。 |
| `platform` | `FABERLOOM_MIRROR_PLATFORM` | 本进程报告自己是哪一侧；除非部署指定 `web`，否则为 `desktop`。 |
| `intervalMs` | - | 两轮之间的毫秒数；默认 120000。 |
| `debounceMs` | - | 本地改动在推送前等待的毫秒数；默认 3000。 |

缺失的每一项接线都会在日志中指名，随后镜像保持关闭。它绝不半接线运行，且失败的一轮只记日志：下一个间隔重试，因此网关中断永远不会破坏 Host。

每一轮都会写入 `<home>/mirror-status.json`：是否启用与是否活跃、仍缺哪些接线、所连接的路由与账号、运行了多少轮及失败多少轮、请求或一轮被拒绝的最近原因，以及对端上一次应答的文档中每个域与技能的计数。该文档就是运维人员的一行状态，`ctx.faberloomMirror.refreshStatus()` 可按需重写它。

内部凭据是部署端在两侧设置的同一个共享密钥（`FABERLOOM_MIRROR_KEY`）：网关把它注入每个子进程并在路由上比对，owner 的 `dsh` 则在每次镜像工具调用时校验它。偏好每账号一把密钥的部署写入 `<dataDir>/<id>/.mirror-key`，路由会先于共享值读取它。

### 行在哪里读写

产品域是惰性打开的：在其所属服务首次触碰之前，`ctx.storageDomain.get(name)` 返回 `undefined`，因此只询问设施的遍历只会看到恰好被其他代码打开的少数域，并在一个持有其记录的 home 中把其余每个域报告为 `domain-not-open`。`src/store.ts` 改为对每个被镜像的域作答：进程持有打开的域时使用它（其内存状态具有权威性，写入走该域自己的写链），否则使用介质上的文档，也就是该域首次打开时加载的同一个文件。写入介质的行会被之后打开的域读到，经由打开的域写入的行则照常由该域发布。

创建文档需要其所有者盖印的格式版本，而只有介质携带它：对端发送的文档按域给出该版本，双方都未物化的域保持不处理并被报告，而不是猜测。

### 承载什么

`src/domains.ts` 中的 `FABERLOOM_MIRROR_DOMAINS` 即传输范围：代理、例程、工作流、空间（含捕获的 Space 记忆）、上下文、连接、授权、看板、入站、MCP 令牌，以及 Space 与会话共享。本进程未挂载的域会被报告为跳过，绝不读作空，因为两个 home 保有不同行，缺失的域并不是删除。

`workspace` 注册表有意不在该范围内。工作区记录指向一个绝对文件夹以及创建它的机器的会话身份，而拥有该注册表的服务只在打开时构建一次有序视图，从不采纳在其旁边写入的行（工作区信息流会丢弃它从未知道的 id），因此被携带的行会在一个忽略它的注册表中指向另一侧不存在的文件夹。Space 是产品中随行的工作区域，并带着它的记忆与上下文一起传输。

技能以文件形式传输：`$DSH_HOME/skills/<name>/SKILL.md` 成为文档 `skills` 映射中的一条。部署端自己的只读目录（`/opt/skills-catalog/<role>`、`/opt/skills-shared`）不被镜像。配置了 `globalSkillsRoot` 的一侧（网页端，指向部署范围的 Admin/CEO 技能版本）也会提供这些技能包，owner 自己的同名技能包优先；它从不写入该目录。

部署基线 agent（`seeded`、无 owner）的 `agents` 行保留在本地，因为每个 home 都用自己的 id 播种它们。它们可由 owner 编辑的设置经 `faberloom_agents` 的虚拟 `baseline` 表（`src/baseline.ts`）按 agent 名称传递：读取时投影每个本地基线行，写入时修补该名称的本地行并把已连接的 agent 绑定到本地 id，墓碑永远不会删除基线 agent。供应商密钥在 owner 自己的 home 之间随该行传递：存储从凭据接缝预读它，写入时存入接收方的接缝，从不写入 `agents` 行。

### 冲突规则

每个被同步的行都有一条日志条目，持有两个摘要：本地值，以及上次触碰它的同步所记录的远端值。仅当本地仍持有那次同步留下的内容、且远端值此后发生了变化时，传入的远端行才会被写入。两侧都改过的行保留本地值，报告为 `keptLocal`，并被推回。只有本地改过的行会被推送。本地完全不持有的行会被写入，首次拉取正是借此落入另一个 home 的行。本侧从未记录过日志的行，在本地缺失**或**两侧已持有相同值时落地：两个各自填充的 home 在第一个周期记录彼此一致，而不是把每个相同的行都发送回去。

本地删除以墓碑形式推送，远端墓碑会被应用，因此删除在同一个规则下双向通行。

日志在每个受保护的周期之后写入 `mirror-status.json` 旁边的 `mirror-journal.json`，并在进程的第一个周期之前读取一次，因此重启后仍按上述规则处理，而不是把每一行不同的数据当作首次同步。为其他 owner 或网关记录的日志，或无法解析的日志，会被忽略。

日志记录为已同步、值仍在本地，而对端在应答该域时却不含此行的行会被再次推送：从旧状态重写的介质会丢失日志已记录的行，重新发送它们使一个周期能够自我修复。对端完全无法读取的域不是删除的证据，从未应答的对端也不是。

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
- **工作区注册表条目不传输。** 它的文件夹和会话属于创建它的机器；Space 是随行的工作区域，工作区在每台持有该文件夹的机器上各自注册。
- **技能是文件，不是行。** 技能除内容摘要外没有日志条目，因此两侧同时重命名的技能包会保留两个名字。
- **没有任何进程打开的域若使用非 JSON 介质则无法读取。** 存储读取介质自身的 `single` 布局文档；把被镜像的域路由到其他介质的部署，只能在某个服务打开该域期间访问它。
- **新文档需要对端的版本戳。** 双方都未物化其域的行会被报告（`domain-not-open`），而不是以猜测的版本写入，因为错误的版本戳会让该域下一次打开被拒绝。
- **接线只在加载时读取一次。** `consoleToken` 和 `gatewayUrl` 来自进程环境，由桌面端在启动 harness 时填入，因此安装在运行中续期的令牌要到下一次启动才会生效。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

`src/document.ts` 持有版本规则、路由路径以及行与技能的摘要；`src/domains.ts` 持有传输范围；`src/store.ts` 持有介质视图（优先打开的域，否则介质文档），`src/sync.ts` 持有其上的存储域遍历，产品备份也使用它。文档版本在任何行被检查之前就被拒绝，因此未知格式永远不会走到写入。`tests/medium.spec.ts` 在真实 JSON 后端上启动一个仅用于测试的 `cordis.yml`，固定存储存在的理由；`tests/store.spec.ts` 固定存储必须拒绝的每一种介质形态。

</details>
