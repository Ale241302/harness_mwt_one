# Agent Note: 以证据关联的 FaberLoom portable 交付

Status: proposed

[English](2026-11-05-faberloom-portable-verification.md) | 中文

## Problem

FaberLoom portable 源资料包定义了 58 项验收需求，覆盖本地操作、提案、发布、host 适配器、可选 MWT 和分发。组件测试通过不能证明 host 已加载授权修订，或提案只产生了准确批准的持久效果。独立阶段报告也可能遗漏需求或复用其他代码修订的证据。

## Proposal

将[阶段与批次计划](../../../../docs/scratch/faberloom-portable-fases-olas.zh.md)作为临时执行参考。43 个批次规定所有者、变更、比较、验收、恢复与依赖。阶段 0 只定义验证 harness，不实施；H0 在首个获授权代码批次 1.1 或 2.1 中构建。

维护明确的需求→批次→测试→证据登记。复用仓库 runners，将可观察权限、文件、持久记录、产物、host 加载修订与独立 expected 对照。缺凭据、skip、零测试、过期证据不能证明验收。Mutation fixtures 验证检查器拒绝需求缺失、字节变化和未认证人工批准。

1.4 交付授权/引用，3A.4 交付发布读取，1.5 在阶段 1 关闭前证明同连接读取与提案。Portable 内容排除 Sessions、转录、凭据。批准校验既覆盖批准方法，也覆盖直接 import 和 restore。

## Relationship to existing notes

活动 notes 搜索未发现拥有此交付计划的既有决策。[Space 上下文提案](../feature/2026-10-03-automatic-semantic-space-context.zh.md)继续拥有上下文发现与蒸馏。[共享 Sessions 决策](../../implemented/feature/2026-10-04-space-shared-sessions.zh.md)保留其独立共享机制；portable 包排除 Sessions 不代表移除该功能。本提案不替代或归档这两份 note。

## Alternatives considered

**只用文字清单。** 它记录意图，却不能拒绝缺失证据或静默缩减需求。提案增加机器校验登记，并保留详细规划参考。

**独立执行框架。** 仓库已有 runners、组合测试和会话 replay。另建通用 runner 会重复调度/平台策略；新代码只拥有 portable 专属选择、证据与比较。

**各阶段独立结束，不做跨阶段集成。** 阶段 1 需要真实发布读取才能证明同连接读取与提案。明确 1.4→3A.4→1.5 依赖，避免将读取器替身当作最终集成。

## Acceptance criteria

- 全部 58 项源需求及适用 F01 至 F50 回归均有明确所有者和验证映射。
- Harness 负面控制拒绝需求缺失、零测试成功、产物字节变化及另一修订证据。
- 每个有状态批次验证恢复并比较外部效果，不依赖模型自述。
- 必需性质被反证或未验证时，依赖工作不得关闭；host 支持限实际测试的应用、版本、平台。
- 实施遵守仓库覆盖率、组合、snapshot、持久化和文档要求，不降低标准。

## Decisions

架构于 2026-11-05 固定六项输入，使 0.2 得以推进：首个认证应用为 Claude Code，使用专用非管理员组织账户（D01）；首个增量只允许本机访问 home，远程服务不构建（D02）；编辑权威是按组织的知识 Git 仓库，唯一写入者为 `publication` 的技术 actor（D03）；CEO-ONLY、N3、N4 通过服务端评估的允许清单排除（D04）；继承按贡献显式声明，子优先且已声明的排除生效（D05）；本地 home 使用显式的 BYOK 或本地端点模式，凭据存于 host 存储，数据位于同步目录之外（D08）。各条规则记录在[计划](../../../../docs/scratch/faberloom-portable-fases-olas.zh.md#22-decisiones-bloqueos-y-resoluciones)中；D06、D07 与 D09 至 D14 仍开放，只阻塞消费它们的批次。

## Risks

外部生成器分支、Consola/IdP、已部署 MinIO 策略和真实 host 账户是独立输入。缺失可阻塞相关批次，不妨碍独立本地工作。计划不授权执行阶段或访问生产。临时文档到期必须复核，不能成为已交付 runtime 行为的第二份描述。
