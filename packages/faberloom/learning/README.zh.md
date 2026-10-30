---
description: "本 DeepSeek Harness 构建中的原生产品模块（ctx.faberloomMemory）：记忆、版本化教学、更正登记、学习候选、成熟度指标与情境绩效。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-learning

[English](README.md) | 中文

## 概述

此包承载记忆、版本化教学、带范围分类的更正登记、带来源血统与允许目标的学习候选、按任务类型划分的成熟度指标与情境绩效。它注册 `ctx.faberloomMemory` 主机服务；工作台与模型工具位于其他包。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在组合中挂载此行即可暴露 `ctx.faberloomMemory`。该服务是调用插件 fiber 上的副作用，释放该 fiber 即移除。

### 更正登记

`onCorrection(actor, input)` 是人工更正唯一的入口，无论它由何种方式产生。一条持久化记录携带来源方式、来源条目、租户、空间、账户、智能体、执行者、它触及的分类、它使用的字段以及人工选择的范围：

| 来源 | 载荷 |
|---|---|
| `edit` | 字段、原值、新值 |
| `answer_doubt` | 智能体提出的问题、人工选择的答案 |
| `iterate` | 指令、差异、轮数 |

已应用的迭代必须携带范围；行内编辑与已答复的疑点在无额外步骤时默认为 `puntual`（W-34）。更正从不被编辑或删除：迟到的错误改为更新一条教学。

### 学习范围

范围取 `puntual`、`cuenta`、`espacio` 或 `agente`。`puntual` 只登记，不教任何东西：它不产生候选。其余三者产生一条候选，并声明其允许目标。登记更正从不提升任何内容（W-35）。

候选继承其来源的最高数据分类，保留它继承的每一个分类，并复制它使用的字段（W-46）。分类仍为临时的来源只登记更正，不产生候选，因为临时数据不喂养任何派生产物。

### 提升与扩宽

`promoteCandidate(actor, id, { destination, acceptedDataClasses })` 是激活候选的唯一路径。提交前它会重新校验租户、执行者范围、对目标而言的分类、目标引用，以及回溯到其更正的来源血统。允许目标以外的目标一律拒绝（W-60），任何候选都不跨租户（W-47）。

目标接受的分类由调用方给出，因为分类策略尚未签署；提升从不自行假定上限。

`widenCandidate(actor, id, { destination, text, acceptedDataClasses })` 把候选从账户扩宽到空间，或从空间扩宽到智能体。它从不移动原候选：它新建一条候选，其内容由审阅者重写，而该候选仍需自己的显式提升（W-47）。收窄一律拒绝。

### 读取与隔离

`getCorrection`、`listCorrections`、`getCandidate` 与 `listCandidates` 都要求 `LearningActor`：租户，以及该身份持有的空间、账户与智能体。执行者未列出的空间、账户或智能体所属的来源不可读。`tenantId: null` 表示单租户部署，而不是通配符。调用方从自己的授权模型解析这些列表；此包从不放宽它们。

工作台把已应用迭代所选的范围作为普通值传入，因此此包不导入 `dsh-faberloom-board` 的任何内容。

### 成熟度指标

`recordOutcome(actor, input)` 记录某个条目的结果：`approved`、`discarded`、`skipped`、`delegated` 或 `delegated-reversed`。`maturity(actor, filter)` 按任务类型 `(space, artifactType, actionType)` 各报告一条：

| 指标 | 分母 |
|---|---|
| 更正负荷：迭代、被编辑字段、已答复疑点、总计、每条目 | 观察到的条目 |
| 无干预解决：批准且没有任何来源的更正 | 已关闭条目 |
| 丢弃占比 | 已关闭条目 |
| 跳过占比：至少被跳过一次的条目 | 观察到的条目 |
| 委派反转 | 委派结果 |
| 数量与已关闭条目 | 背景 |

每项指标各自报告。没有综合指数，且带已答复疑点的批准不算成功（W-80）。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomMemory` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **没有激活目标** — 提升只记录决定及其重新校验。把提升后的内容写进账户知识、空间规则或智能体指令，属于持有那些存储的包。
- **未签署的业务取值** — 目标接受哪些分类（POL_DATA_CLASSIFICATION）、§10.2 的队列定义与告警阈值、多少次跳过算作反复、所有者与提升权限、保留期，以及账户、空间与智能体之间的继承链，都等待业务签署。服务把它们作为参数接收，或者不作决定。
- **范围列表来自调用方** — 把 Owner、Admin 与成员角色映射到租户、空间、账户与智能体列表，不在此实现。
- **每条更正两次提交** — 更正与其候选是同一链上的两次持久化写入。候选写入失败会拒绝该调用，并保留已登记的更正。
- **过滤之外没有分桶** — `maturity` 按结果时刻过滤并只按任务类型分组；它不构建队列，也不比较周期。
- **临时分类的来源不产生候选** — 在 D-10 的许可字段清单存在之前，临时条目不产生学习候选，只登记更正。
- **不在可移植快照中** — 候选携带绑定租户的来源血统，因此 `exportKnowledge` 不包含更正、候选与结果。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
