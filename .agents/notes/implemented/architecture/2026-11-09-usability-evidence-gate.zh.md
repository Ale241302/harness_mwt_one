# Agent Note: Usability evidence is a gate, not a synthetic estimate

Status: implemented

[English](2026-11-09-usability-evidence-gate.md) | 中文

## Problem

4A.3 必须证明一位真实代表用户能在最终表面安装、授权、加载、读取、提案、批准并恢复。D09 门槛仍开放，本机没有已认证的 D01 账号，D02 也未提供远程 web/mobile chat。开发者估计或合成人格会把未测试表面变成虚假认证。

## Decision

**证据套件可执行；人工观察不被模拟。** `packages/faberloom/portable/src/usability.ts` 用会话前批准的门槛校验一次观察。它拒绝角色为开发者或合成的参与者、没有批准人与日期的门槛、超过时间或帮助上限的会话、需要 token/命令/配置编辑的正常路径、未解释的 diff、失败的恢复，以及与实际修订或精确 host 版本不一致的加载记录。`scripts/faberloom-portable/usability-check.ts` 打印裁决，不完整观察以非零退出。`docs/faberloom/evidence/4a3-usability.template.json` 是填写表单；检查器会拒绝它。

**没有可复现的用户缺陷就不改 UI。** 现有 OAuth 与提案卡测试已覆盖 UX-01 与 UX-03；Code 包加载是 4A.1/4A.2。本批次不声称 Code 认证 chat 或 Cowork，也不通过临时隧道连接 home。消息或引导改动等待指出障碍的观察。

**在真实代表用户完成会话前，批次保持开放。** UX-02、UX-05、HOST-03 保持 `no-comprobada`；chat/Cowork 加载明确未确认。可接受状态是就绪套件加开放需求，而不是合成通过。

## Alternatives considered

**用合成人格作为参与者。** 验收要求真实代表用户与第一人称结果。检查器因此拒绝模型或开发者角色。

**用开发者计时估计。** UX-02 将观察与批准门槛比较，而不是估计。检查器要求批准人、批准时间与实际观察时间。

**用 Code 结果认证 chat。** D01 先认证 Code；chat 与 Cowork 依赖 D02 与各自流程。复用 Code 证据会夸大表面。

**根据计划假设改 UI。** 批次只修正可复现缺陷。套件记录障碍与下一步，使后续改动有证据。

## Consequences

套件阻止未观察会话被标记为通过，并强制门槛与加载记录显式。代价是 4A.3 在真实代表用户、D09 批准与支持表面可用前保持开放。Code、包加载、UX-01 与 UX-03 仍独立证明。

## Verification

- `packages/faberloom/portable/tests/usability.spec.ts`：接受代表观察；拒绝开发者/合成；未批准门槛；token 路径；超时；未解释 diff；恢复；不一致或缺失加载记录。
- `docs/faberloom/evidence/4a3-usability.template.json`：必填表单，在真实会话填写前被拒绝。
- `packages/faberloom/mcp-server/tests/oauth.spec.ts` 与 `packages/client/ui-faberloom/tests/registration.client.spec.tsx`：UX-01 同意/scopes 与 UX-03 故障保留。
