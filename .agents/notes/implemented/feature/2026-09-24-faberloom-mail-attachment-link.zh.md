# Agent Note: 邮件附件以文件或存储链接的形式送达用户

Status: implemented

[English](2026-09-24-faberloom-mail-attachment-link.md) | 中文

## Problem

智能体可以读取邮箱邮件并把附件保存为工作区里的真实文件，但聊天无法承载二进制：工具结果的词汇里没有下载卡片，而 harness 的 attachments 是给模型输入的图片。要把用户订购的原始文档交给用户，就必须给出链接，而生成链接意味着以登录用户身份把字节上传到 MWT.ONE 存储——但 dsh 此前没有可用来认证这次上传的按用户区分的控制台身份。

## Decision

网关保存每个用户的控制台令牌并按用户注入 dsh；一个配套工具通过控制台自身的存储 API 上传附件。

- 登录时网关把控制台的 `access`/`refresh` 存入 `gateway-users.json`（原子写入、`chmod 600`），并在后续写入未携带令牌时保留既有令牌。`refreshConsolaAccess` 在 access 距过期不足十分钟时经 `POST /api/auth/refresh/` 刷新并重新持久化；刷新失败则保留原令牌。
- `startInstance` 把 `CONSOLA_API_BASE` 与 `CONSOLA_TOKEN`（当前 access）注入该用户的 dsh——绝不用共享的 `MWT_MCP_TOKEN` 服务凭据，使作者身份与权限始终属于用户本人。
- `faberloom_mail_attachment_link(uid, name?, scope?)` 通过 `faberloomInbound.readEmail` 读取邮件，用 `POST ${CONSOLA_API_BASE}/storage/upload-proxy/`（`multipart`：`file`、`filename`、`scope`，默认 `correo`）在 `Authorization: Bearer ${CONSOLA_TOKEN}` 下上传所选附件，并返回 `${CONSOLA_API_BASE}/storage/download/?key=<key>&token=<access>`。缺少令牌或上传失败时抛错，智能体因此回退到工作区文件。
- `faberloom_mail_attachment` 仍把原始字节写入会话工作区下的 `correo-adjuntos/`；工作区的邮件规则要求智能体使用文件或链接，绝不重建文档。

## Alternatives considered

**用共享的 `MWT_MCP_TOKEN` 上传。** 一份长期有效的服务凭据供所有用户使用；它抹掉按用户的作者身份，并让 harness 获得超出用户本人的权限，而按用户身份正是要避免这一点。

**让 harness 直连 MinIO。** 这会把存储凭据放进 harness，并重新实现 `upload-proxy` 与 `download` 已拥有的键作用域与公私可见规则。

**在浏览器端上传（JWT 本就在那里）。** 客户端持有用户令牌，但交付物的目标是让智能体把文件交出来；仅前端上传无法让模型回答“把 PDF 给我”，并且要为每条流程加按钮而不是加一个工具。

## Consequences

- 用户的控制台 JWT 现在按用户存放在 `gateway-users.json`（`0600`）；轮换 `DJANGO_SECRET_KEY` 会使刷新令牌失效并强制重新登录。
- 刷新是尽力而为：失败时无法生成链接，智能体回退到工作区文件，这正是保留两条交付路径的原因。
- 已存令牌只有在本变更后登录过才存在，因此尚未再次登录的用户在此之前拿不到链接。
- 该工具尚无单元测试（转换器有）；上传路径仅由部署构建验证，这是待补的覆盖率缺口。

## Testing

`packages/faberloom/inbound/tests/documents.spec.ts` 覆盖同一邮件所喂入的附件转换。链接工具的上传路径尚无自动化测试；已针对部署的控制台存储做过手工验证。
