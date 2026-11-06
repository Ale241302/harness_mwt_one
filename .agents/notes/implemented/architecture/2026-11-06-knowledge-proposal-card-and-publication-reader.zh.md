# Agent Note：可读的提案卡与按工作引用固定版本的发布读取器

Status: implemented

[English](2026-11-06-knowledge-proposal-card-and-publication-reader.md) | 中文

## 问题

Mesa 把知识提案列为看板条目，却无法展示提案本身：审查者只看到标题和状态，看不到文件、基础修订、原因、范围、diff、证据或历史。要判断提案，只能读取条目的 JSON。MCP 服务端也无法返回提案引用的已发布字节，初始 host 因而无法证明读取与提案共享同一个授权目标，而不是信任模型提供的字符串。

## 决策

**看板详情投影提案及其历史。** `FaberLoomBoardDetail` 携带 `proposal: FaberLoomKnowledgeProposal | null` 与 `revisions: readonly FaberLoomBoardRevisionRow[]`。当 `artifactType` 为 `propuesta-conocimiento` 时，`knowledgeProposalOf` 从条目最后一版读取七个业务字段；记录不完整时投影 null，而不是半张卡片。受限数据类投影 null 和空列表，与现有隐藏内容和摘要的规则一致。

**卡片只渲染不可信文本。** `ProposalCard` 展示文件、基础修订、原因、范围（`文件 · +新增 −删除`）、逐行 change 的 `<pre>`、证据、修订历史和决策。它不使用 `dangerouslySetInnerHTML`，不创建链接元素，也不加载远程图片：任何字段中的 `<script>`、`<a href>` 或 Markdown 图片都保持可见文本，不生成可执行或可请求的节点。批准与拒绝复用 Mesa 现有的 `openApprove` 和 `setShowDiscard(true)` 控件，因此检查、签名和理由流程不会重复。条目过期、有待决候选、缺少已声明检查、有阻断性检查失败或读者无编辑权时，控件保持禁用。

**读取器从工作引用取得修订。** `faberloom_publication_read` 从 `publicationRepo` 读取 `git show <commit>:<path>`，其中 `<commit>` 是授权引用固定的修订。调用方只提供仓库相对路径：绝对路径、`..` 和分支名都会被拒绝，文件上限 1 MiB，应答携带 `revision`、`path`、`bytes`、`sha256` 和 `text`。未配置仓库时不发布该工具；缺少引用修订时以 `PUBLICATION_REFERENCE_REQUIRED` 拒绝。

**固定发布同时约束提案基础。** 当配置了 `publicationRepo` 时，`faberloom_proposal_submit` 对与引用修订不同的 `versionBase` 以 `PROPOSAL_BASE_MISMATCH` 拒绝。这样在安装提供发布时，提案绑定到人工授权的字节。

**待处理连接显示其修订。** 待授权行现在携带 `revision`，连接面板将其标出（`Revisión: …` 或 `sin revisión fijada`），从而区分已授权连接与没有固定发布的连接。这并不声称内容已加载。

**详情失败保留草稿并提供重试。** Mesa 的详情错误态渲染 `action.retry`，它提高读取计数并重新发起 `boardDetail`；编辑器及其草稿保持挂载。

## 考虑过的替代方案

**把 diff 渲染为 HTML。** 它能在变更内使用标题和颜色，但会让模型和仓库提供的文本可执行。行样式已经能区分新增和删除，无需活动内容。

**接受修订或分支作为工具参数。** 调用方可能读取比人工授权更新的提交，这是 3A.4 禁止的。引用是唯一的修订来源。

**为 1.5 模拟读取器。** 计划要求真实读取器，禁止以替身关闭阶段 1。本地 Git 读取器是真实的；3A.3/3A.4 的 MinIO 恢复仍是独立且未实现的适配器。

**用一个令牌同时读取和提案。** 1.3 的约定要求提案工具独占。因此端到端演示在同一空间、同一固定修订下分别授权读取连接与提案连接，并断言该修订的读取字节正是提案所指文件；每个令牌仍然拒绝另一种操作（CON-02）。

## 后果

审查者无需读取 JSON 即可判断提案，任何字段中的恶意值都保持惰性。引用返回的字节不会随分支移动，提供发布的安装上的提案不能悄悄指向另一个修订。

MinIO 路径仍然开放：只存在于对象存储中的发布无法通过该工具读取。在配置了 `publicationRepo` 的安装上，引用修订来自空间 `updatedAt` 的令牌必须用该值提案；提供发布的授权应显式指定提交。桥接仍未转发工作引用，因此读取工具只在本地 loopback 端点上工作。

## 验证

- `packages/faberloom/mcp-server/tests/publication-reader.spec.ts`：固定提交的字节与摘要；分支、目录穿越、绝对路径和缺失文件被拒绝；非 Git 目录被拒绝；字节上限。
- `packages/faberloom/mcp-server/tests/oauth.spec.ts`：固定到提交的读取范围返回该修订与文本；读取令牌不能提案，提案令牌不能读取；同一固定修订上的提案被归入其空间；不同基础以 `PROPOSAL_BASE_MISMATCH` 拒绝。
- `packages/faberloom/view/tests/board-iteration.spec.ts`：详情投影七个字段与修订历史。
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`：卡片展示文件、原因、diff、范围、证据和版本；`<script>`、`<a>` 和图片 Markdown 不产生可执行节点；批准打开确认并调用 `boardApprove`；拒绝打开真实的理由面板；详情失败保留草稿并可重试；待处理连接显示固定修订并经服务端决策。
