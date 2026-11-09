# Agent Note: Inheritance is resolved after authorization, never before it

Status: implemented

[English](2026-11-09-contribution-resolution.md) | 中文

## Problem

子空间在未检查行为主体能否读取父空间的情况下继承父上下文。同企业的父空间因此可以把规则或标题贡献给仅子成员。即使父可读，共享父记忆也被遗漏。没有处理子级优先、显式排除、依赖图、循环、重名或上下文预算的解析器，父变更也没有影响矩阵。

## Decision

**纯解析器只处理已授权候选。** `packages/faberloom/spaces/src/resolve.ts` 接收调用方已经读取的根与父贡献。它按贡献 id 应用子级优先、显式排除、依赖闭包、循环拒绝、重名拒绝与字节预算。缺失或被阻依赖拒绝依赖者；超预算贡献报告为 `context-budget`，其余正文不会为了凑数而被截断。问题只携带贡献 id 与原因，绝不携带私有父标题或正文。

**Space 在 `mayRead` 之后构建候选。** `FaberLoomSpaces.resolveContributions` 遍历根与祖先；只有在 `mayRead(parent, actor)` 后，才加入父的规则、策展文档与共享记忆。私有父从不进入列表，因此不会进入结果、问题或后续发布。`effectiveContext` 现在执行同样的父检查，`effectiveMemory` 纳入可读祖先的共享条目，而不再只包含 actor 自己的条目。同企业身份本身不是访问权。

**父变更产生影响矩阵。** `parentChangeImpact(actor, parentId)` 识别继承父的直接与间接子空间，仅当 actor 可读子空间时标记 `permitted`，并返回子修订。它不自行修改子空间或发布；消费者发布被允许的修订。结果只有 id 与修订，没有私有标题。

## Alternatives considered

**把企业成员资格当作继承授权。** 这正是缺陷：属于组织会把父材料导出给子成员。父必须按贡献可读。

**无 actor 调用 `harness-projection.readUsage()`。** 投影按 scope 读取持久记录，而不是按授权调用方。Space 解析器从授权服务读取构建候选，任何导出路径都不在无 actor 上下文调用投影。

**按读取顺序解析并在超限时截断。** 读取顺序会隐藏名称冲突，截断会隐藏缺失依赖。解析器拒绝冲突并报告预算问题。

**在影响查询内发布。** 查询不得改变持久状态。影响矩阵只识别子空间与修订；发布留给授权消费者。

## Consequences

仅子成员只看到子贡献，直到父被授权。可读父的共享记忆会被继承，私有条目留在所有者处。名称冲突、循环、缺失依赖与预算超限成为可见错误，而不是静默遗漏。解析器支持 rule、document、skill、context 与 memory 种类；Space 集成构建规则、策展文档与记忆，agent 目录中的 skills 属于适配器切片。影响矩阵是快照；消费者仍需创建新修订并发布。

## Verification

- `packages/faberloom/spaces/tests/contribution-resolution.spec.ts`：仅子成员看不到父上下文或私有记忆；父授权后共享上下文与记忆出现；skill 子级优先；重名、循环、缺失依赖、预算；私有标题不出现在问题中；每个子空间影响允许/拒绝。
- `packages/faberloom/spaces/tests/reference.spec.ts`：现有引用组合与排除行为仍通过。
- `packages/faberloom/portable/tests/context-authorization.spec.ts`：portable 规划器自身的依赖与继承规则仍被覆盖。
