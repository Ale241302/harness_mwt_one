---
description: "原生产品 Space 会话组合（ctx.faberloomSessionAgent）：Space 会话以其负责代理的 persona、工具平面与技能运行；以 @Name 开头的消息使其轮次运行在该目录代理的路由上。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-session-agent

[English](README.md) | 中文

## 概述

会话组合服务（`ctx.faberloomSessionAgent`）让 Space 会话以其负责代理运行：安装该代理的 persona、工具掩码与技能指令，并发布其路由（provider、model，以及命名其 API key 的引用）。Space 之外的会话保持部署组合不变；组合发生在被等待的 `agent/created` 窗口内，即首个轮次之前。同一服务还解析会话可读的 **Space 作用域**：其自身 Space、其下所有子 Space，以及用户在本会话中授予的 Space。同一服务按提及路由单个轮次：以 `@Name` 开头的消息使该轮次运行在目录中该名称代理的路由上，而下一个不含提及的轮次回到会话自身的路由。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在同时存在 `ctx.agents`、`ctx.faberloomSpaces`、`ctx.faberloomAgents`、`ctx.faberloomAgentPlane` 与工作区注册表的组合中挂载此行，并把 `ownerId`、`role`、`companyId`、`readOnly` 设为行为身份。该服务注册 `ctx.faberloomSessionAgent`，从每个会话的工作目录解析其 Space 代理，并通过 `agent.ctx.inject` 把组合安装到该代理的作用域上。它作用于挂载时列出的代理以及每一个 `agent/created`；组合随其代理一同释放。同一服务通过 `routeFor(agent)` 发布代理的模型路由：provider、model，以及由代理 id 派生的凭证引用；仅当代理同时声明了 provider 与 model 并保存了 API key 时才存在。会话控制器经 `ctx.get('faberloomSessionAgent')` 读取它，将其作为会话默认路由（低于任何显式选择），并用代理自己的 key 而非部署连接认证该路由。

每个 Space 会话还会获得 `faberloom:space-scope` 提示段落：当前 Space、其下每个可读子 Space，以及任何已授予的 Space，各自带有绝对文件夹、记忆、精选上下文、代理、技能、harness 产物（`AGENTS.md`、`.agents/`、`.claude/`）与文件夹顶层条目。文本在每个轮次的第一个步骤重建；产品状态未变时文本保持不变，因此提示前缀保持稳定。兄弟、祖先或无关 Space 只在“其他 Space”下以标题列出；读取它需要用户批准 `faberloom_spaces_open_read`，该调用记录一个 `faberloom/space-read-grant` 会话事件。授予在该会话内持久，将该 Space 子树加入作用域，且从不扩大可写沙箱根。

对每个存活代理，该服务还注册按轮次的 `@Name` 路由。它从某个步骤领取的消息中读取提及（请求瀑布本身不携带消息），只把被点名代理的 provider、model 与凭证引用施加到该轮次的请求上，并在下一个不含提及的轮次恢复会话自身的路由。提及在该轮次优先于会话自身的路由，包括组合会话起始所用的 Space 代理路由。`@` 选择器插入 `@Name` 及其后的一个空格，名称必须与目录代理的确切名称匹配；未知名称、缺少目录或平面、或缺少 provider、model、key 三者之一的代理，都不改动请求，因此提及绝不会让轮次失败。

-----

<a id="model-experience"></a>
## 模型体验

### 会话组合

#### 模型看到的内容

Space 会话的请求把负责代理的 persona 作为 `deployment:persona-prefix` 段落携带，把该 Space owner 的指令作为 `faberloom:space-directive` 段落携带（当记录设置了它时），把列出代理技能的简短 `faberloom:session-agent` 指令携带，把描述其可读子树的 `faberloom:space-scope` 段落携带，并携带移除了被禁用来源工具的工具集。Space 之外的会话看到部署组合不变。

#### Token 影响

每个该会话的请求携带一个 persona 段落、一个作用域段落，以及当代理声明技能时的一条简短指令；作用域受 `maxScopeChars`（默认 24,000 字符）与 `maxScopeSpaces`（默认 40 个 Space）限制。被移除的工具也从请求中移除其 schema。

#### KV 缓存影响

作用域未变时前缀稳定：组合在首个轮次之前安装一次，按轮次刷新只在 Space 树、其记录或其 harness 文件确实不同时替换段落文本。读取授予或新建子 Space 会产生新的段落文本，并可能从作用域段落起使复用失效。

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
- **作用域跟随 Space 树，而不是文件系统。** 子 Space 之所以在作用域内，是因为其记录把当前 Space 命名为 `parentId`；仅仅嵌套在另一个 Space 文件夹里的文件夹不是子 Space。对于 `parentId` 出现之前创建的文件夹，Spaces 面板在加载时修复层级。
- **读取授予是会话状态，不是新的产品权限。** 它记录该会话可以读取行为身份本已可读的 Space；spaces 服务仍会拒绝该身份不可读的 Space。授予是一个仅日志事件，因此在恢复后仍然存在，并在首个请求前重放；它不改变 Space 的成员或共享。
- **外来 Space 的读取在文件工具处被拒绝。** `read`、`read_image`、`write`、`edit`、`glob`、`grep`、`bash` 与 `pwsh` 都会对照可读文件夹检查；位于作用域之外 Space 下的路径会被拒绝，并提示使用 `faberloom_spaces_open_read`；shell 命令会按 token 扫描绝对或相对文件夹拼写。不解释 shell 语法，因此混淆后的命令仍可能到达同一个用户自有文件；作用域是授权与发现，不是操作系统隔离边界。
- **作用域每个轮次读取一次。** 轮次中创建或重命名的 Space 会在下一个轮次出现，而不是同一轮次。

不发布 invariant 伴随包，因为该服务的单元测试已断言组合矩阵与释放。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

persona 以与子代理组合相同的方式遮蔽 `deployment:persona-prefix`，因此 Space 会话无需新的提示槽即可读作其代理。工具掩码复用 `ctx.faberloomAgentPlane`，因此工作区会话与委托子代理强制同一个平面。解析链（工作目录 → 工作区 → Space → 代理）与 `spaces_ask` 调用方检查所用的一致。

按轮次的路由位于两个代理作用域的监听器上：`agent/pre-step` 在步骤开启前捕获被领取消息中的提及，`agent/request`（以 `prepend` 注册，因而位于最外层）在链的其余部分解析出会话自身路由后施加该路由。仅凭 `agent/request` 无法读取提及，因为循环只在该瀑布之后才把被领取批次提交到日志。由于循环会记录请求所用的 header——模型可见输入的可重建性规则——被提及的路由会成为下一轮的种子；因此该监听器恢复它在提及前捕获的路由。通过 `faberloomAgents` 与 `faberloomAgentPlane` 传入被点名的代理；提及不新增任何服务。

带 key 的实时冒烟（`tests/routing-live.e2e.ts`）对真实来源运行三个轮次，并在缺少各自所需凭证时自动跳过：目录代理自己的 key 打到 OpenAI（`OPENAI_API_KEY`）、无 key 的代理保持部署 DeepSeek 路由，以及带 key 的代理用自己的 key 打到 DeepSeek（`DEEPSEEK_API_KEY`）。本检出中的 OpenAI 账户没有额度，因此该轮次以提供商自身的额度耗尽响应体结束，成为类型化的 `QUOTA` 结果；这就是通过结果，因为其消息点名了提供商，且只可能来自 OpenAI。

</details>
