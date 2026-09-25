# 端点与拓扑 · mwt-one-harness

[English](endpoints.md) | 中文

在 VPS 上于 2026 年 9 月 14 日核实。

## 身份原则（已决定）

登录 harness 的用户从控制台获得**自己的角色与权限**，并以此与 MWT.ONE 的 MCP 交互。**任何控制台用户默认都可以连接**，权限范围以其角色允许为限；MCP 按角色过滤工具（RBAC）。`client_b2b` 角色看到的是与 `admin` 不同的子集。

网关**不保存用户的 JWT**：它通过请求头传播身份，由 MCP 解析角色/权限。不使用共享的管理凭据来替代身份。

## 拓扑

```
Navegador
  └─ https://harness.mwt.one  (Cloudflare → mwt-nginx:443)
        └─ mwt-one-harness-gateway:8080
              ├─ POST /login → consola /api/auth/login/  (identidad + rol)
              ├─ un proceso dsh por usuario (DSH_HOME propio)
              └─ MCP con la identidad del usuario

Clientes externos (Claude/Cowork)
  └─ https://mcp.mwt.one → Authentik/ContextForge → consola-mwt-one-mcp:8765
```

## 端点

| 服务 | URL | 传输 |
|---|---|---|
| Harness（UI） | `https://harness.mwt.one` | HTTPS |
| 网关健康检查 | `https://harness.mwt.one/healthz` | JSON |
| 控制台登录 | `https://consola.mwt.one/api/auth/login/` | JSON |
| 内部 MCP（harness 使用） | `http://consola-mwt-one-mcp:8765/mcp` | Streamable HTTP |
| 规范外部 MCP（产品） | `https://mcp.mwt.one` | OAuth（Authentik） |
| IdP | `https://idp.mwt.one` | Authentik |
| 控制台 | `https://consola.mwt.one` | HTTPS |

## 各路径的请求头

| 路径 | 请求头 |
|---|---|
| Harness → 内部 MCP | `X-Forwarded-User-Email`、`X-MWT-Gateway-Key`、`Authorization: Bearer dsh-gateway`（仅用于绕过 OAuth 挑战；不是 JWT），可选 `X-MWT-Client-ID` |
| 外部客户端 → `mcp.mwt.one` | Authentik 的 OAuth；按租户的 `X-MWT-Client-ID`（第 6 波） |

## 规范路径的决定

- **harness 的身份：** 内部路径 `consola-mwt-one-mcp:8765`，通过请求头携带身份（email → 由 MCP 解析角色）。当前可用。
- **产品规范路径** 供外部客户端使用：`https://mcp.mwt.one`（Authentik + ContextForge），它已传播租户（`X-MWT-Client-ID`）。
- **计划中的收敛（E2）：** 让网关按用户获取/续订 OAuth token，从而也在 harness 中使用 `mcp.mwt.one`，而不改变身份原则。在此之前，不使用注册记录的情况下不混用两条路径。

## 登录流程与公司/角色/权限的获取

于 2026 年 9 月 14 日核实：

1. 用户进入 `https://harness.mwt.one/login`。
2. 网关发起 `POST https://consola.mwt.one/api/auth/login/`，收到
   `user{ id, email, full_name, role, role_name, permissions, is_active, is_staff,
   legal_entity_ids }` + `access`/`refresh`。
3. 网关为每个用户启动一个 `dsh`，并把**身份**（email）注入 MCP。
4. 每次请求时，MCP 依据该身份解析公司、角色与权限并过滤工具。证据：`mwt_whoami` 返回 `role`、`role_name`、`permissions` 与 `legal_entity_ids`。

`mcp-gateway` 栈（Authentik + ContextForge）是 **consola-mwt-one 项目的一部分**（位于 `/opt/consola-mwt-one/mcp-gateway`），为 Claude/Cowork 等客户端提供外部路由 `https://mcp.mwt.one`（OAuth）；底层使用同一个 MCP 服务器（`consola-mwt-one-mcp:8765`）。

**租户（E2）：** 当用户**只有一家公司**（`legal_entity_ids`）时，网关用该公司的值设置 `X-MWT-Client-ID`。有多家公司时不发送该头（没有唯一正确的值，MCP 会拒绝）。MCP 校验该值属于用户的公司之一（`verify_tenant`），否则以 `TENANT_MISMATCH` 拒绝。证据：`compras2`（Sondel）使用租户 SONEPAR → 被拒绝；使用 Sondel → 允许。

## 主机上发布的端口（consola 栈）

| 容器 | 主机 → 容器 |
|---|---|
| `consola-mwt-one-django` | 8100 → 8000 |
| `consola-mwt-one-frontend` | 3101 → 80 |
| `consola-mwt-one-postgres` | 5434 → 5432 |
| `consola-mwt-one-redis` | 6380 → 6379 |

注：harness 网关从 `3100` 起分配 `dsh` 端口，且是在**其容器内部**（不发布到主机）。与 frontend 的 `3101` 没有实际冲突，但最好移动 `dsh` 的基础端口范围以避免混淆。

## 身份数据

| 数据 | 已核实的来源 |
|---|---|
| 用户 | `core.users`（6 条记录） |
| 角色（8） | `core.roles`：`superadmin`、`admin`、`manager`、`compras`、`finance`、`operator`、`client_b2b`、`viewer` |
| 有效角色 | `core.users.role`；`core.user_roles` 只有 1 行，不要用作来源 |
| 角色、名称与权限 | 登录响应：`user.role`、`user.role_name`、`user.permissions`（`modules`、`actions`、`read_only`） |
| 用户租户 | 登录的 `user.legal_entity_ids`（**不是** `core.users.tenant_uuid`，它为 NULL） |

## 测试证据（2026 年 9 月 14 日）

### 登录（`https://consola.mwt.one/api/auth/login/`）

| 账号 | 角色 | 权限 | `legal_entity_ids` |
|---|---|---|---|
| `alejandro@muitowork.com` | `admin` | modules, actions | 3 |
| `alvaro@muitowork.com` | `admin` | modules, actions | 3 |
| `compras2@sondelsa.com` | `client_b2b` | modules, actions, `read_only` | 1（`c588c410-…`） |
| `logistica2@sondelsa.com` | `client_b2b` | modules, actions, `read_only` | 1（`c588c410-…`） |

四个账号都能成功登录。此处不保存密码。

### MCP 的 RBAC（通过请求头携带身份，带会话握手）

| 身份 | 可见工具 |
|---|---|
| `alejandro@muitowork.com`（admin） | **175** |
| `compras2@sondelsa.com`（client_b2b） | **44** |

按角色过滤端到端生效：同一入口，按登录身份给出不同集合。`client_b2b` 不获得管理类工具。

## 备注

- 租户（`X-MWT-Client-ID`）**仅在用户只有一家公司**时设置（E2）。有多家时（例如某位 admin）在其范围内保持全局模式。
- `core.users.tenant_uuid` 存在但为 NULL：公司的真实来源是登录响应中的 `user.legal_entity_ids`。
- **MCP 缓存（已修复，2026 年 9 月 15 日）：** MCP 的 token 缓存原先按 email，可能绕过 `verify_tenant`；现在键包含 `client_id`。使用缓存的全局 token 时，外部租户会被拒绝。
- 在任何业务写入之前，先验证无权限的用户会得到有效拒绝（而不仅是视觉上的隐藏）。
