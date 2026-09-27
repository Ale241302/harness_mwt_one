# Agent Note: seeded agents are admin-only; user agents belong to their owner

Status: implemented

[English](2026-09-27-agent-ownership-and-permissions.md) | 中文

## 问题

Agent 目录没有所有者，视图里的 agent 写入甚至不检查 `readOnly`，因此任何用户都能通过面板编辑或删除每个目录 agent。每个用户运行自己的 dsh 进程、拥有自己的 `DSH_HOME` 和目录副本，所谓“对所有人共享”就是被供给的种子集合，而没有任何字段能把种子 agent 与用户自建的 agent 区分开。提供方 API key 字段始终提供显示开关，因此任何人打开面板都能看到已存的 key。

## 决策

所有权记录在 agent 上，并在接受写入之处强制执行。

- `AgentRecord` 新增 `ownerId`（种子/全局 agent 为 `''`）与 `seeded`，两者都有默认值，因此旧记录仍能加载。
- `FaberLoomViewService` 把 `admin`、`superadmin`、`ceo` 视为特权角色；特权者可管理任意 agent，其它角色只能管理自己拥有的、非种子 agent。每次 agent 写入还要求 `!readOnly`，而此前 agent 写入缺少这一检查。
- `createAgent` 与 `createAgentFromWork` 把发起身份写入 `ownerId`。
- `faberloom-defaults` 以 `seeded: true` 供给 agent，并在部署配置时写入 `provider`、`model` 以及从 `agentApiKeyEnv` 命名的环境变量读取的 API key（gateway 默认指向 `DEEPSEEK_API_KEY`）。key 绝不进入仓库；它按 agent 存储，读取只报告 `hasApiKey`。每次启动时，供给器随后收敛部署的基线 agent——原生种子与共享预设——仅在字段仍未设置时填入 `provider`、`model` 与该 key，因此更早部署供给的 agent 会被配置，而 admin 已固定的值不会被覆盖。
- overview 的 agent 行携带 `editable`；对于发起者不能管理的 agent，Agents 面板隐藏 Delete/Deactivate，并禁用 Save 与 API-key 字段。`SecretInput` 新增 `revealable`，因此发起者无权查看的 key 不显示显示开关。
- Skills 保持其文件模型：role 与 shared 目录是部署文件，API 从不写入，只有所有者自己的 `DSH_HOME/skills` 目录可创建/删除。因此普通用户可以创建并管理自己的 skill，而随部署发布的目录仍属 Admin/部署事项。

## 考虑过的替代方案

**用共享注册表让某个用户的 agent 通过邮箱或 MCP 到达另一个用户。** 目前没有跨用户共享的媒介：每个用户的 agents 与 skills 都在其自己的进程与 `DSH_HOME` 中，因此共享给另一个邮箱或公司内其他用户没有可写入之处。这里的所有权字段是本地那半边；共享列表及其传输要等共享存储（console/MCP）出现。

**只在面板里拦截。** 面板只是展示；Remote 仍然返回并接受写入，所以检查必须位于视图。

## 后果

- 普通用户不再能编辑或删除种子 agent；只有 Admin/CEO 可以。所有者是其它身份的 agent 同样被拒绝。
- 发起者不能管理的 agent，其已存提供方 key 永不显示。
- 供给会给它创建的 agent 写入配置好的 provider/model/key，收敛过程也会把尚未设置的字段补进任何基线 agent，而 admin 已固定的值保持不变。

## 测试

`packages/faberloom/view/tests/workspace-board.spec.ts` 覆盖特权保存、对种子 agent 的非 admin 拒绝、所有者的保存，以及 overview 的 `editable` 标记。`packages/faberloom/agents/tests` 在新字段之上保持目录测试通过。
