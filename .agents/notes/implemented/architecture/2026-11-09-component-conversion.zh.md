# Agent Note: Host conversion reports every field and refuses silent equivalence

Status: implemented

[English](2026-11-09-component-conversion.md) | 中文

## Problem

Claude 适配器把所有非 skill 产物文件都当作资源。workflow、routine、memory 或不支持的 tool 因此可能作为普通内容进入插件，而 agent 的 `tools` 字段会无声消失。清单带有分类，但没有记录文件来自子空间还是固定父修订。D13 仍开放，因此任何适配器都不能声称已替换旧生成器。

## Decision

**转换是逐字段报告，不是复制循环。** `packages/faberloom/portable/src/adapters/conversion.ts` 把每个可移植文件映射为 `preserved`、`translated`、`omitted` 或 `rejected`，并给出稳定原因。`document`、`context`、`resource` 与 skill 资源被保留；有效 skill 保留为 `skills/<name>/SKILL.md`；agent 翻译为 `agents/<name>.md`，其 frontmatter 与 `tools` 字段保留，只把 name 规范化为 host slug。省略 `tools` 会让 host 继承所有工具，因此写入器绝不丢弃它。workflow 以 `workflow-not-representable` 拒绝；tool、session、transcript 或完整备份各有拒绝原因；`routine`、`memory`、`metadata` 作为 `not-a-host-component` 省略。无效 skill 或 agent 被拒绝，而不是修复。转换器还会对照清单重校验内容哈希与 kind，因此伪造的计划不能把 session、transcript 或不同字节偷带过适配器。

**拒绝保留源。** 被拒绝组件仍留在签名可移植产物中，不进入 host 包。报告统计接受、省略与拒绝数量，并列出所有限制。适配器打包可接受的其余部分；不会为 workflow 编造等价 Markdown，也不会为 tool 编造资源。

**清单携带来源与策略。** 每个清单文件在分类、媒体类型、字节长度、SHA-256 与元数据摘要之外记录 `origin`（`child` 或 `inherited`）。改变来源会改变内容版本与清单摘要，因此字节相同但来源不同的导出可区分。

**D13 保持开放。** 转换报告记录 `legacyGenerator: retained` 与 `legacyReason: D13-open`。旧生成器保留消费者，直到其源码与迁移被证明；本批次不声称完全替换。删除已安装的 Claude 包只删除该目录；不会发布、撤销或改写源产物或产品记录。

## Alternatives considered

**把所有非 skill 文件复制到 `resources/`。** 这正是缺陷：workflow 或 tool 会看起来像普通资源，agent 会无报告地丢失工具限制。

**一个组件不兼容就拒绝整个包。** 这会丢弃可用组件。源产物仍保留被拒组件，报告告诉人类漏了哪个。

**把 workflow 改写成 Markdown。** 格式不等价。workflow 被拒绝，源保留，报告说明原因。

**提升格式版本以加入 origin。** 该字段是增量的，清单的规范摘要已覆盖它；保持 `formatVersion` 为 1，避免强迫所有消费者解析新布局。

## Consequences

host 包可能是部分的。转换报告是省略/拒绝的权威，`faberloom/conversion.json` 随就绪包一起携带。它还记录 planner 扣留的贡献数量与原因，不暴露路径。agent 的 tools 绝不被静默扩大或丢弃；重复或保留的 skill 名作为单独组件被拒绝，而不是中止整个包。skill 资源跟随规范化后的 skill 目录；其 skill 被拒绝的资源以 `skill-resource-orphan` 拒绝。清单区分继承与子级内容，因此身份变化会移动摘要。D13 作为已记录限制保留，而不是隐含的替换声明。

## Verification

- `packages/faberloom/portable/tests/conversion.spec.ts`：支持的保留；agent tools 保留；workflow 拒绝；routine 省略；skill 资源保留；无效 skill、tool、backup、session 与 transcript 拒绝；扣留计数；清单来源与仅来源变化导致的摘要变化；可复现性。
- `packages/faberloom/portable/tests/distribution.spec.ts`：Claude 包携带带 `tools` 的 agent，拒绝 workflow，写入 `faberloom/conversion.json`，并验证 agent 组件。
- `packages/faberloom/portable/tests/projection.spec.ts`：PKG-03/PKG-04 的规范清单、摘要与身份变化。
- `packages/faberloom/portable/tests/context-authorization.spec.ts`：CTR-PORTABLE-01 的 session/transcript 仍被拒绝。
