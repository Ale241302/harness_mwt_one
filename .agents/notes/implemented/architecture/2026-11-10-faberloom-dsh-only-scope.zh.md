# Agent Note: FaberLoom portable 只面向 DSH 一个 host

Status: implemented

[English](2026-11-10-faberloom-dsh-only-scope.md) | 中文

## Problem

portable 计划带有四个适配器阶段——Claude、OpenAI、Kimi 与 Gemini/Antigravity——而产品所有者使用的是 DeepSeek Harness。每个 host 相关需求（HOST-01/03、UX-02/05、CON-04）散落在无法同时配备人力的阶段中，首个认证应用还是 Claude Code，尽管 DSH 才是产品 runtime。

## Decision

**DSH 是唯一 host。** `docs/scratch/faberloom-portable-fases-olas.md` 在 §2.2.2 写明范围，D12 已决：Windows 上的 DSH Desktop，启动版本在打开 4A.1 时固定。web、CLI 与 headless 是开放的矩阵行，均不继承 Desktop 的认证。

**阶段 4A 与 4B 保留编号并更换 host。** 4A 成为 DSH 首个完整循环，4B 成为逐应用收尾。4B.2（共存、更新、上下文成本）与 4B.3（状态、无障碍、用户评估）保留原范围。6A 仍是外部 bundle 分发。阶段 6B、6C、6D 被移除，而非推迟。

**Claude 工作作为 legacy 保留。** `packages/faberloom/portable/src/adapters/claude.ts`、`surfaces.ts`、`zip.ts`、其测试、`docs/faberloom/evidence/4b1-claude-matrix.json` 与 2026-11-10 的笔记保留在树中并继续运行。它们不对外宣布、不认证，除安全修复外不编辑。转换、清单、签名、发布与可用性属于 host 无关能力，继续服务 DSH。

**host 专属的证明不迁移。** 58 个案例保留标识符，变化的是批次与被观察的 host。`HOST-01` 回到 `no-comprobada`，因为其唯一证据加载的是 Claude 插件，替代测试 `portable/tests/dsh-distribution.spec.ts` 尚不存在。`IA-01` 保持已证明，因为 `no-hidden-model.spec.ts` 证明的是 portable 包的属性，不是某个 host 的属性。

## Alternatives considered

**保留其他适配器作为可选工作。** 可选阶段仍占用计划、所有权映射与验收矩阵的份额，并诱使一个 host 继承另一个 host 的结果。

**删除 Claude 适配器及其证据。** 代码已测试，其转换路径支撑 DSH 包；为命名偏好删除它会失去可用的清单与签名覆盖。

**把 4A、4B、6A 合并为一个 host 阶段。** 这会重编号批次，掩盖逐应用循环与外部分发的区别，并丢掉所有者已在使用的批次标签。

## Consequences

DSH Desktop 是首个可认证应用；web、CLI 与 headless 以各自的安装与认证保持开放。HOST-01、HOST-03、UX-02 与 UX-05 对 DSH 为 `no-comprobada`，直到测试与真人会话存在。Claude 的矩阵与证据可作为历史阅读，但不能关闭 DSH 的需求。恢复其他 host 需要新的带日期决策、自己的矩阵与循环。

## Verification

- `pnpm run check-faberloom-portable-plan`：58 个产品案例、8 个 harness 案例、10 个保留分组、6 个冻结文件、87 条所有权路径，所有需求批次都存在于计划中。
- `pnpm run test:docs`：20 个门槛通过，含翻译配对与文档预算。
- 两种语言的计划都有 37 个批次标题；`requirements.json` 记录计划摘要。
