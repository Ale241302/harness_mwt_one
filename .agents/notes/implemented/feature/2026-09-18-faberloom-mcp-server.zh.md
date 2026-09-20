# Agent Note: FaberLoom 的服务端面孔，使用 owner 自己的令牌

Status: implemented

[English](2026-09-18-faberloom-mcp-server.md) | 中文

## 问题

计划让 FaberLoom 站在 MCP 的两侧：既是 MWT.ONE 控制台的客户端，也是其他 AI 连接的**服务器**，从而可以在产品自己的浏览器之外启动与查看工作。前半已经交付；这一半什么都没有。harness 提供 `dsh-mcp-client` 与 resources，因此必须自己构建服务器：协议、传输、调用客户端的身份，以及外部智能体可以做什么的决定。

## 决定

`packages/faberloom/mcp-server`（`ctx.faberloomMcpServer`）持有服务端面孔。

**协议**是 MCP Streamable HTTP 端点之上的 JSON-RPC 2.0，实现为纯函数 `dispatch(host, message)`，因此协议无需 socket 即可测试。它回答 `initialize`、`ping`、`tools/list` 与 `tools/call`；通知得到 202 且无正文；故障回答 JSON-RPC 错误而不是挂起。

**传输**默认在每个 owner 上绑定一个 **unix socket**（`<DSH_HOME>/faberloom-mcp.sock`），因此一个容器里的多个 owner 永不冲突，对外暴露方式由部署决定；也可以改用回环 `port`，开发与测试用的就是它，因为 Windows 上的 Node 无法绑定任意文件系统路径。只有该行启用时才会监听。

**身份**是 owner 在 Conexiones 中创建并交给该客户端的 bearer 令牌。令牌存在产品自己的域（`faberloom_mcp`）中，端点会拒绝缺失、未知或已撤销的令牌，以及属于其他 owner 的令牌 —— 即使本进程能读到它。撤销是面板中 owner 的行为；harness 从不持有这些令牌。

**工作**就是产品自己的操作：`faberloom_overview`、`faberloom_routines`、`faberloom_executions`、`faberloom_teachings`、`faberloom_teaching_record`、`faberloom_teaching_revoke` 与 `faberloom_routine_run`。每次调用都以面板所用的同一身份行事，且 `faberloom_routine_run` 经由例程引擎，因此记录效果的步骤仍需要有效授权 —— 外部智能体无法扩大 owner 已授权的范围。

**网关**负责发布：`POST /mcp` 通过读取持有该令牌的用户的产品令牌文件来解析 bearer 令牌，在该 owner 的 harness 未运行时用其上次登录保存的身份启动它，并把请求转发到其 socket。网关不存令牌，只定位它们。

## 考虑过的替代方案

- **在每个按用户的 dsh 内开 TCP 端口，由 nginx 代理。** 否决：端口必须按用户分配与路由，而每个 home 一个 socket 无需分配，并随进程消亡。
- **独立的 MCP 容器。** 目前否决：它无法驱动按 owner 的产品服务，而每 owner 常驻进程是 E8 的工作，不属于本切片。
- **由网关创建令牌。** 否决：产品拥有令牌，因此撤销一个令牌不应需要网关；网关只解析它们。
- **让 `tools/call` 授予自主权。** 否决：守卫的执行点仍是例程引擎，这意味着外部智能体可以启动工作，但不能授权效果。
- **流式响应（SSE）。** 推迟：第一切片每次请求只回一个 JSON 正文；尚无流式，且这些工具返回很快。

## 后果

- 另一个 AI 可以读取 owner 的空间、例程、执行与教学，并可以记录或撤销教学，使用的对象与面板所见相同。
- MCP 请求只在 owner 的 harness 运行时到达；网关会用保存的身份启动它，因此 owner 不必一直开着浏览器标签页。
- 令牌在面板中连同其客户端标签可见，因此连接一个智能体是显式、可撤销的行为，而不是隐藏的凭据。
- 这七个工具以读为主；空间、代理与看板的写入等待各自的守卫语义。
