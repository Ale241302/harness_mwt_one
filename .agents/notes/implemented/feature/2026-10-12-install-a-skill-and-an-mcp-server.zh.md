# Agent Note: Install a skill from a folder and register an MCP server

Status: implemented

[English](2026-10-12-install-a-skill-and-an-mcp-server.md) | 中文

## Problem

产品能展示某个角色、部署的共享目录以及 owner 已上传的技能，但指向一个装着技能的文件夹的用户没有办法安装它，也没有办法移除产品已复制的那一个。用户提供的技能只活在技能提供方自身的各个根碰巧会看的地方，而把它安装到某个项目根意味着手工摆放文件。MCP 服务器也好不到哪去：harness 可以挂载组合里写死的那套固定服务器，但没有按 owner 持久化用户自有服务器的配置，没有在保留之前证明某个服务器可连接的手段，也没有不重启就新增一个的办法。

## Decision

**一个文件夹会作为技能安装到两个根之一。** `packages/faberloom/view` 新增 `installSkill(source, destination, replace?, workspaceRoot?)`，并由 `skillInstallTargets()` 在写入任何东西之前报告这两个根，由 `skillInstalls()` 列出调用方的安装，由 `uninstallSkill(name, destination)` 移除其中一项。工作区安装写入 `<workspaceRoot>/.dsh/skills`，即文件系统技能提供方已为项目扫描的 rank-100 根，从 `sandboxPolicy.resolve().workspaceRoot` 解析得到；全局安装写入 `$DSH_HOME/skills`，空的 workspace root 视为没有工作区。

**校验先于每一次写入。** `skillCandidates` 在源目录持有 `SKILL.md` 时把它当成单个技能目录，否则当成由技能目录组成的目录，并在发生任何复制之前读取并检查每个候选项的 front matter 名字，因此被拒的名字不会留下半装的文件夹集合。整个技能目录连同其资产一起复制 —— 唯一例外是 owner 的 `.shared-by` 发布者标记 —— 同名技能除非设置 `replace`，否则跳过。整次调用可以在根存在之前就被拒（`read-only`、`no-workspace`、`source-missing`、`outside-workspace`、`not-a-skill`），单个候选项也可以在正在运行的调用中被拒（`name-missing`、`name-illegal`）或被跳过（`exists`）。

**安装是持久化的。** 每次安装都在 `faberloom_skill_installs` domain 里写一行，以 owner、destination 与 name 为键，记录来源、解析出的根和时间点，因此一次安装可以作为一次安装被列出和移除，而不是作为某个技能根下未命名的文件。

**模型工具与面板共用同一个方法。** `packages/faberloom/tool-faberloom` 里的 `faberloom_skill_install` 工具调用同一个 `installSkill` 方法，从会话的 sandbox policy 取工作区根并回退到会话的工作目录，而 `packages/client/ui-faberloom` 里的 Skills 界面询问用户装到哪个 destination，并在调用前显示解析出的根。

**约束使用包自己的路径惯例，而不是 `ctx.fs`。** 安装在 workspace 下解析候选项，用包自己的 `resolve()` 加 `sep` 比较检查包含关系，并用 `node:fs`（`cpSync`、`rmSync`、`mkdirSync`）复制，因为 `ctx.fs` 没有二进制复制操作，且解析出的是它自己的不透明 target，那些 target 可能是相对于 workspace 的。

**一个新包持有用户的 MCP 服务器。** `packages/faberloom/mcp-registry`（`@deepseek-ai/dsh-faberloom-mcp-registry`）通过持久的 `faberloom_mcp_registry` domain 发布 `ctx.faberloomMcpRegistry`，按 owner 与服务器名各一条记录，保存传输方式（stdio 带 `command`、`args` 与 `cwd`，或 streamable-http 带绝对的 HTTP(S) `url`）、条目名、启用标志与时间戳。

**每个 header 与环境值都是秘密。** `save` 把每个值写入凭据 seam，引用由 owner、服务器与条目名派生 —— `MCP_SECRET_REF_PREFIX` 加上三个部分的大写十六进制 UTF-8，因此任何两个部分都不会碰撞，且引用始终是合法的环境变量名 —— 记录只保留 `{ name, credentialRef }`。面向调用方的读取会从 `credentials.describe` 投影出 `present`，因此值从不离开宿主，任何读取都无法返回它。

**probe 在保留之前证明单个候选项。** `probe(input)` 在注册表 fiber 之下、一个隔离 scope 内挂载 MCP 客户端，等待连接，列出它注册的 `mcp__<name>__` 工具，并总是释放该 scope，返回 `{ ok: true, tools }` 或 `{ ok: false, failure, detail }`，其中 `failure` 为 `unreachable`、`bad-credential` 或 `protocol`，而 `detail` 携带服务器最深处的消息，并把每个提供的秘密替换为 `[redacted]`。

**每个已启用的服务器都在进程全局范围挂载。** 已启用的服务器通过 `ctx.plugin(dsh-mcp-client, config)` 在注册表自己的 scope 挂载，这正是 `dsh-acp` 每个会话所用的机制，在这里则是每个进程一次。`save` 在挂载新客户端之前先卸载旧的，`remove` 在删除之前先卸载，已禁用的服务器从不挂载，`apply` 在启动时挂载每一条已启用记录。这些工具属于全局工具注册表，而 agent 循环在每个请求上重新组装它，因此已在运行的会话在下一个请求里就能看到 `mcp__<name>__<tool>` 而无需重启，而已经在途的那个请求看不到。

**设置页是这些服务器的用户界面。** `packages/client/ui-faberloom` 把该页面贡献进 `settings.section`（id 为 `faberloom-mcp-servers`，order 为 30）：它列出该 owner 的各服务器及其传输方式、是否启用与挂载、以及存在哪些凭据 —— 绝不显示值 —— 通过指名传输方式与其进行认证所用的值来新增一个（这些值写入凭据 seam），在保存前用一次真实连接测试一个候选项并显示它发现的工具或带遮蔽明细的具名失败，并在一处就地确认之后就移除一个。浏览器只通过 `ctx.faberloomView` 上的新方法（`mcpServers`、`saveMcpServer`、`removeMcpServer`、`probeMcpServer`）访问注册表，其 owner 身份来自 Remote 的 `Config`，而不是任何调用参数，因此没有任何注册表代码进入浏览器。

## Alternatives considered

**像 opencode 那样存储 MCP 配置。** opencode 把它的 MCP 服务器放在一个配置文件里，外加一份单独的锁账本；产品改为在自己的存储 domain 里持有记录，因此配置是持久化的、按 owner 的，并通过与其他所有产品记录相同的 seam 读取，也无需再让第二个文件与 domain 保持一致。

**通过 `ctx.fs` 复制技能资产。** 技能复制要在目录树里搬运二进制资产，而 `ctx.fs` 暴露的是文本写入和不透明的已解析 target，而不是目录复制，因此把复制走它要么丢失字节，要么需要重新推导安装已经持有的路径。

**按会话挂载 MCP 服务器。** 按会话挂载会把已保存的服务器变成会话组合的事，并让已在运行的会话的下一个请求看不到它；在注册表自己的 scope 做一次进程全局挂载，会让每个工作区与 Space 从它们的下一个请求起就看到这些工具。

**按名字 probe 的工具。** `packages/faberloom/tool-faberloom` 在本文这个服务之上注册三个 MCP 工具——`faberloom_mcp_add`、`faberloom_mcp_list` 与 `faberloom_mcp_remove`——因此模型可以接过交给它的文档安装一个服务器、列出已安装的服务器并移除一个，而 `faberloom_mcp_add` 会 probe 候选项，probe 失败时不保存任何东西。按名字 probe 的工具有意不交付：本包的 `probe` 接受携带凭据值的完整候选项，因此只持有一个引用的调用方无法在不误导的前提下重测已保存的服务器。

## Consequences

技能安装到它将运行的工作区，或安装到部署的全局根，由提供方自己的根规则决定哪些会话能看到它，因此工作区安装抵达以此为根的会话，全局安装抵达每个会话。一次安装可以作为一次安装被移除，模型工具与面板以相同方式安装。工作区安装出现在安装账本里，而不在 `skills()` 表里，后者枚举角色目录、共享目录与 `$DSH_HOME/skills`；工作区根由已挂载的提供方实时发现，并由 `skillInstalls()` 记录。

MCP 服务器是持久化的、按 owner 的，其秘密只住在凭据 seam 里，因此任何读取 —— list、save 或 probe —— 都无法返回值。已启用服务器的工具从下一个请求起抵达每个会话与 Space。接受两个限制。挂载是进程全局的，因此两个 owner 启用同名服务器会让后一次挂载大声失败，那一行会报告 `mounted: false`，直到之后的 save 或启动重试。并且已保存的服务器无法按名字重测：模型工具与设置页可以安装、列出与移除一个服务器，但本包的 `probe` 接受携带凭据值的完整候选项，因此重测已保存的服务器意味着再次提供它的值。
