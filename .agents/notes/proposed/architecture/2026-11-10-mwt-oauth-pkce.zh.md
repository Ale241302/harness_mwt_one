# Agent Note: MWT.ONE 入门使用设备令牌，而不是聊天密码

Status: proposed

[English](2026-11-10-mwt-oauth-pkce.md) | 中文

## Problem

产品需要一条“连接 MWT.ONE”路径：选择客户、跨重启保留、并挂载该客户的 MCP 服务器。IdP 不提供动态注册，其 token 端点只接受 `client_secret_post`/`client_secret_basic`，因此公共桌面客户端无法完成纯 PKCE 流程。控制台已经保存每个客户的 OAuth secret，并已按公司签发设备绑定凭据。

## Proposal

**控制台充当 broker。** Host 在本地表单中向操作者索取控制台账户，调用 `POST /auth/login/`，再用稳定 device id 调用 `POST /onboarding/device-token`。控制台返回每个公司一条凭据：`{ key, token, mcp_url }`。Harness 把每条保存为名为 `mwt-<key>` 的 MCP 服务器行，头为 `Authorization: DeviceToken <token>`，代理工具因此是 `mcp__mwt-<key>__*`。

**不需要 IdP 客户端，也不需要 refresh token。** DeviceToken 就是长期凭据；控制台可撤销并重新签发。密码不进入模型或会话记录：表单属于 host 表面，后端执行两次调用。

**客户选择器就是账户可到达的凭据。** 控制台返回账户可用的每个公司；卡片列出它们，选中的 key 就是挂载的行。

## Acceptance criteria

1. 用客户账户登录后列出其公司，并为每个公司挂载一个 MCP 服务器。
2. 行内只在注册表中保存凭据引用；DeviceToken 存在凭据 seam 中。
3. 重启后保留行及其工具，无需再次登录。
4. 控制台撤销设备令牌后工具 fail closed；再次登录替换行。
5. 登录被拒或凭据列表为空时报告可恢复错误且不挂载任何内容。

## Risks

- 密码由 host 表单与本地后端处理；绝不写日志、存储或发送给模型。
- DeviceToken 授予账户的 MCP 范围；影响面由控制台授权决定，撤销是唯一权威。
- 控制台必须把 `/onboarding/device-token` 限制在已认证账户内；客户端信任该列表。
- 每个公司的 MCP URL 来自控制台；harness 不得按名称推导。

## Alternatives considered

**直接在 `idp.mwt.one` 做 OAuth。** 提供方没有 `registration_endpoint`，且 token 交换要求 client secret，公共桌面客户端无法完成；每个客户的 secret 将不得不落到每台设备上。

**在聊天中放密码表单。** 它把密码暴露给会话日志和模型，也无法支持 MFA。

## Verification

- `packages/faberloom/connections/tests/mwt-onboarding.spec.ts`：登录解析与拒绝、设备令牌请求结构、行过滤与服务器命名。
- `packages/faberloom/connections/tests/mwt-oauth.spec.ts`：为未来公共提供方保留的 PKCE 原语。
