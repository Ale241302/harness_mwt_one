---
kind: upgrade-guide
description: "faberloom_mail_attachment_link 返回存储键，而不是包含控制台凭据的 URL。"
---

# `faberloom_mail_attachment_link` 不再返回带凭据的 URL

[English](guide.md) | 中文

## 变更

该工具以前返回 `{ url, key, name }`，其中 `url` 把 `CONSOLA_TOKEN` 作为查询参数嵌入。这会让有效凭据进入模型可见的工具结果和持久 Session 日志。现在只返回 `{ key, name }`。渲染文本给出存储键，并提示 owner 从控制台存储下载文件。

上传行为不变：仍以登录 owner 身份把附件字节发送到已配置的控制台存储。

## 迁移

1. 把所有读取 `result.url` 的消费者改为读取 `result.key` 与 `result.name`。
2. 在控制台或服务端认证路由内部构建下载导航。不要在客户端重建旧的 `/storage/download/?key=...&token=...` URL。
3. 如果集成需要直接 URL，由控制台签发短期下载授权；绝不要把 `CONSOLA_TOKEN` 放进模型输出、Session 日志、浏览器 URL 或文档。
4. 确认工具 schema 只包含 `key` 与 `name`，并确认 canary `CONSOLA_TOKEN` 不出现在规范结果或渲染后的工具文本中。
