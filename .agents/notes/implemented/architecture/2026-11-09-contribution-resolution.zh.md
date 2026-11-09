# Agent Note: Inheritance is resolved after authorization, never before it

Status: implemented

[English](2026-11-09-contribution-resolution.md) | 中文

## Problem

子空间在未检查行为主体能否读取父空间的情况下继承父上下文。同企业的父空间因此可以把规则或标题贡献给仅子成员。即使父可读，共享父记忆也被遗漏。没有处理子级优先、显式排除、依赖图、循环、重名或上下文预算的解析器，父变更也没有影响矩阵。

## Decision

**纯解析器只处理已授权候选。** `packages/faberloom/spaces/src/resolve.ts` 接收调用方已经读取的根与父贡献。它按贡献 id 应用子级优先、显式排除、依赖闭包、循环拒绝、重名拒绝与经过校验的字节预算。当恰好一个根贡献与某祖先同名时，根胜出，祖先报告为 `name-conflict`；两个根贡献同名仍属未解决冲突。缺失或被阻依赖拒绝依赖者；超预算贡献报告为 `context-budget`，第二轮闭包会拒绝其依赖被预算移除的依赖者。正文不会为了凑数而被截断，非有限或负预算被拒绝，而不是关闭上限。问题只携带贡献 id 与原因，绝不携带私有父标题或正文。排除可命名一个 Space（隐藏其上下文贡献）或一个贡献 id；记忆是显式捕获，在祖先可读时不受 Space 排除影响，与 `effectiveMemory` 一致。`sources` 按贡献 id 顺序列出 Space id。

**Space 在 `mayRead` 之后构建候选。** `FaberLoomSpaces.resolveContributions` 遍历根与祖先；只有在 `mayRead(parent, actor)` 后，才加入父的规则、策展文档与共享记忆。私有父从不进入列表，因此不会进入结果、问题或后续发布。`effectiveContext` 现在执行同样的父检查，`effectiveMemory` 纳入可读祖先的共享条目，而不再只包含 actor 自己的条目。同企业身份本身不是访问权。授权单位是 Space：`mayRead` 或有效的共享授权决定整个 Space，内部每个贡献继承该决定。按条目授权不在本模型中；撤销或过期共享会停止下一次解析，授权撤销测试覆盖这一点。

**A parent change produces an impact matrix.** `parentChangeImpact(actor, parentId)` 遍历每个后代自己的继承链，因此选择不继承的孙空间或排除父的子空间不会被报告，不可读的中间祖先会中断链条。它只列出 actor 可读取的子空间；不可读的子空间不会出现，其 id 与修订不会泄漏。`permitted` 表示 actor 可发布新修订，因此使用 `mayManage` 而非 `mayRead`。结果只含 id、当前修订，没有私有标题；查询不修改子空间、不自行发布，消费者发布被允许的修订。

**父变更打开需人工批准的提案。** aberloom_spaces_propose_children 调用 parentChangeImpact，解析每个有发布权限的子空间，构建一个只含子空间自有贡献和父修订引用的工件。它绝不复制父标题或正文。工件作为 propuesta-conocimiento 提交；现有批准流程与 aberloom_publication_publish 应用并激活它。依赖或预算拒绝会跳过该子空间并保留最后有效发布；工件未变化时不打开任何提案。影响矩阵本身仍只读，绝不发布。

## Alternatives considered

**把企业成员资格当作继承授权。** 这正是缺陷：属于组织会把父材料导出给子成员。父必须按贡献可读。

**无 actor 调用 `harness-projection.readUsage()`。** 投影按 scope 读取持久记录，而不是按授权调用方。Space 解析器从授权服务读取构建候选，任何导出路径都不在无 actor 上下文调用投影。

**按读取顺序解析并在超限时截断。** 读取顺序会隐藏名称冲突，截断会隐藏缺失依赖。解析器拒绝冲突并报告预算问题。

**在影响查询内发布。** 查询不得改变持久状态。影响矩阵只识别子空间与修订；发布留给授权消费者。

## Consequences

仅子成员只看到子贡献，直到父被授权。可读父的共享记忆会被继承，私有条目留在所有者处。名称冲突、循环、缺失依赖与预算超限成为可见错误，而不是静默遗漏。会话 scope 还会说明列表上限省略了多少记忆条目、上下文字键或策展条目，提示词不会在没有计数的情况下丢弃它们。解析器支持 rule、document、skill、context 与 memory 种类；Space 集成构建规则、策展文档与记忆，agent 目录中的 skills 属于适配器切片。影响矩阵是快照；消费者仍需创建新修订并发布。

## Verification

- `packages/faberloom/spaces/tests/contribution-resolution.spec.ts`：仅子成员看不到父上下文或私有记忆；父授权后共享上下文与记忆出现；撤销 view 授权后下一次解析移除父贡献；skill 子级优先；重名、子级胜出重名、循环、缺失依赖、预算闭包拒绝依赖者、非法预算、预算；Space 排除隐藏上下文但保留记忆；私有标题不出现在问题中；仅在拥有管理权时影响允许，不可读子空间被省略，退出继承与排除父的后代被省略，不可读中间祖先后的可读后代也被省略。
- `packages/faberloom/session-agent/tests/session-agent.spec.ts`：scope 说明省略的列表项、上下文冲突、省略的子空间与额外的范围外 Space，而不是丢弃。
- `packages/faberloom/mcp-server/tests/spaces-propose.spec.ts`：父变更打开一份提案，工件只含子空间自有内容与父修订引用；diff 不含父标题或正文；批准的 diff 发布并激活；第二次运行未变化；预算拒绝保留最后发布且不打开提案。
- `packages/faberloom/publication/tests/publication.spec.ts`：`readAt` 返回修订中的已提交文本，并拒绝缺失路径。
- `packages/faberloom/spaces/tests/reference.spec.ts`：现有引用组合与排除行为仍通过。
- `packages/faberloom/portable/tests/context-authorization.spec.ts`：portable 规划器自身的依赖与继承规则仍被覆盖。
