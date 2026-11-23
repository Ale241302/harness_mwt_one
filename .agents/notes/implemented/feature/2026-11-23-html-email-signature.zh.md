# Agent Note: HTML email signatures with inline images

Status: implemented

[English](2026-11-23-html-email-signature.md) | 中文

## Problem

签名此前只有纯文本。所有人真实的签名都有标志或样式块，而这里带不了，于是每封邮件都发出无样式正文。签名编辑器还把 MCP 邮箱从账户列表里藏了起来，读起来像是账户丢了，而不是另一种邮件来源。

## Decision

每个签名带两个正文：`text` 是草稿和纯文本客户端看到的内容，`html` 则作为邮件的 HTML 替代部分发出。HTML 在保存时净化——脚本、内嵌文档、事件处理属性与脚本 URL 均被移除，正文上限 64,000 字符。只保存 HTML 而没有文本的签名，会用其标记推导出纯文本回退，因此不会有邮件发出空的文本部分。

HTML 替代部分在发送时由所有者已批准的正文组装，且仅当该正文仍以保存的纯文本签名结尾。被编辑过的正文因此以纯文本发出，而不会自相矛盾；这也是草稿本身不存 HTML 的原因。签名中的 `data:image` 会变成以 `cid:` 引用的 `multipart/related` 部分，因为多个客户端会丢弃 `data:` URL；超过 800 KB 的图片保持 `data:` URL，以免超出邮件预算。

编辑器在沙箱 iframe（`sandbox=""`）中渲染标记，预览因此没有脚本、也无法访问面板；同时接受最大 400 KB 的上传图片，并以内嵌 `data:` URL 的形式放入。

签名账户列表现在列出面板知道的所有账户，包括 MCP 邮箱，并标注为只读。只读邮箱的签名会被保存，并适用于任何从该地址发出的邮件；产品仍然拒绝从 MCP 邮箱发信，因此标注说明限制，而不是隐藏账户。

## Alternatives considered

**在草稿阶段而不是发送阶段组装 HTML。** 那样草稿要同时携带自己的 HTML，面板、智能体与恢复路径这三位写入者都得让两者同步，还包括切换发件人时的签名剥离。放在发送阶段组装，让唯一被批准的正文成为事实来源，使不一致不可能发生，而不只是不太可能。

**只保留 `data:` URL 图片。** 这样不需要 related 部分和内容 id，但 Gmail、Outlook 与多数网页邮箱会剥离 `data:` 图片，标志恰好在阅读签名的场景里消失。

**只发签名 HTML，不配纯文本。** 纯文本客户端里读起来更差，也会抬高垃圾邮件评分；而纯文本正是草稿已经展示的内容，由它推导标记没有额外成本。

**把只读邮箱从签名列表里藏起来。** 这正是编辑器原先的做法，读起来像账户丢失。列出它们并标注只读，陈述真实限制，同时允许为今后获得发信路由的地址先存好签名。

## Consequences

- `FaberLoomEmailSignature` 及其 Remote 行新增 `html`；存储记录默认为空字符串，因此本次改动之前写入的签名读取结果不变。
- `sendMail` 接受可选的 `html` 正文，并构造 `multipart/alternative`；带内联图片时把 HTML 部分包进 `multipart/related`。
- `saveEmailSignature` 增加第四个参数 `html`。
- 面板的签名编辑器仍以纯文本字段作为草稿所见内容的事实来源。

## Verification

`packages/faberloom/connections/tests/signature.spec.ts` 覆盖净化器、纯文本回退、替代部分组装与内联图片提取。`connections.spec.ts` 通过假 SMTP 服务器发送真实邮件，断言替代部分、related 部分、带附件的 mixed 正文，以及正文不再携带签名时的纯文本结果。`signatures.spec.ts` 覆盖存储与按账户读取两个正文。面板规格覆盖 MCP 账户标注、预览、上传与四参数保存。
