# Agent 笔记：草稿在会话中关联 Space，并携带真实文件

Status: implemented

[English](2026-11-23-draft-space-gesture-and-real-attachments.md) | 中文

## 问题

草稿编辑器里出现了用户并没有要求放在这里的 Space 关联。由供应商邮件线程生成的草稿，在修订选择器与发送行之间显示 `Vincular a email_docker`，而这个动作本来属于承载草稿会话的浮动对话。修订控件位于正文上方，于是“选择修订”和“恢复修订”这两个相关动作与“Enviar”“Insertar firma”分开了。

草稿本身也不完整。回复运输线程的草稿写着 `La factura comercial se las hago llegar por aparte`，却没有携带任何文件，尽管线程中就有那张发票。`faberloom_email_draft` 根本没有附件参数，而 `emailDraftWithAi` 要求代理只返回正文，于是 Host 保存了文字，却没有文档。草稿代理只能通过 `faberloom_email_draft_update` 复制附件，但它的种子从未告诉它文件在哪里。

## 决定

### Space 动作属于会话

邮件面板不再渲染草稿的 Space 建议。用户在浮动窗口打开草稿会话时，面板把草稿及其建议发布到邮件会话已经在用的同一张卡片，由卡片给出明确的动作。`FaberLoomDraftSpaceSuggestion` 现在携带它所描述的草稿修订，因此卡片在点击时读取修订再调用 `draftAttachToSpace`：卡片显示期间代理所做的编辑不会被过期的确认覆盖。

### 修订控件移入发送行

`Revisión del borrador`、它的下拉框和 `Restaurar revisión` 一起移入邮件工具栏，与 Enviar、附件按钮和 Insertar firma 同排。下拉框保留无障碍名称，恢复按钮采用与 Enviar 相同的填充样式，因为恢复已保存的修订是一次有意的写入，而不是脚注。窄屏时工具栏换行，保持顺序且不溢出。

### 草稿携带邮件所承诺的文件

`faberloom_email_draft` 接受与更新工具相同的邮件附件参数，因此草稿可以在创建时就带上发票，而不必事后再编辑。`faberloom_email_draft_update` 还接受 `attachFromSpaceFileId`，只从属于该草稿自身 Space 的文件复制字节。

`buildDraftSeed` 现在同时返回种子和读取线程时找到的文档。种子在 `<untrusted-attachment-sources>` 下用准确的 `uid`、`connectionId`、`mailbox` 和名称列出每个文档，并在 `<untrusted-space-files>` 下列出草稿 Space 的文件。`emailDraftWithAi` 先保存正文，再让同一个受限的草稿会话附加邮件需要的文件，最后重新读取草稿。附加回合失败时，已保存的正文仍然保留。

草稿指令现在禁止两种不诚实的捷径：在已保存草稿没有列出文件时声称已附加，以及在种子中已有来源时承诺另外发送。

## 考虑过的替代方案

**在编辑器和浮动窗口都保留 Space 控件。** 否决：一次写入出现两个确认，而编辑器是审阅文字的地方，不是把会话移入 Space 的地方。

**让模型以文本返回附加计划，由 Host 解析。** 否决：藏在模型输出里的私有标记协议对模型自身的工具不可见，措辞漂移时会静默失败。

**自动附带原始邮件的全部文件。** 否决：引用含有无关文件的线程时会把它们一并发出去。由代理决定，用户仍要批准确切的修订。

**把 Space 工作区当作普通文件读取。** 暂缓：草稿代理没有文件系统工具，按路径读取需要那些工具已经拥有的工作区根目录约束。目前由 Space 文件覆盖已附加的文档。

## 影响

线程中确有文档的回复会多花一个模型回合，且仅在种子找到文档时发生。草稿历史随后包含一个带正文的 `initial` 修订和一个带附件的 `agent` 修订，因此恢复会回到被审阅的确切组合。

浮动卡片需要草稿在读取时仍然存在；期间被删除的草稿只会留下卡片而不会写入。没有匹配 Space 的草稿仍要等到第二个持久修订后才提供 `Crear Space`，与之前一致。

## 测试

`vitest run packages/faberloom/view packages/faberloom/tool-faberloom` 覆盖：从邮件复制发票创建草稿、只从草稿自身 Space 复制文件、拒绝其他 Space 的文件、附加回合点名 `pedido.pdf`，以及线程没有文档时不启动附加回合。`vitest run packages/client/ui-faberloom` 覆盖面板与 Remote 接口，`tsc -b tsconfig.client.json` 与 `tsc -b tsconfig.host.json` 均通过。
