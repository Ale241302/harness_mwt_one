# Agent Note: sharing agents through the MWT.ONE console

Status: implemented

[English](2026-09-27-sharing-agents-through-the-console.md) | 中文

## 问题

每个用户运行自己的 harness 进程、拥有自己的 `DSH_HOME`，因此用户构建的 agent 只存在于该用户的存储中。用户无法把自己构建的 agent 交给同事，Agents 面板也没有任何共享能力。账户身份、用户所属公司与每个客户的 MCP 都在 MWT.ONE 控制台中，而 harness 已经以登录用户身份访问它（gateway 向每个用户进程注入 `CONSOLA_API_BASE` 与 `CONSOLA_TOKEN`，这正是 `faberloom_mail_attachment_link` 已有的模式）。

## 决策

以控制台作为共享存储；harness 读取并物化为只读副本。

- 控制台新增表 `core.harness_share`（由 `backend/sql/M0_harness_share.sql` 应用一次）以及自作用域的视图集 `GET/POST/DELETE /api/harness/shares/`（`apps/core/harness_share_views.py`，`rbac_bypass = True`）。用户按名称发布一个 agent，并给出 `shared_emails` 或 `share_all`；列表返回其发布的内容（`outgoing`）以及他人与之共享的内容（`incoming`，按指定邮箱或其公司匹配）。
- `FaberLoomViewService` 新增 `shares`、`shareAgent`、`unshareShare` 与 `syncShared`。`shareAgent` 发送 agent 的 responsibility、skills、tools、provider 和 model，且**永不发送其提供方 API key**——该 key 属于所有者账户，不可携带。
- 首次 `overview()` 以及 `syncShared` 时，视图拉取传入的共享，并将每个 agent 物化为本地副本：`seeded: true`、`ownerId` 设为发布者邮箱、`originRef` 为 `share:<发布者>`。既有的所有权规则随即使该副本对除发布者或 Admin/CEO 之外的所有人只读。共享已消失的副本会在下次拉取时被清理。
- Agents 面板为发起者可管理的 agent 显示一个共享字段（指定邮箱加“整个公司”）。
- Skill 以同样方式共享：`shareSkill` 发布所有者自己的 `SKILL.md`，收到的 skill 被写入所有者的 skills 目录并带有 `.shared-by` 标记。`saveSkill` 与 `removeSkill` 拒绝被标记的 skill（除非 Admin/CEO），面板将其显示为“与你共享”并标注发布者、隐藏删除按钮。共享消失的 skill 会在下次拉取时清理，与 agent 副本相同。
- 面板列出所有者已共享的内容并提供“取消共享”，并在收到的 agent 上显示“共享者 <发布者>”。

## 预置实际包含什么

`agents-shared/` 下的 35 个共享预置只包含 `preset.yml`（name、description、order）和生成的 `agent.cordis.yml`。该组合是随发布的 `standard` 预置加上通用 persona 前缀；它不包含 ECC 的 agent 正文、具体 skill 名称或 subagent 连接。这些位于外部 `affaan-m/ECC` 目录，仓库并未 vendor，也不存在生成器。因此为预置分配 skill 或连接 agent 属于人工整理，而非从 `agent.cordis.yml` 提取。

## 考虑过的替代方案

**跨进程的共享文件系统卷。** 它没有按公司划分的作用域、没有账户身份，也无法表达共享对象是谁；而控制台已经拥有这三者。

**用 host 的 MCP 解析器处理。** 控制台响应字段并非契约，因此 harness 直接以用户自己的 token 调用控制台 HTTP API，而不经由工具路由。

## 后果

- 接收者不能编辑或删除共享的 agent：它是种子且归发布者所有，因此只有发布者或 Admin/CEO 可以更改它，与部署基线完全一致。
- agent 与 skill 均可共享；收到的 skill 是所有者 skills 目录下的只读副本，并带有 `.shared-by` 标记。
- 副本不携带 API key，因此共享的 agent 使用接收者自己配置的提供方 key 运行。

## 测试

控制台套件 `backend/tests/test_harness_share.py` 覆盖按邮箱发布、共享给全公司相对陌生人、仅所有者可删除、重复发布的 upsert 以及输入校验（容器中 4 项通过）。harness 套件 `packages/faberloom/view/tests/workspace-board.spec.ts` 覆盖共享负载绝不携带 key，以及将传入共享物化为归发布者所有的种子副本。
