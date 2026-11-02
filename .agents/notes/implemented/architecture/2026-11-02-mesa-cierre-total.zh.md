# Agent Note: Mesa 十二个未决业务点的收尾

Status: implemented

[English](2026-11-02-mesa-cierre-total.md) | 中文

## Problem

Mesa 交付时仍有十二个点未决：原型签字、自主阈值、SLA、成熟度队列、供应商上限、候选保留与共享 agent 拓扑、F 用例映射、展示时区、Jev、438 条没有 `sourceRef` 的遗留行、可访问性，以及外部文档债务。把它们继续当作“待业务输入”会让产品带着无人用测试或配置执行的规则。

## Decision

架构师受所有者委托关闭它们，唯一约束是：不需要 CEO 签字。A-44 签署 SLA 与升级；A-45 依据 `POL_AI_GOV_DATA_CLASS_PROVIDER` 签署供应商上限；A-46 签署队列与告警阈值；A-47 签署候选保留；A-48 规划遗留 rekey 且不臆造身份；A-49 固定 `America/Costa_Rica`；A-50 映射 F 到 W；A-51 以激活清单推迟 Jev；A-52 以证据接受原型；A-53 以自动化覆盖和发布期读屏检查关闭可访问性；A-54 记录剩余文档债务；A-55 固定共享 agent 拓扑；A-56 把规范重命名为 v1.7。

## Consequences

- `board.slaOf` 和 `slaBySeverityMs` 把截止时间变成服务端规则；未分类条目没有 SLA。
- `view.providerDataClassCeilings` 默认采用 KB 矩阵，回退为 N1，因此托管供应商的 N3/N4 保持关闭。
- `learning.maturityAlerts` 评估至少二十个已关闭条目的队列，并在 −15 个百分点时触发 `REGRESSION`。
- `learning.pruneCandidates` 在 365 天后删除已晋升候选，永不删除待决候选。
- `board.rekeyPlan` 和 `faberloom_board_rekey_plan` 工具报告证据支持什么、什么需要人。
- `mesa-date.ts` 以哥斯达黎加时间格式化队列日期，存储时刻仍为 UTC。
- 原型、可访问性和 Jev 保留明确的发布期检查，而不是开放的阻塞项。
- 在 `harness.mwt.one` 的实时 Lighthouse 通过中，可访问性得分 0.99；品牌按钮现在命名可见品牌，中列为 `<main>` 地标，快捷键详情用 Escape 关闭并把焦点返回其 summary。

## Alternatives considered

把这十二个点继续当作业务阻塞项被拒绝：多数在本文档或知识库中已有决定，其余只需一个明确取值。复制整张 KB 保留表被拒绝，因为 Mesa 只拥有派生候选；试点采用一年这一行。从自由文本推导遗留来源引用被拒绝，因为 313 个产物曾因此坍缩；计划只读取文档引用或单一且不同的证据标记。

## Testing

`board-effects.spec.ts` 覆盖 A-44 和 A-48；`board-iteration.spec.ts` 覆盖 A-45；`corrections.spec.ts` 覆盖 A-46 和 A-47；`registration.client.spec.tsx` 覆盖 A-49。宿主套件：105 个文件 1 318 个测试。客户端套件：14 个文件 191 个测试。`tsc` 宿主与客户端为零。`ci-lint-contracts-ready` 通过；`verify-translation-pairing` 报告 1 076 对一致；`verify-client-ui-i18n` 666 个文件；`verify-cordis-config` 230；生成目录稳定。

## Duplication budget

A-57 把零克隆门禁替换为已签署的 0.1% 预算。测得基线为 31 个克隆、311 行重复（467 281 行的 0.07%）；门禁在 0.1% 通过、在 0.01% 失败，因此预算仍在执行。提高上限需要重构和新的带日期决定。
