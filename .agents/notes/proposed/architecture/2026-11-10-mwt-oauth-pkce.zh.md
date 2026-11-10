# Agent Note: MWT.ONE 授权使用 PKCE，而不是聊天密码

Status: proposed

[English](2026-11-10-mwt-oauth-pkce.md) | 中文

## Problem

产品需要一条可跨重启的“连接 MWT.ONE”路径，并借此配置 MWT MCP 客户端。控制台的密码登录属于 host shell；在模型对话中索取密码会把凭据交给会话记录和每一轮模型。

## Proposal

**协议核心是一个纯模块。** `packages/faberloom/connections/src/mwt-oauth.ts` 生成 PKCE verifier 及其 S256 challenge，按精确的 loopback redirect 构建授权 URL，交换授权码并刷新令牌。它不做存储、不启动服务器，因此无需身份提供方即可测试。

**浏览器持有凭据。** Host 打开授权 URL，在 loopback 回调接收授权码并交换。密码永不进入模型、会话记录或插件包。

**Host 保存 refresh token 并配置 MCP 客户端。** 接入该模块的服务把令牌集写入凭据 seam，在 MCP 注册表中保存 `mwt` 服务器并附带 bearer 头，并在过期前刷新。断开时删除凭据与服务器行。

## Acceptance criteria

1. 注册 client id 与 loopback redirect 后，卡片打开提供方、接收授权码并显示已连接账户，用户无需在聊天中输入密码。
2. refresh token 跨重启保留；启动后 MCP 服务器行存在且其工具可应答。
3. 过期前刷新会替换 bearer 头且不重复服务器行。
4. 断开删除凭据与行；工具停止应答。
5. `state` 不匹配、拒绝授权或交换失败时报告可恢复错误且不保存任何内容。

## Risks

- 共享 client id 且 redirect 不精确会让其他本地进程截获授权码。客户端只能允许 host 绑定的 loopback redirect。
- refresh token 是长期凭据；它属于 host 凭据库，绝不写入 MCP 行或日志。
- MWT MCP 端点可能要求控制台令牌而非 IdP access token。声明卡片可用前必须确认该 audience。
- 提供方侧撤销才是权威；本地断开只遗忘记录。

## Alternatives considered

**在聊天中放密码表单。** 它把密码暴露给会话日志和模型，违反“插件不捕获凭据”的产品规则，也无法支持 MFA 或 SSO。

**直接复用控制台 `/auth/login/` 令牌。** 那是控制台会话，不是 OAuth 授权；无法在 host 控制下刷新，并把桌面端耦合到控制台私有登录结构。

## Verification

- `packages/faberloom/connections/tests/mwt-oauth.spec.ts`：PKCE 推导、授权 URL、授权码交换请求体、刷新，以及带状态的失败交换。
