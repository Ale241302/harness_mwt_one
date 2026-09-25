# Agent Note: 智能体可以读取邮箱邮件及其文档

Status: implemented

[English](2026-09-24-faberloom-mail-read-tool.md) | 中文

## Problem

邮件面板能展示一封邮件并把附件交还给用户，例程也能从邮件中学习，但模型无法按需读取某封邮件。`faberloom_mail_search` 只返回信封，而 MWT.ONE 的 Correo 模块只保存已导入的邮件；躺在 IMAP 邮箱里的订单或形式发票对智能体不可见，于是它回答“读不到正文或附件”，尽管面板里明明显示着那个 PDF。

## Decision

新增模型工具 `faberloom_mail_read(uid)`，返回邮件的纯文本正文，并把每个附件转为 Markdown，让智能体自己读到订单、形式发票或规格文本。

- 该工具解析已挂载的收件服务（`ctx.get('faberloomInbound')`），调用 `readEmail(ownerId, uid)`，并用共享的 `markdownFromAttachments` 转换附件。
- `faberloom_mail_search` 在渲染的每一行打印邮件的 `uid`，模型因此用真实 `uid` 调用 `faberloom_mail_read`，而不再手工逐个探测序号；读取工具的说明与工作区邮件规则都禁止这种探测，也禁止用报告工具重建附件文件，并指引用户到邮件面板取原件。
- 附件摄取从 `packages/faberloom/view/src/documents.ts` 移到 `packages/faberloom/inbound/src/documents.ts`，并从 inbound 入口重新导出，于是面板与工具共享同一个转换器和同一份 `@firecrawl/anydoc` 依赖。工具从自己的 `Config`（`anydoc`、`anydocOcr`、`anydocApiKey`）读取转换选项，网关用与 view 相同的 `ANYDOC_*` / `FIRECRAWL_API_KEY` 变量填充。
- 退化行为与面板一致：anydoc 关闭、子进程提供者缺失、转换器未安装或需要 OCR 时，工具仍返回正文并列出附件（Markdown 为空）；它绝不使调用失败。
- 配套工具 `faberloom_mail_attachment(uid, name?)` 把附件的原始字节写入会话工作区下的 `correo-adjuntos/` 并返回路径，用户因此拿到真实文件，智能体也可用业务文档工具上传；邮箱保持只读。

## Alternatives considered

**让模型改读 MWT.ONE 的 Correo 模块。** 该模块只保存已导入的邮件——触发本次工作的线程（一封实时的 Sondel 邮件）并未导入——而且它的工具只返回信封，不返回正文或附件。

**只给用户一个下载入口、让用户自己粘贴文件。** 这会让智能体继续“失明”，把工作推回给用户，正是本次要消除的集成缺口。

**在 `tool-faberloom` 内复制转换器。** 同一套有界子进程协议的副本会逐渐分叉；该助手应归入门读邮件的读取方，两个消费者本就依赖它。

## Consequences

- 模型请求现在会把文档的 Markdown 放进上下文；助手的每文档 200 KB 上限与邮件正文长度限制了新增 token。
- 该工具返回文档文本而非原始二进制：用户从邮件面板下载原件，智能体被明确告知不要伪造替代文件。
- `faberloom_mail_read` 像面板一样读取主 IMAP 连接；选择其他连接留给搜索工具的 `connectionId`，直到此处出现真实需求。
- `@firecrawl/anydoc` 运行时依赖与 subprocess peer 现在挂在 `inbound`，而非 `view`。

## Testing

`packages/faberloom/inbound/tests/documents.spec.ts` 覆盖转换器的格式映射与容错路径；该工具的注册与接线由 host 构建和 faberloom 工具套件覆盖。
