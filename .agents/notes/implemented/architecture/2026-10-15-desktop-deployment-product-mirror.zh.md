# Agent Note: 桌面端与部署端互相镜像对方的产品数据

Status: implemented

[English](2026-10-15-desktop-deployment-product-mirror.md) | 中文

## Problem

桌面端启动自己的 harness，因此把产品行保留在 `%USERPROFILE%\.dsh`；部署端为每个账号在 `/data/users/<id>` 下保留一个 home，其网关为每个 owner 启动一个 `dsh`。这两个 home 是彼此分离的存储域卷，之间没有联邦，因此在一侧创建的代理、例程、Space 或技能，在另一侧根本不存在。此前的 MWT.ONE 模式把窗口变成部署端的客户端，从而掩盖了这个缺口，而这正是登录改造所移除的模式（[决定](2026-10-15-desktop-launch-backend-and-sign-in-card.zh.md)）。

两侧所需的一切此前都已存在。每一行持久化产品记录都是经由 `ctx.storageDomain` 可达的 `(domain, table, key) -> JSON` 元组，而产品备份已经在遍历它；技能是 `$DSH_HOME/skills/<name>/SKILL.md` 下的文件；网关已经为每个 owner 运行一个 `dsh`，并且已经反向代理到它；原生产品 MCP 服务器已经在 `<DSH_HOME>/faberloom-mcp.sock` 上监听，并带有自己的 bearer 凭据。桌面端这边，它已经把登录时获得的控制台令牌写入 `$DSH_HOME/.env`，并以 `CONSOLA_API_BASE` 与 `CONSOLA_TOKEN` 启动子进程，因此本地侧已经持有网关为同一账号也知道的凭据。

缺的是传输本身，以及两个活跃写入者之间的规则。

## Decision

**一份带版本的传输文档同时承载行与技能。** `FABERLOOM_MIRROR_FORMAT_VERSION` 在任何位置被检查之前校验，因此本构建不理解的文档会被拒绝且不产生写入。行以 `{domain: {table: {key: {deleted, value}}}}` 传输，这正是产品备份所执行的同一种通用元组遍历，另加活跃镜像需要而快照不需要的墓碑规则；技能以 `{name: SKILL.md 文本 | null}` 传输。

**镜像范围是自己的列表。** `packages/faberloom/mirror/src/domains.ts` 中的 `FABERLOOM_MIRROR_DOMAINS` 重述了备份的域，并补上快照省略的那些：工作流、上下文、Space 共享、会话共享与 Space 记忆表。快照范围与镜像范围是彼此独立的产品决定，因此镜像声明自己的范围，而不是继承备份的。进程未挂载的域会被报告为跳过，绝不读作空，因为两个 home 保有不同行，缺失的域并不是删除。

**Workspace 注册表条目不在该范围内。** 它的记录命名绝对文件夹与创建它们的机器上的 Session 身份，注册表服务在打开时构建一次有序视图，从不采纳写在其旁的行（Workspace feed 会丢弃它从未见过的 id），因此携带的行会在另一台机器上指向不存在的文件夹，而注册表会忽略它——第一版实现携带了它，桌面端的 Workspace 侧边栏保持空白，而本地文件却持有两个服务器文件夹。Space 是产品中可移动的工作区域，整块携带，包含记忆与上下文；存储只为范围声明的域作答，因此仍发送范围外记录的对端无法到达本进程的服务。

**网关路由是一个新模块，而不是 `server.mjs` 的一片。** `gateway/mirror-route.mjs` 导出 `installMirrorRoute(app, options)`；调用方用一行挂载。该路由默认对照网关自己的每用户状态文件校验 Bearer 控制台令牌（使用其他存储的调用方传入 `resolveOwner`），拒绝声称的 owner 与令牌不符的请求，解析内部凭据，自行解析 JSON 正文因此无需已挂载的解析器，并把一次 JSON-RPC `tools/call` 转发到 `<home>/faberloom-mcp.sock`。模块本身不读取任何产品数据。

**dsh 一侧经由两个新的 MCP 工具到达。** `faberloom_mirror_export` 与 `faberloom_mirror_apply` 是原生产品 MCP 服务器中的目录条目，由 `ctx.faberloomMirror` 实现。该服务作为独立的 bundle 行挂载，除非部署端开启否则停用，因此从不镜像的安装会把该服务以惰性状态携带，而网关自身的 profile 会以可读的拒绝而不是静默空操作来回答这些工具。

**内部凭据是一个共享密钥。** `FABERLOOM_MIRROR_KEY` 由部署端注入每个子进程，并在本地侧设置；当部署端为每个账号准备一把密钥时，路由还会读取每 owner 的 `<home>/.mirror-key`。这是部署端必须在两侧设置的唯一值；缺失时镜像关闭并留下明确日志。

**冲突规则是双值日志，而不是时间戳。** 每个被同步的行记录本地值的摘要，以及上次触碰它的同步所记录的远端值的摘要。传入的远端行仅当本地仍持有那次同步留下的内容、且远端值此后发生变化时才会落入。两侧都改过的行保留本地值，报告为 `keptLocal`，并被推回。本地完全不持有的行会被写入，首次拉取正是借此填充空的本地 home。本地删除推送墓碑，远端墓碑会被应用，因此删除在同一个规则下双向通行。按墙上时钟比较需要用户 PC 与容器之间的时钟一致，而本仓库没有任何部分能假定这一点。

**技能是文件，只读目录不被镜像。** 技能包的 Markdown 以文本跨越，其名称在构造路径之前按 harness 技能名规则校验。部署端自己的目录（`/opt/skills-catalog/<role>`、`/opt/skills-shared`）是安装器提供的内容，不是 owner 的行，因此留在文档之外。

## Alternatives considered

**在 `faberloomView` 上加两个 `@Remote` 方法。** 视图是浏览器端的读取面孔；镜像是带自己凭据的主机到主机传输，把它经客户端 Remote 走，等于把机器凭据放上为浏览器会话构建的线。

**复用 MCP bearer 令牌作为内部凭据。** 那些令牌由 owner 创建、存放在产品自己的域中、并可从面板撤销。网关是信任级别不同的另一个调用方，因此得到自己的凭据，而不是共享 owner 的。

**每行时间戳或向量时钟。** 两个不可信时钟加上每条记录一个字段，比日志所需的机器更多：日志用该服务本就计算的两个摘要回答了同一个问题。

**推送本地持有的每一行，并删除本地缺少的每一行。** 远端从未有过的本地行会在各处被创建，而远端持有、本地从未同步过的行会在第一轮就被删除。日志把两个方向都限定在某一侧确实改动过的行上。

**改桌面端身份补丁来挂载该行。** 该行属于 `faberloom-app` bundle，部署端与桌面端都挂载它；桌面端登录补丁配置的是每用户的值，而不是组合。

## Consequences

在任一侧创建的代理、例程、Space、记忆条目、连接、工作流或技能，会在一轮之内到达另一侧；两侧都改过的改动保留本地值并被报告，而不是静默丢失任一次写入。

接受三项代价。部署端必须把 `FABERLOOM_MIRROR_KEY` 注入每个子进程并挂载该路由，否则镜像保持关闭；那就是网关 spawn 环境中的一行，以及路由挂载点的一行。每一轮拉取整份文档，因此行数极多的 home 在按表分页出现之前，会为每个间隔付出一整次读取。会话不传输：会话日志是按 cwd 的产物，因此共享一个会话的路径仍是 `faberloom-session-shares`。

## Testing

`packages/faberloom/mirror/tests/document.spec.ts` 固定版本拒绝、结构校验、域列表、规范行哈希，以及含墓碑与不可达位置的遍历往返。`packages/faberloom/mirror/tests/sync.spec.ts` 驱动真实服务对抗一个假网关：一次拉取落入若干行与一个技能文件，一次本地编辑只被推送一次，空闲一轮不发送任何东西，远端改动落到本地从未触碰的行上，两侧都改过的行被保留并报告，墓碑被应用，传输失败只记日志。`packages/faberloom/mirror/tests/loader-composition.spec.ts` 经真实 Loader 启动一份测试专用的 `cordis.yml`，断言该行把数据拉入组合自己的域与技能根。`packages/faberloom/mcp-server/tests/mcp.spec.ts` 发布这两个工具，并固定导出、版本拒绝、被应用的行与被写入的技能。`gateway/tests/mirror-route.spec.mjs` 固定各项拒绝（无令牌、未知令牌、凭据不匹配、伪造 owner、缺少凭据）、密钥解析顺序，以及在真实 socket 上的转发请求字段与两种回答。
