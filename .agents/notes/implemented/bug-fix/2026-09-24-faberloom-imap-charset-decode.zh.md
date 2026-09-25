# Agent Note：邮件正文按头部声明的字符集解码

Status: implemented

[English](2026-09-24-faberloom-imap-charset-decode.md) | 中文

## 问题

IMAP 读取器把整个 socket 流按 UTF-8 解码，并把每个正文部分也无视其 `Content-Type` 的 charset 一律按 UTF-8 解码。以 `iso-8859-1` 或 `windows-1252` 发送的邮件——大多数西班牙语往来——会丢失带重音的字节：socket 解码在正文被切出之前就把它们替换成了 U+FFFD，于是 `Buen día` 到达面板、空间种子和读取工具时变成了 `Buen d�a`。

## 决定

按字节读取数据流，并用每个正文部分头部声明的 charset 解码。

- socket 处理器把每个分块按 Latin-1 解码，使收到的每个字节都保留为一个码点，且 FETCH literal 的长度仍与其字节数一致。
- `decodeTransfer` 对 `7bit`/`8bit`/`binary` 情形原样返回该部分的字节（`Buffer.from(body, 'latin1')`），而不是把它们重新编码为 UTF-8。
- 新增 `decodeText(bytes, charset)` 读取该部分 `Content-Type` 的 `charset` 参数，并经 `TextDecoder` 解码；charset 缺失或未知时回退到 UTF-8。
- `parseMessage` 及其之上的面板、空间种子与 `faberloom_mail_read` 共享此修复。

## 考虑过的替代方案

**先假定 UTF-8，再修复乱码。** 有损解码在 socket 处就丢掉了原始字节，下游无法恢复；修复必须保留字节。

**默认使用 `iso-8859-1`。** 它能修好西班牙语情形，却会破坏常见的 UTF-8 正文；头部已经声明了 charset，读取它即可。

## 后果

- Latin-1 的 ASCII 头部与 IMAP 协议文本不受影响；非 ASCII 的头部字节现在能保留到 `decodeMimeWords`。
- `TextDecoder('iso-8859-1')` 遵循 WHATWG 映射到 windows-1252，与邮件客户端对 `€` 和弯引号的显示一致。

## 测试

`packages/faberloom/inbound/tests/imap-body.spec.ts` 新增一个 `iso-8859-1` 正文（`Buen día`）和一个 `windows-1252` 的 `€`，并保留既有的 UTF-8 与 quoted-printable 用例。
