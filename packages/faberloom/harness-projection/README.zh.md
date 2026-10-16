---
description: "原生产品模块（ctx.faberloomHarnessProjection）：把某个 Workspace 或 Space 自身的 harness —— 其智能体、技能、工作流、例程、记忆与上下文 —— 落到该领域自己的目录里。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-harness-projection

[English](README.md) | 中文

## 概述

Workspace 或 Space 就是一份目录。本包写入该目录的 harness：该领域的记录所登记的智能体与技能，加上它的工作流、例程、记忆与上下文，以每个客户端都会读取的指令文件形式落地（`AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`.gemini/`、`.agents/`、`.claude/`、`.kimi/`）。它是该领域的 harness，而不是整个目录库。`.faberloom/harness.json` 处的一份清单记录本次投影拥有什么，所以下一次运行只会撤回自己此前写下的内容，绝不触碰用户自己的文件。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在组合里挂载此行即可暴露 `ctx.faberloomHarnessProjection`：

```yaml
- id: faberloom-harness-projection
  name: '@deepseek-ai/dsh-faberloom-harness-projection'
  config:
    enabled: true
    maxListEntries: 20
```

| Config | 含义 |
|---|---|
| `enabled` | `refresh` 是否真的写入投影。缺失即为关闭，因此不需要目录摘要的部署不会得到它们。`project`、`readUsage` 与 `clean` 始终执行。 |
| `maxListEntries` | 每个生成列表在指名余量之前渲染的最多条数；默认 `20`。生成的指令会进入模型的请求，因此记录成百上千的领域绝不能把它们全部注入。 |

| 方法 | 作用 |
|---|---|
| `project(scope, root)` | 把完整投影写入显式目录，并返回写入的路径、剪除的路径与纳入的记录。 |
| `refresh(scope)` | 通过 `ctx.workspaceRegistry` 解析领域的真实目录并调用 `project`；领域没有已注册目录时返回 `undefined`。 |
| `readUsage(scope)` | 读取该领域的智能体、技能、工作流、例程、记忆与上下文，不写入任何东西。 |
| `clean(root)` | 撤回该目录清单声明的每一条路径，并返回它们。 |

### 领域从何而来

领域是 `{ kind: 'workspace', id, title }` 或 `{ kind: 'space', id, title }`。Space 解析为它所镜像的 Workspace（`spaces.workspaceId`），因此两种形态都写入真实目录：Workspace 自身的规范目录。不镜像任何 Workspace 的 Space —— 其区域是确定性的 `<DSH_HOME>/spaces/<ref>` 目录 —— 没有目录，`refresh` 报告 `undefined`，而不是写到领域之外。

### 用法从何而来

投影通过 `ctx.storageDomain.get(name)` 读取产品域，也就是 `faberloom-backup` 与 `faberloom-mirror` 所用的通用 `(domain, table, key)` 遍历。这里选择该遍历而非 `open(spec)`：投影面向的是领域而不是身份，而产品服务把每一次读取都挡在身份之后，因此它直接读取持久记录。本进程未打开的域 —— 或者它所拒绝的某一张已声明的表 —— 会被列入 `unreadableDomains`，绝不读作空领域，因为缺失的域并不是空的域。

| 生成的集合 | 产品记录 | 领域字段 |
|---|---|---|
| 智能体 | `faberloom_agents.agents` | `spaceId`，加上 Space 的 `agentId`；目录库的 `selections` 与 `outcomes` 不携带领域，故被排除 |
| 技能 | `faberloom_agents.agents.skills`，经 `ctx.skills` 解析 | 继承自声明它们的智能体 |
| 工作流 | `faberloom_workflows.workflows` | `scope = { kind: 'space', spaceId }` |
| 例程 | `faberloom_routines.routines` | `spaceId` |
| 记忆 | `faberloom_spaces.memory` 与 `faberloom_memory.teachings` | `spaceIds` / `scope = 'space'` 且带 `spaceId`，仅限已激活 |
| 上下文 | `faberloom_context.entries` | `spaceId` |

目录库标记为停用的智能体会被排除：它无法在该领域里运行。作用域指向某个智能体、某项技能、某个案例或全局的教导不携带 Space，按同一规则排除。

### 写入什么

指令文档是一份文本，写入 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`.gemini/AGENTS.md` 与 `.kimi/AGENTS.md`：客户端认识哪个名字就读哪个，而它们都不会顺着指向另一个文件的指针走。每个智能体得到 `.agents/<agente>.md`、`.claude/agents/<agente>.md` 与 `.kimi/agents/<agente>.md` —— frontmatter 带 `name` 与 `description`，在智能体同时声明 provider 与 model 时带一行 `model`，正文则是智能体的职责，也就是产品安装的 persona。每项解析成功的技能从技能注册表自身的定义写入 `.claude/skills/<skill>/SKILL.md` 与 `.kimi/skills/<skill>/SKILL.md`。`.claude/settings.json` 携带显式的空权限策略，因此投影绝不会放宽用户自己配置所允许的东西。

### 剪除

`.faberloom/harness.json` 列出本次运行写入的每一条路径。下一次运行会删除上一份清单声明、而本次不再写入的路径，以及被某次删除清空的目录；清单里不是领域内普通相对路径的条目会被拒绝，因此该文件列表永远到不了目录之外，而无法解析的清单会让本次运行完全跳过剪除。清单本身永不被剪除。`clean` 对每一条声明的路径遵循同一规则。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

注册时什么都没有。`ctx.faberloomHarnessProjection` 不注册工具、不注册提示段，也不写会话事件。它的产物只有通过被投影目录的文件才到达模型：`AGENTS.md` 及其同类文件会被工作目录位于该目录的智能体作为指令加载，而各技能的正文随着该目录自己的 `SKILL.md`，在某次 `skill` 工具调用加载它时同行。

#### Token 影响

在投影目录之外的会话，每次请求消耗为零。在该目录之中，生成的指令文档像任何其它指令文件一样加入请求前缀，受每个列表 `maxListEntries` 条加一行余量的约束；技能只在 `skill` 工具加载它们时计费。

#### KV 缓存影响

投影写入文件，从不触碰实时请求。在目录刚被投影的会话里，指令前缀变化一次，缓存为那一轮重新预热。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **技能来自该领域智能体的声明，而不是加载历史。** 今天没有任何产品存储记录某个会话加载了哪项技能：技能注册表持有目录（`.dsh/skills` 根与用户自己的技能），会话日志持有 `skill` 工具调用或 `skill-invocation` 消息，但两者都不是投影所需的按领域寻址。因此投影携带该领域智能体声明的技能，并把没有提供者能解析的声明名报告在 `unresolvedSkills` 里。按领域的技能使用存储属于 TODO；那才是把这个集合变成加载历史的改动。
- **智能体来自该领域登记的对象，而不是调用历史。** `faberloom_agents.agents` 通过 `spaceId` 携带领域，而 Space 的负责智能体正是会话组合自动安装的那一个；`selections` 与 `outcomes` 按智能体记录模型使用却不带领域，因此今天无法按领域过滤出调用历史。`@Name` 提及针对整个目录库解析（`faberloomSessionAgent` 读取 `listAgents()`），因此仅通过该目录中提及被调用的智能体不属于本领域的集合。
- **投影只走拉取。** 没有任何东西订阅 `domain.changed`；由调用方决定何时 `refresh`（保存 Space、打开 Workspace）。缺少该调用方时，目录会停留在上一次运行的投影。
- **被多个 Space 镜像的 Workspace 会投影最旧的那个 Space。** `faberloom_view` 以同一方式解析这一对，因此两者指名同一条记录；想要让人选择的部署应改为暴露该冲突。
- **写入需要领域的目录存在。** `project` 写入它收到的路径，并在其中创建所需的目录；调用方传入的若不是已注册的 Workspace 目录，就会在该路径里得到这份投影。
- **`refresh` 把缺失的指称报告为没有目录。** 本进程未打开的 spaces 域所不持有的 Space 同样没有目录，因此 `refresh` 返回 `undefined`，而不是把异常抛回刚刚保存该 Space 的调用方；`project` 与 `readUsage` 则会响亮地拒绝它。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

`src/usage.ts` 持有存储域遍历与领域解析，并校验它读到的每一条记录，因为持久介质是一道边界。`src/render.ts` 持有每个生成文件的正文，且是纯函数。`src/index.ts` 持有文件系统工作：写入、按上一份清单剪除、最后写入清单。智能体文件以显示名折叠出的 slug 命名，两个名字折叠成同一 slug 时加编号后缀。

</details>
