# Agent Note: MWT.ONE 租户路由器查询用户的每一家公司

Status: implemented

[English](2026-09-22-mwt-tenant-router.md) | 中文

## 问题

拥有多个 `legal_entity_ids` 的用户每个会话只有一个租户：gateway 只注入一个 `X-MWT-Client-ID`（在 `/entity` 选择的实体，或唯一的公司），因此存放在用户另一家公司里的 expediente 对聊天不可见，除非用户退出并切换实体。计划的目标恰恰相反：助手应当查询用户的所有公司，并找出数据在哪一家。

## 决策

租户列表随 patch 传到每个 dsh，路由逻辑落在三个基于现有 JSON-RPC 客户端的模型工具上——不做按公司的 MCP 客户端实例（每个实例都会让每次请求的工具面乘以约 175 个），也不做 gateway 侧查询代理。

- `gateway/server.mjs` 的 `renderPatch` 把 `companyIds`（全部 `legalEntityIds`）写入 `tool-faberloom` 和 `faberloom-view` 的配置，与会话已有的活动 `companyId` 并列。
- `tool-faberloom` 新增 `faberloom_companies`（列出用户的租户并标记活动者）、`faberloom_mwt_call`（对指定租户调用一个 MWT 工具）、`faberloom_mwt_find`（把同一条读查询扇出到所有租户，报告哪些返回了数据）。`tenant()` 辅助函数大小写不敏感地解析指定公司，不属于用户列表则抛出：路由器无法寻址用户不拥有的租户，且控制台对每次调用仍强制执行角色与权限。
- `faberloomView.mwtStatus` 返回 `companyIds`，Conexiones 的 MWT.ONE 区块把每家公司渲染为 chip 并标记活动者，让多公司现实可见，而不是藏在"无单一公司"后面。

模型侧指引保持默认路径优先：先通过原生 `mcp__mwt__*` 工具查询活动公司，当数据可能在别处时再使用 `faberloom_mwt_find`。

## 已考虑的替代方案

- **每家公司一个 MCP 客户端实例。** 否决：每个实例都会再注册一遍完整工具目录（`mcp__mwt-ent1__*`、`mcp__mwt-ent2__*`），让每次请求的工具块成倍增长并干扰工具选择；路由器不论租户多少只增加三个工具。
- **按查询用不同租户重启 dsh。** 否决：这正是 `/entity` 已提供的会话级切换；按查询路由不应打断对话。
- **为路由调用做 FaberLoom 侧读写允许名单。** 有意推迟：租户归属才是 FaberLoom 拥有的边界，读与写仍由控制台的 RBAC 裁决——它本就以用户身份校验每次调用。

## 后果

- 多公司用户问一句"找 expediente X"，助手一次扇出就能回答数据在哪家公司，无需重新登录，也无需切换实体。
- 租户检查大小写不敏感，列表就是控制台自己的 `legal_entity_ids`，因此被撤销的公司在下一次登录/渲染 patch 时自动从路由器消失。
- `mwtStatus` 和面板显示的是 id 而非显示名；控制台尚未提供名称映射（已记录在包 README）。
- 路由调用不要求超出原生 `mcp__mwt__*` 工具已有的 FaberLoom 授权；例程内的副作用步骤保持其独立的授权路径不变。
