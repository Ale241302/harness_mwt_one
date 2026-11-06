# Agent Note：本地 OAuth 授权服务器与每个对话一个工作引用

Status: implemented

[English](2026-11-06-local-oauth-work-references.md) | 中文

## 问题

客户端此前只能复制 owner 在面板中签发的 bearer 令牌来连接。该令牌没有浏览器同意、没有过期时间、也没有按对话的目标：两个标签页共享同一个 owner 范围的面孔，而限定到空间的令牌没有命名用户所授权修订的持久句柄。MCP 传输对 socket 与 bridge 有一条认证路径，但没有任何东西把调用绑定到用户真正看到的空间或修订。

## 决策

**MCP 端点就是本地授权服务器。** 它发布 `/.well-known/oauth-authorization-server`，包含 issuer、MCP `resource`、`S256` 与对外 scopes。`GET /authorize` 只接受本地客户端 `faberloom-local`、精确 loopback redirect、S256 PKCE、精确 `resource`，以及绝不把 `faberloom_proposal_submit` 与其它工具混合的 scope 集。它渲染命名空间与全部 scope 的等待页，且不嵌入密钥；页面没有批准控件。已登录的产品面板列出待处理请求并调用 `decideAuthorization`（经由视图）；这是唯一消耗事务的路径。`GET /authorize/status` 随后以一次性授权码或 `access_denied` 重定向；`POST /token` 校验授权码、客户端、精确 redirect、resource 与 PKCE verifier，以一次原子更新标记授权码已用，并返回一小时令牌及其引用。本地 HTTP 客户端无法批准自己的请求，取消会消耗事务且不创建授权码。

**引用就是每个对话的目标。** 兑换时从连接（`tokenId`）、owner、授权空间与修订（客户端的 `revision` 或空间的 `updatedAt`）创建工作引用。它先写引用，再一次性写入带 `referenceId` 的令牌行，因此崩溃不会留下没有引用的活跃令牌。该令牌的每次调用都必须携带 `x-faberloom-work-reference`，`referenceMatches` 重新校验 owner、连接、空间以及引用未被撤销；空间本身每次调用都从 Spaces 重新读取。进程中没有全局活动空间，也不把 MCP 会话 id 当作对话。A1/A2 两个引用不能交叉，撤销引用或令牌会切断连接。

**旧令牌继续工作。** 没有引用（`referenceId: null`）的令牌保持原行为，覆盖整个 owner；引用头对它可选。面板签发的令牌在 OAuth 兑换创建引用之前仍是覆盖整个 home 的。

## 考虑过的替代方案

**在 OAuth 响应中复用已签发令牌。** 用户仍需复制密钥，令牌也没有绑定同意页或空间。现在授权码兑换在服务器内部创建令牌。

**全局活动空间。** 它会让 A2 的选择改变 A1 的目标，而验收禁止这一点。目标保存在引用中，按连接隔离。

**用 `mcp-session-id` 作为对话。** 会话是传输状态，bridge 会重建它；它不是持久授权记录。引用是存储且可撤销的。

**长期令牌。** 兑换签发一小时令牌；授权码五分钟，同意事务十分钟。撤销立即生效，不必等过期。

## 后果

浏览器流程从不要求用户复制密钥，面板在用户批准前准确显示令牌将携带的空间与 scopes。等待页无法批准自身，因此到达 loopback 端口的本地进程不能以 owner 名义铸造令牌；只有已登录的产品会话可以决定。兑换出的令牌天然比面板令牌更窄：空间受限令牌只携带提案工具，其引用绑定到该空间与修订。丢失引用的客户端无法使用令牌；撤销引用会关闭对话，即使客户端保留它。

D07 仍管辖远程 IdP 及其客户端元数据；本增量是 D02 允许的本地端点。授权表位于独立的 `faberloom_mcp_oauth` 域，因此令牌表保留既有行，`spaceId`/`referenceId`/`expiresAt` 对它们默认为 `null`。

## 验证

- `packages/faberloom/mcp-server/tests/oauth.spec.ts`：元数据 issuer/resource；等待页命名空间与 scopes 且不含令牌或批准控件；面板决定（`decideAuthorization`）批准；`/authorize/status` 返回授权码；兑换 → 令牌 + 引用 → 提案归档到空间；缺失与外来引用 401；A1/A2 两个引用不能交叉；没有 HTTP 批准路由；授权码重放与过期、事务过期、错误 verifier、错误 redirect、外来 resource、混合提案 scope 均拒绝；取消返回 `access_denied` 并消耗事务；撤销引用或令牌 401；旧令牌无需引用即可工作。
- `packages/faberloom/mcp-server/tests/tokens.spec.ts`：1.3 的令牌 scope/空间契约保持为绿。
- `packages/faberloom/view` 与 `packages/client/ui-faberloom`：令牌面板显示空间与一次性密钥；目录驱动的 scope 列表保持为绿。
