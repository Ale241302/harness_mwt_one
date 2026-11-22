# Agent Note: 草稿代理在已部署基础上运行，不引入上游迁移

Status: implemented

[English](2026-11-22-draft-agent-on-the-deployed-base.md) | 中文

## Problem

编辑 FaberLoom 邮件草稿曾是一次性动作：面板请求模型给出新文本、替换正文，并且不保留改动记录。需要迭代草稿的代理要求对话在关闭编辑器后仍然存在、可用于比较并交换的精确修订、可恢复的历史，以及无法触及其他草稿或邮箱操作的受控工具。后续的进行中分支在上游未评审迁移之上实现了全部能力，而该迁移提升了 `SESSION_FORMAT_VERSION` 并改变了 harness API；该迁移不属于已部署基础。

## Decision

**只把草稿能力移植到提交 `3c730ec969`。** `packages/faberloom/connections` 负责按 owner 隔离、编号的草稿修订与比较并交换更新；`packages/faberloom/view` 负责草稿 RPC、有界种子、受限 Session 与 Space 建议；`packages/faberloom/tool-faberloom` 注册四个模型工具；`packages/client/ui-faberloom` 打开 Host 拥有的 Session，并提供修订恢复与明确确认的 Space 关联。基础 Session 格式保持版本 3，域存储形式升级到 v2 并声明 `compatibleVersions: [1]`。

**在接缝处适配，而不是改变基础。** Client 在导航前刷新 Session 列表并重命名绑定，因为基础没有一次性 Session 引用。基础工具执行器保留单次调用的 `execute`，组合测试也以这种方式调用。`connections.sendDraft` 保留可选的修订参数，而 Remote `sendEmailDraft` 在 Host 接受发送前要求它。已关联草稿的 Session 拒绝通用的 `seedMailSession` 路径。

## Alternatives considered

**连同上游迁移一起引入。** 已拒绝：它会改变 Session 日志格式、消息来源、工具执行、子代理激活与 LLM 请求字段，影响每个包，而已部署基础必须继续运行当前生产组合。

**让 `saveDraft` 继续替换已有草稿。** 已拒绝：只有在盲替换路径消失后，比较并交换才能保护写入。现有测试与调用方现在使用带审阅修订的 `updateDraft`。

**把移植后的界面留在浮动对话中。** 已拒绝：基础已经把真实 Session 打开在中央 Conversation，草稿 Session 必须是所有者在重新加载后重新打开的那个。

## Consequences

草稿现在拥有一个持久 agent Session、仅追加的修订历史与 Host 拥有的首次种子。任何草稿代理路径都不发送邮件、不激活课程，且草稿 Session 只获得四个草稿工具的广告。WIP 中草稿快照录制不可移植：它是版本 4 Session，而基础读写版本 3，因此移植后的代码树没有 `snapshots/session/faberloom-draft` 用例。

## Testing

`pnpm run typecheck` 通过。针对 `packages/faberloom/view`、`packages/faberloom/connections`、`packages/faberloom/tool-faberloom` 与 `packages/client/ui-faberloom` 的定向 Vitest 运行在 75 个文件中通过 795 个测试，包含新的草稿 RPC、组合、工具、修订、权限与客户端套件。
