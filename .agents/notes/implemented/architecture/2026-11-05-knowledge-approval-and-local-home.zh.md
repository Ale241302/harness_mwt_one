# Agent Note：知识批准携带绑定修订的证据，本地 home 无需控制台账号即可启动

Status: implemented

[English](2026-11-05-knowledge-approval-and-local-home.md) | 中文

## 问题

`APROBADO` 行此前只是一个状态。`approve()` 校验调用者的行、修订与哈希，然后写入状态和审计事件；没有任何东西能区分该转换与 mirror 复制的行、备份恢复的行或手工编辑的行。mirror 在 web home 与 Desktop 之间传输 `faberloom_board.items` 表，因此对端的批准会以本 home 的批准到达，即使这里没有人看过那些字节。导入以及任何未来不调用 `approve()` 而直接 upsert 行的写入方都存在同一缺口（PROP-09）。

Desktop 还拒绝在没有控制台账号时启动。`readIdentity()` 找不到身份时，`reconcileBackend` 在 `backend.start()` 之前返回，因此新安装无法在未登录远程服务的情况下创建 Workspace、Space 或子空间，而本地 harness 并不需要该服务（BASE-01、D08）。

## 决策

**每次批准都携带绑定到所批准修订的证据。** `approve()` 与 `approveWithEdits()` 写入 `approvalEvidence`：`source: 'human-session'`、已认证 actor、提交时刻，以及调用者指定的版本与哈希。`verifiedItemsTable` 包装条目表，使每次读取、更新与写入都观察证据：`APROBADO` 行的证据缺失、来源不符，或不再匹配当前版本/哈希时，读取为 `PENDIENTE_CRITERIO`，并带有 `stale: true` 与 `staleReason: APPROVAL_UNVERIFIED`。面板翻译该原因而不是打印代码，现有的重新校验动作清除 stale 后再进行新的批准。字段出现之前批准的行没有证据，升级后需要重新校验一次；这一次性成本换来的是不再把它们与复制行混为一谈。

**mirror 只传输看板工作，不传输裁决。** `stripReplicatedDecision` 在 home 读取待传输行与应用收到行时，都把 `APROBADO`、`EJECUTADO`、`DESCARTADO` 与 `SUSTITUIDO` 改写为 `PENDIENTE_CRITERIO` 和 `staleReason: REPLICATED_DECISION`。标题、严重性、产物、疑问与分配仍然传输；每个 home 对自己的字节作出决定。

**本地安装拥有自己的身份与模式。** `resolveHomeSelection` 从所启动的后端解析模式，拒绝与后端矛盾的 `DSH_DESKTOP_MODE`，把实际运行的模式记录到 `desktop-mode.json` 作为证据，并以 `DSH_DESKTOP_HOME_SYNCED` 拒绝位于 OneDrive、Dropbox、Google Drive 或网络共享内的 home。`ensureLocalIdentity` 用随机 owner id 写入 `local-identity.json`；它绝不触碰会应用远程 patch 并启用 mirror 的 `desktop-identity.json`。`writeLocalIdentityPatch` 以该 id 作为产品 owner 渲染 `desktop-local.patch.yml`，不包含控制台共享行，也不改 `.env`。`reconcileBackend` 用该本地 patch 启动 Host，并跳过控制台令牌续期、MCP provision 与登录身份 patch。

## 考虑过的替代方案

**信任事件日志。** 复制行携带对端的 `approve` 事件，因此日志无法区分本地决定与复制决定。只有本 home 服务写入并校验的证据可以。

**要求请求携带 `human: true`。** 标志只是调用者的声明；模型可以发送它。证据绑定修订，并由提交该决定的操作写入。

**保留旧批准原样。** `state: APROBADO` 且无证据的行与镜像行无法区分，保留它就保留了缺口。计划的 PROP-09 要求每次批准都有一次准确的人工动作，而不是 grandfathering。

**把所选模式存成选择器。** 后端仍由环境决定；文件只记录实际运行的内容。能切换后端的存储值会复活 Desktop 已移除的选择器。

**从机器名或控制台邮箱派生本地 owner id。** 机器名在克隆之间不稳定，邮箱是远程身份。随机 id 属于该 home，并在重启后保留。

## 后果

复制、恢复或手工编辑的批准不再授权知识；它读取为待处理，并需要一次本地决定。既有已批准行在升级后需要一次这样的决定。在 `on` 模式下远程会话仍是权威，本地备份不携带证据，因此 mirror 仍把其行当作工作而非裁决。

全新的 Desktop 安装启动本地 Host，无需控制台账号即可创建 Workspace 与 Space，并在重启后保留身份。位于同步文件夹内的 home 在启动时以稳定代码失败，而不是把写入丢给同步客户端。

## 验证

- `packages/faberloom/board/tests/knowledge-approval.spec.ts`：证据匹配时读取为已批准；版本、哈希、来源、actor 或时刻不同则拒绝；`APROBADO` 且无证据的原始行读取为待处理，可重新校验并批准；同一行带证据时保持已批准（HAR-05）。
- `packages/faberloom/mirror/tests/document.spec.ts`：已裁决的看板行离开 home 时变为待处理，仍携带该裁决的文档在应用时再次被降级。
- `apps/desktop/tests/home-selection.spec.ts`：首次启动记录 `local`，重启复用，显式矛盾失败，同步与网络 home 被拒绝，本地身份稳定、与远程身份分离，并在不可读时被替换；本地 patch 引用该 id 且不含控制台共享行。
- `scripts/faberloom-portable/check-plan.spec.ts`：登记拒绝缺失用例、未知批次、目录外负责人、过期计划摘要，以及没有现存测试的 `demostrada` 用例。
