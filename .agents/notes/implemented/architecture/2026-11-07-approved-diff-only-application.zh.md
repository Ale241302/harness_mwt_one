# Agent Note: Only the approved diff reaches a Git commit

Status: implemented

[English](2026-11-07-approved-diff-only-application.md) | 中文

## Problem

知识提案在 Mesa 获批，但仅有批准并不能固定任何东西：已批准的 diff 仍需要一个写入者，而它不能被诱导去触碰另一条路径、对照更新的基线应用、跟随符号链接，或在崩溃后提交两次。只解析一个已配置路径的单文件应用器还让看板条目的 `archivo` 成为第二个可编辑权威，并且无法承载并发批准。

## Decision

**`apply` 负责 Git；`publish` 增加对象存储。** `FaberLoomPublication.apply(approval)` 从已批准的看板条目读取 `itemId`、`revision`、`diff`、`artifactHash`、`motivo` 与 `evidence`。它从不接受仓库路径、目的地或要产出的提交。`git.ts` 中的 `commitApplication` 按 `Config.inventory`（服务端持有的清单）解析 diff 中的每个路径；空清单以 `PUBLICATION_INVENTORY` 闭锁拒绝。`commitPublication` 以单路径清单委托给同一函数，因此两个入口不可能在验证上分歧。

**写入前复核是一条受保护的序列。** 在 `.git/faberloom-apply.lock` 内，应用器复查 `HEAD` 仍是已批准基线（`PUBLICATION_BASE_STALE`）、每个目的地的每个已存在组成部分都不是符号链接（`PUBLICATION_SYMLINK`）、工作树没有已跟踪变更（`PUBLICATION_WORKTREE_DIRTY`），并且每个被应用文件保持在 `maxBytes` 以内。重命名、复制、模式与二进制区段以 `PUBLICATION_PATCH_INVALID` 拒绝，因为它们没有可供清单解析的 `---`/`+++` 头。应用后索引路径必须恰好等于清单路径、每个目的地必须解析到工作树内，硬链接会被拒绝。diff 文本作为输入传给 `git apply`；不会执行内容中的命令、提交钩子或 shell 展开，提交使用空的 `core.hooksPath`，因此 `post-commit` 也无法执行。活跃进程持有的锁以 `PUBLICATION_LOCKED` 拒绝；已死亡持有者的锁会被回收。

**身份与 diff 摘要让重试安全、让变更可复审。** 持久 `applications` 行以 `itemId\0revision\0artifactHash` 为键，并保存精确已批准 diff 的 SHA-256。同一 diff 的重放返回同一回执。同一身份下的不同 diff 是 `PUBLICATION_REQUEST_CONFLICT`，要求重新批准。应用前，应用器在基线与 `HEAD` 之间查找其确定性提交信息；提交后、写行前发生崩溃时，会协调到该提交而不是产生第二个。基线、清单、路径、符号链接、工作树、锁或补丁拒绝存为 `conflict`；基础设施失败保持 `failed`。

**看板条目是连接的唯一可编辑来源。** `faberloomView.boardApprove` 与 `boardApproveWithEdits` 在看板记录批准后调用 `applyApprovedKnowledge`。该方法从持久条目读取 `versionBase`、`cambio`、`motivo`、`evidencia` 与 `artifactHash`；跳过不是 `propuesta-conocimiento`、没有已批准修订或是 N3/N4 的条目。应用器拒绝会被记录，且不会回滚批准，因为批准是看板事实，应用是独立的持久事实。可选服务通过 `ctx.get('faberloomPublication')` 读取，因此没有发布服务的组合仍可批准。

## Alternatives considered

**保留每路径一个应用器并循环处理文件。** 多次调用会各自重新检查同一工作树，并可能在竞争批准之间落地；部分循环会让多文件提案只应用一半。围绕整个 diff 的一把锁保持提交原子。

**把看板条目的 `archivo` 当作目的地。** 条目是用户可编辑内容，服务端清单不是。按清单解析可防止被操纵的字段在批准身份不变时命名新路径。

**比较 diff 文本而不是摘要。** 摘要是持久行在重启后能比较的东西，并覆盖批准必须视为变更的空白与行尾。摘要在工作树被触碰前保存。

**重新计算 `HEAD` 并接受当前值。** 这会把批准静默应用到更新的基线。存储的修订必须仍是 `HEAD`；基线移动即冲突，需要新的批准。

**Git 拒绝时回滚看板批准。** 批准与应用是带独立持久行的独立效果；因基础设施状况回滚批准会摧毁人的决定。改为记录并呈现冲突。

## Consequences

已批准的多文件 diff 恰好变成一个提交，其信息携带条目、修订与产物哈希，正文列出每个路径。竞争批准要么在第一个之后运行并看到过期基线，要么等待锁；只有一个提交落地。提交后的崩溃可按身份恢复，变化的 diff 无法复用旧批准。代价是应用需要已配置的清单和干净工作树，checkout 中其它位置的合法并发编辑会阻塞它，直到操作者解决冲突。Git 应用器拒绝空清单，因此从未配置清单的部署无法应用任何内容。本地写入者若在预检与 `git apply` 之间把父目录换成联接，可能造成工作树外的瞬时写入；应用后的真实路径检查会检测并撤销它，因此零写入保证不覆盖这一竞态。

## Verification

- `packages/faberloom/publication/tests/application.spec.ts`：多文件提交与重试复用；跨重开组合的持久行；清单外路径；文件符号链接与符号链接父目录；过期基线；单进程内的两个竞争批准；共享一个工作树与一个介质的两个服务；活跃锁持有者被拒绝并在释放后重试；他人工作树变更；diff 内容未被执行；夹在合法 hunk 旁的重命名区段；同一身份下的变化 diff；冲突后重试；写行前已存在提交的协调。expected 树位于 `tests/fixtures/application-expected`，测试将已提交内容与路径同它比较。
- `packages/faberloom/view/tests/approvals.spec.ts`：批准转发持久 diff 与身份；应用器拒绝保留批准；N3 条目从不进入应用器。
- `packages/faberloom/mcp-server/tests/mcp.spec.ts`：发布工具在调用发布服务前拒绝 N3 提案与重开提案。
- `packages/faberloom/board/tests/board.spec.ts`：重开已批准条目会清除其已批准修订。
- `packages/faberloom/publication/tests/git.spec.ts` 与 `publication.spec.ts`：单路径发布与对象存储链仍经过共享应用器。
- 待完成：由 QA 独立于最终树准备的外部 fixture；测试比较最终内容与结果提交，而不是第三方期望树。
