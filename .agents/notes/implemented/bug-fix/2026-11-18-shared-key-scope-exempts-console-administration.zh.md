# Agent Note: The shared-key scope exempts the console administration and Marluvas

Status: implemented

[English](2026-11-18-shared-key-scope-exempts-console-administration.md) | 中文

## Problem

控制台的一位 Admin (CEO) 请网页端应用审阅她附加的一份产品设计流程。会话给出了共享密钥的拒绝文本——"La llave compartida solo ejecuta herramientas de MWT.ONE, SICOP y correo. Configurá tu propia llave para otras tareas."——同一记录还显示了这个家族：一次返回 `unknown tool "read"` 的 `read` 调用，以及一次被守卫以同一段文本拒绝的委派调用。该账号是 `mqbonanza118@gmail.com`，控制台角色为 `admin`。

两条已交付的决定共同造成了这一结果。[操作者范围修复](2026-11-13-mwt-guard-operator-scope.zh.md)让 `gateway/faberloom-role.mjs` 把 `muitowork.com` 之外的每个 `admin`、`superadmin` 或 `ceo` 降级为 `client_b2b`，从而让某租户的管理员无法读取另一家公司的队列。会话代理根据它收到的角色计算共享密钥限制（`packages/faberloom/session-agent/src/index.ts` 中的 `restricted`），而 `client_b2b` 正是受限角色。因此同一个角色字段承担了两项互不相关的限制：账号读哪个队列，以及部署的密钥会回答什么。

桌面端从未应用这次降级——`apps/desktop/src/identity.ts` 原样写入控制台角色——所以同一账号在桌面端不受限制。同一个身份在产品两个界面上表现不同。

## Decision

**共享密钥的范围与数据角色是两个独立决定。** `gateway/faberloom-role.mjs` 导出 `faberloomKeyUnrestricted(user)`：控制台的管理角色（`admin`、`superadmin`、`ceo`）以及 `marluvas` 为真；其他任何角色、缺失角色或缺失身份都保留产品范围。`gateway/server.mjs` 据此在 `faberloom-session-agent` 行渲染 `productOnly`，因此网页补丁对这些角色写出 `productOnly: false`。

**数据角色仍然降级。** `faberloomRole` 未变：使用外部邮箱的 Admin/CEO 到达产品时仍是 `client_b2b`，保留该角色的视图与技能目录，且无法读取另一家公司的队列。该豁免只解除守卫、产品工具掩码和使用策略段落——仅此而已。

## Alternatives considered

**让该账号配置自己的提供商密钥。** 作为这份报告的答案被否决：她是员工，部署为她工作的消耗付费，要求她配置密钥会把产品缺陷变成她的配置任务。对于仍然受限的账号，拒绝文本给出的仍是这条路。

**对 `admin` 和 `ceo` 撤销降级。** 被否决：这会重新打开操作者范围修复所关闭的队列泄漏，因为驱动全安装看板读取的正是这些角色名（`packages/faberloom/view/src/index.ts`）。

**只豁免操作者域，并把该账号的邮箱加入允许列表。** 目前被否决：部署要求的是这两个角色，邮箱列表会一次一份报告地增长，而且下一个使用外部地址的 Admin 仍会被拒绝。如果某个外部租户的管理员某天获得了并非有意给它的密钥豁免，这就是收紧的做法。

## Consequences

Admin (CEO) 或 Marluvas 账号现在在网页端和桌面端都能用共享密钥回答设计、代码和个人请求，这些消耗由部署支付。`client_b2b`、`manager`、`viewer` 或 `agente_mcp` 账号仍保留产品范围、掩码与分类器。

两个缺口仍然存在。桌面端仍原样传递控制台角色，因此外部 Admin/CEO 在桌面端仍以全安装角色到达，本次改动并未关闭该问题——它只是不再让网页端过度限制一个桌面端本已当作员工对待的账号的密钥。而真正受限的会话仍无法读取自己的附件：在被报告的记录里，`read` 调用返回 `unknown tool "read"`，而本可读取该文件的委派被掩码拒绝。

## Testing

`gateway/tests/faberloom-role.spec.mjs` 把两个决定分开固定：对角色为 `admin` 的 `mqbonanza118@gmail.com`，`faberloomRole` 为 `client_b2b`，而 `faberloomKeyUnrestricted` 为 true；`marluvas` 与 `ceo` 不论域都获豁免；`client_b2b`、`manager` 与缺失身份保留范围；操作者域的 admin 一如既往保留控制台角色。补丁那一行没有启动级测试：`gateway/server.mjs` 在导入时就启动服务器，因此渲染出的 `productOnly` 值只由上面的单元测试覆盖。
