# FaberLoom — F01–F42 测试清单

[English](faberloom-e2e-checklist.md) | 中文

作为计划 §17 的补充。每个用例都有其自动化验证（包的 spec）或在 VPS 上的手动走查（两个测试用户、已授权数据、无外部通信）。试点是浏览器。

执行优先级：**F08、F10、F16、F17、F18、F23、F28**（标记 ★）。

| ID | 验证 | 类型 |
|---|---|---|
| F01 | `spaces/tests/spaces.spec.ts`：无 MWT 的空间可创建并运行 | 自动 |
| F02 | `spaces/tests/spaces.spec.ts`：关闭继承不会带入被排除的上下文 | 自动 |
| F03 | `agents/tests/agents.spec.ts`：复制不会带走信任或私有记忆 | 自动 |
| F04 | `mcp-server/tests/mcp.spec.ts`：通过 MCP 的例程与相同身份/版本 | 自动 |
| F05 | `routines/tests/routines.spec.ts`：编辑不改变进行中的执行 | 自动 |
| F06 | `routines/tests/routines.spec.ts`：`MISSING_HANDLER` 声明缺失项 | 自动 |
| F07 | VPS 手动：同一 OC 经两个渠道 → 一个用例带两份证据 | 手动 |
| F08 ★ | VPS 手动：Eguisa 的形式发票对照 MWT 核验（数据、条款、文件） | 手动 |
| F09 | `board/tests/board.spec.ts`：价格变化时在生效前重新校验 | 自动 |
| F10 ★ | VPS 手动：登出/重启网关并恢复执行而不重复效果 | 手动 |
| F11 | `routines/tests/routines.spec.ts`：写入后超时会得到对账 | 自动 |
| F12 | `routines/tests/routines.spec.ts`：先前的回复会取消草稿 | 自动 |
| F13 | `learning/tests/memory.spec.ts`：更正会在后续用例中被召回 | 自动 |
| F14 | `learning/tests/memory.spec.ts`：多次迭代不算代理失败 | 自动 |
| F15 | `learning/tests/memory.spec.ts`：迟到的错误保留历史并生成版本 | 自动 |
| F16 ★ | `board/tests/board.spec.ts`：准备已授权，绝不发送 | 自动 |
| F17 ★ | `access/tests/access.spec.ts`：撤销会拒绝下一次生效 | 自动 |
| F18 ★ | `mcp-server/tests/mcp.spec.ts` + `access`：无法访问另一客户，拒绝有效 | 自动 |
| F19 | `agents/tests/agents.spec.ts`：回退记录实际模型与原因 | 自动 |
| F20 | `backup/tests/backup.spec.ts`：备份与恢复且保持完整性 | 自动 |
| F21 | VPS 手动：用 `update-harness.sh` 更新 harness 并回滚 | 手动 |
| F22 | `execution/tests/dispatcher.spec.ts`：第二个进程复用引擎 | 自动 |
| F23 ★ | `agents/tests/agents.spec.ts`：排他性在提供方失败时停止该步骤 | 自动 |
| F24 | `agents/tests/agents.spec.ts`：推荐解释证据与不确定性 | 自动 |
| F25 | `agents/tests/agents.spec.ts`：按有用结果计费，而非按 token 费率 | 自动 |
| F26 | `agents/tests/agents.spec.ts`：预算内已授权的升级 | 自动 |
| F27 | `agents/tests/agents.spec.ts`：缺数据不杜撰 | 自动 |
| F28 ★ | `agents/tests/agents.spec.ts`：共享预算耗尽并停止调用 | 自动 |
| F29 | `mcp-server/tests/mcp.spec.ts`：按 MCP 的策略与 UI 中的查询，同版本 | 自动 |
| F30 | `agents/tests/agents.spec.ts`：未知费率显示为不确定性 | 自动 |
| F31 | `agents/tests/agents.spec.ts`：使用更强模型的子代理与聚合成本 | 自动 |
| F32 | `backup/tests/backup.spec.ts`：恢复专家保留策略与指标 | 自动 |
| F33 | `agents/tests/agents.spec.ts`：池、零与任务进入同一目录 | 自动 |
| F34 | `defaults/tests/defaults.spec.ts`：专家保留流程，不带走他人上下文 | 自动 |
| F35 | `handlers/tests/agent-steps.spec.ts`：临时子代理不占用目录 | 自动 |
| F36 | `learning/tests/memory.spec.ts`：编辑/撤销使用当前版本并保留历史 | 自动 |
| F37 | VPS 手动：无空间/代理/例程启动，个人上下文隔离 | 手动 |
| F38 | VPS 手动：带附件迭代并重启后恢复草稿与引用 | 手动 |
| F39 | VPS 手动：从对话建议创建专家或例程并保留来源 | 手动 |
| F40 | VPS 手动：两个对话分离，历史不混杂 | 手动 |
| F41 | VPS 手动：把个人对话关联到共享空间前先核查受众 | 手动 |
| F42 | VPS 手动：委派给使用另一模型的代理时遵守策略与预算 | 手动 |

本地命令：

```sh
pnpm exec vitest run packages/faberloom
```
