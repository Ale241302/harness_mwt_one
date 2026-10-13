---
description: "原生产品 Space 会话组合（ctx.faberloomSessionAgent）：Space 会话以其负责代理的 persona、工具平面与技能运行；以 @Name 开头的消息使其轮次运行在该目录代理的路由上。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-session-agent

[English](README.md) | 中文

## 概述

会话组合服务（`ctx.faberloomSessionAgent`）让 Space 会话以其负责代理运行：安装该代理的 persona、工具掩码与技能指令，并发布其路由（provider、model，以及命名其 API key 的引用）。Space 之外的会话保持部署组合不变；组合发生在被等待的 `agent/created` 窗口内，即首个轮次之前。同一服务按提及路由单个轮次：以 `@Name` 开头的消息使该轮次运行在目录中该名称代理的路由上，而下一个不含提及的轮次回到会话自身的路由。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在同时存在 `ctx.agents`、`ctx.faberloomSpaces`、`ctx.faberloomAgents`、`ctx.faberloomAgentPlane` 与工作区注册表的组合中挂载此行，并把 `ownerId`、`role`、`companyId`、`readOnly` 设为行为身份。该服务注册 `ctx.faberloomSessionAgent`，从每个会话的工作目录解析其 Space 代理，并通过 `agent.ctx.inject` 把组合安装到该代理的作用域上。它作用于挂载时列出的代理以及每一个 `agent/created`；组合随其代理一同释放。同一服务通过 `routeFor(agent)` 发布代理的模型路由：provider、model，以及由代理 id 派生的凭证引用；仅当代理同时声明了 provider 与 model 并保存了 API key 时才存在。会话控制器经 `ctx.get('faberloomSessionAgent')` 读取它，将其作为会话默认路由（低于任何显式选择），并用代理自己的 key 而非部署连接认证该路由。

对每个存活代理，该服务还注册按轮次的 `@Name` 路由。它从某个步骤领取的消息中读取提及（请求瀑布本身不携带消息），只把被点名代理的 provider、model 与凭证引用施加到该轮次的请求上，并在下一个不含提及的轮次恢复会话自身的路由。`@` 选择器插入 `@Name` 及其后的一个空格，名称必须与目录代理的确切名称匹配；未知名称、缺少目录或平面、或缺少 provider、model、key 三者之一的代理，都不改动请求，因此提及绝不会让轮次失败。

-----

<a id="model-experience"></a>
## 模型体验

### 会话组合

#### 模型看到的内容

Space 会话的请求把负责代理的 persona 作为 `deployment:persona-prefix` 段落携带，把该 Space owner 的指令作为 `faberloom:space-directive` 段落携带（当记录设置了它时），把列出代理技能的简短 `faberloom:session-agent` 指令携带，并携带移除了被禁用来源工具的工具集。Space 之外的会话看到部署组合不变。

#### Token 影响

每个该会话的请求携带一个 persona 段落，以及当代理声明技能时的一条简短指令；被移除的工具也从请求中移除其 schema。

#### KV 缓存影响

在会话生命周期内前缀稳定：组合在首个轮次之前安装一次，且从不重读。

### 按轮次的 `@Name` 路由

#### 模型看到的内容

最新用户消息以 `@Name` 开头的轮次不携带新的提示段落：其请求运行在该目录代理的 provider 与 model 上，并用该代理的 key 引用认证，该轮次的回复由该代理的模型生成。其后不含提及的轮次再次运行在会话自身的路由上。名称本就在已被记录的、会进入日志的用户消息文本中；不新增任何路由或选择记录。

#### Token 影响

无按轮次的 token 开销：提及改变的是路由，而不是请求内容。

#### KV 缓存影响

被提及的轮次是另一条模型路由，因此其前缀不与会话自身的路由共享。其后不含提及的轮次恢复会话的路由及其前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **模型路由需要 provider、model 与 key。** 缺少其中任一的代理不发布路由，其会话保持部署默认值。路由的凭证引用在凭证缝中命名代理的 key，并在请求时由代理 id 派生；它从不携带 key 值，也从不写入会话日志。对此类代理的提及同样被忽略。
- **提及路由从进程内存恢复。** 循环会记录它发出的每个请求，因此被提及轮次的 header 就是该代理的路由；服务记住提及之前会话自身的路由，并在其后不含提及的轮次重新施加它。该内存是进程本地的：恢复之后，会话自身的路由即最后一次记录的 header，因此最后一次请求为提及的会话会一直保持该代理的路由，直到另一次提及将其替换。匹配不到目录代理的名称，或缺少完整带 key 路由的代理，都不改动任何东西。
- **解析需要工作区镜像。** 工作目录不是被某个 Space 镜像的已注册工作区的会话不携带组合，这对普通会话而言是正确默认值。提及路由不需要该镜像：它直接读取目录与代理平面。
- **在工作区注册之前启动的 Space 会话不会被组合。** 会话创建时工作区必须已存在；Spaces 面板在打开 Space 时注册它。

不发布 invariant 伴随包，因为该服务的单元测试已断言组合矩阵与释放。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

persona 以与子代理组合相同的方式遮蔽 `deployment:persona-prefix`，因此 Space 会话无需新的提示槽即可读作其代理。工具掩码复用 `ctx.faberloomAgentPlane`，因此工作区会话与委托子代理强制同一个平面。解析链（工作目录 → 工作区 → Space → 代理）与 `spaces_ask` 调用方检查所用的一致。

按轮次的路由位于两个代理作用域的监听器上：`agent/pre-step` 在步骤开启前捕获被领取消息中的提及，`agent/request`（以 `prepend` 注册，因而位于最外层）在链的其余部分解析出会话自身路由后施加该路由。仅凭 `agent/request` 无法读取提及，因为循环只在该瀑布之后才把被领取批次提交到日志。由于循环会记录请求所用的 header——模型可见输入的可重建性规则——被提及的路由会成为下一轮的种子；因此该监听器恢复它在提及前捕获的路由。通过 `faberloomAgents` 与 `faberloomAgentPlane` 传入被点名的代理；提及不新增任何服务。

</details>
