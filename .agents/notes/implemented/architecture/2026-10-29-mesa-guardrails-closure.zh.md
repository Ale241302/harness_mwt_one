# Agent Note：按 WorkLoom 规范收口工作台护栏

Status: implemented

[English](2026-10-29-mesa-guardrails-closure.md) | 中文

## 问题

对照 `SPEC_FB_WORKLOOM_v1.6.1` 与 `PLAN_MESA_IMPLEMENTACION` 审计发现十六个缺口，而阶段状态曾把它们报为已关闭：

- API 仍返回 N3/N4 条目的 `summary` 与 `valueUsd`，只有面板在遮挡，数据仍然出行。
- `submit` 接受调用方声明的 `dataClass`，代理可以把自己的条目声明为 N0。
- 非 USD 金额从未换算：只有币种本来就是 USD 时才填 `valueUsd`。
- 分类缓存不存在，也没有挂载分类器端口，而 W-51/W-61 要求按上下文缓存。
- `dispatchEffect` 没有消费者；配置仍提供三种执行动作类型，CEO 签名列表为空。
- 迭代聊天无法写入草稿：没有 `iteration_context`/`iteration_propose` 工具，模型只能对话。
- 审批面板关闭后保留已选动作类型，`A` 可能在没有面板的情况下启动外部接受。
- 面板缺少按账户/到期筛选、按空间分组、跳过轮次与轮数提示。

## 决定

架构决定记录在 `DECISIONES_MESA_ARQUITECTO.md`（A-01…A-15）。关键的几条：

- 数据类别在服务端按产物类型与账户推导；调用方只描述产物，不声明敏感度。
- N3/N4 由 API 投影遮挡，打开时追加一条 `access` 审计事件且不移动 `rowVersion`。
- 换算必须声明汇率、来源与日期；缺项则拒绝条目，不编造汇率。
- 分类器是可挂载端口（`faberloomBoardClassifier`），缓存键包含 §5.1 的全部输入；未挂载时条目保持未分类但仍进入。
- Outbox 消费者由 fiber 持有的定时器运行，逐消息退避，缺少适配器时只抛一条 `DISPATCH_REFUSED` 告警；试点不启用任何执行动作类型。
- 迭代代理通过 `iteration_context` 与 `iteration_propose` 写入，绑定尝试 id、代数与持有会话。

## 验证

- `packages/faberloom/board/tests` 186、`view` 193、`mcp-server`/`tool-faberloom`/`backup` 158、`ui-faberloom` 168，加上 learning/autonomy/access：817 项测试通过。
- 新增专项套件：`board-guardrails.spec.ts`（服务端类别、汇率、缓存、超时、访问审计）、`board-effects.spec.ts` 的 outbox 消费用例、`board-iteration.spec.ts` 的受限投影用例。
- `tsc -p tsconfig.host.json`、`tsc -p tsconfig.client.json` 与 `verify-cordis-config`（230 个文件）通过。

## 以决定推迟的事项

- W-14/W-15（批量批准）按 D-11 留在试点之外。
- W-63（Jev 影子）按 D-14 关闭。
- W-25 以“不存在签名 URL”成立：文档通过服务以操作者身份读取。
- 启用任何 N3/N4 天花板前，W-94 需要治理用的重分类命令（A-14）。
- 具名筛选视图与按代理筛选等待产品决定，并等待条目携带代理（D-1）。
