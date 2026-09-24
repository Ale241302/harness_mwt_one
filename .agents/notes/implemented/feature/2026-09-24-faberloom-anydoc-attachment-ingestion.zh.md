# Agent Note: 邮件附件会转换为 Markdown 并被摄取

Status: implemented

[English](2026-09-24-faberloom-anydoc-attachment-ingestion.md) | 中文

## Problem

邮件面板此前能把附件挂到空间并交还给用户，但模型从未读到附件内部。`spaceFromEmail` 与 `learnFromEmail` 只能看到邮件正文，因此会创建或更新档案（expediente）的例程无法学到 xlsx 里的 SKU、tallas、cantidad、precio，随邮件发来的 PDF 也只是噪声。“例程根据邮件更新记录”这一产品承诺，卡在了附件这一环。

## Decision

邮件附件通过外部转换器 `anydoc` 转为 GitHub 风格 Markdown，并作为空间记忆保存；该能力默认关闭且尽力而为。

- `packages/faberloom/inbound/src/documents.ts`（归属邮件读取方，使所有消费者共享同一实现）：经 Node 模块图解析转换器（对 `@firecrawl/anydoc/package.json` 使用 `createRequire`，再取其 `bin` 字段），并通过 harness 子进程提供者（`ctx.get('subprocess')`）启动其 `cli.js` 启动器，绝不使用 `node:child_process`。JavaScript 启动器由当前 Node 运行，因此 Windows 无需可执行位。
- 转换在设计上就是容错的：不支持的扩展名、子进程提供者缺失、转换器无法解析或未安装、非零退出（含退出码 3“该 PDF 需要 OCR”）、启动失败或超时，都会跳过该附件，让调用方仅凭正文继续工作。其暂存目录在每条退出路径上都会被删除。
- `spaceFromEmail` 把每个已转换文档记入新空间；`learnFromEmail` 以所有者范围记入，并把 Markdown 追加到抽取提示中。记忆文本与提示共享同一段有界切片。
- 这是部署配置：`anydoc`（布尔，默认 `false`）、`anydocOcr`（`reject` 跳过扫描版 PDF；`hosted` 交给 Firecrawl Parse，默认 `reject`）、`anydocApiKey`（为空则沿用转换器自身环境）。上限是固定的安全不变量而非可调项：保留 200 KB Markdown、8 KB 诊断、每个文档 20 秒、终止宽限 5 秒。

## Alternatives considered

**把该包当库导入。** `@firecrawl/anydoc` 只提供一个驱动预编译原生二进制的 `cli.js` 启动器，没有编程接口，因此启动其 bin 才是受支持的用法。

**用 `node:child_process` 启动。** 这会绕过 harness 子进程提供者、其终止范围管理以及清理过的环境；本仓库所有进程都走该接缝。

**始终摄取，而非可选。** 每封邮件都启动进程并常驻一个新宿主依赖，对永远收不到可转换附件的部署是实打实的成本；默认关闭的标志让它们与今天逐字节一致。

**把 OCR 固定为 `reject`。** 扫描版 PDF 是常见真实情况，托管 OCR 会产生 Firecrawl 调用并需要密钥，因此模式与密钥是部署选择而非字面量。

## Consequences

- `inbound` 包新增运行时依赖 `@firecrawl/anydoc` 与 peer 依赖 `@deepseek-ai/dsh-subprocess`，并在其 `tsconfig.json` 中新增项目引用；`pnpm-lock.yaml` 随之变化。view 与 `faberloom_mail_read` 工具都经由 `inbound` 使用该转换器。
- 失败是刻意软化的：转换失败会退化为此前仅正文的行为，绝不使面板失败，因此在真正可用之前该能力不可见。
- 部署的宿主必须安装 `@firecrawl/anydoc`，首次转换可能拉取平台二进制；无法下载的部署只是跳过摄取。

## Testing

`packages/faberloom/inbound/tests/documents.spec.ts` 覆盖格式映射、不启动进程的路径（空批次、不支持的附件）、带 argv 与 stdio 断言的成功转换、托管 OCR 的 argv、非零退出，以及两个文档中一个启动失败。曾在 Windows 上真实执行一次 `node <anydoc>/cli.js <file> --format csv`，确认二进制可转换。
