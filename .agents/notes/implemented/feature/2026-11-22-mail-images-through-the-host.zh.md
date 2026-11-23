# Agent Note：邮件图片经由 Host 加载

Status: implemented

[English](2026-11-22-mail-images-through-the-host.md) | 中文

## 问题

Correo 把发件人的 HTML 绘制在沙箱框架里，其策略只允许 `data:` 图片，清理器会删除其他所有 `src`。这阻止了追踪像素，但也让商业邮件里的每张真实图片都无法显示：Macys、Facebook 与 OneDrive 的简报到达 owner 时只剩下空框。owner 要求所有图片都能加载。

## 决定

### Host 负责抓取，框架负责内联

`emailImage(source)` 是一次 Remote 读取：它接受绝对 `http` 或 `https` 地址，以 8 秒上限和 `image/*` 接受头抓取，拒绝声明类型不是图片的响应，拒绝空正文或超过 4 MB 的内容，并返回声明的媒体类型与 base64 字节。框架保持自己的策略——`img-src data:`——从不获得网络访问权。

### 浏览器从不请求发件人

`emailRemoteImages(html)` 按顺序列出正文引用的每个绝对地址，每条消息最多 30 个。面板通过 `emailImage` 抓取尚未缓存的地址，在本次会话中按地址缓存字节，`resolveEmailImages` 在 `sanitizeEmailHtml` 运行之前把它们写成 `data:` URL 注入文档。每个地址在抓取完成时立即发布，因此邮件会逐张绘制，而不是等待最慢的一张。再次打开同一封邮件会立即从缓存绘制；抓取失败的地址保留替代文本，且不留下任何远程来源。

### Host 拒绝自己的网络

发件人控制的地址是服务端抓取的非受信输入，因此 Host 在请求之前、以及在重定向落地之后，都会拒绝回环、链路本地或私有 IPv4/IPv6 主机，以及 `localhost` 与 `.internal`。只接受 `http` 与 `https`，因此 `file:`、`ftp:` 与 `data:` 永远不会到达抓取器。

## 备选方案

**在框架策略中允许远程图片。** 不采用：框架会把 owner 的 IP 和已读回执交给发件人的服务器，邮件还可能探测部署内部网络。

**用公开路由而不是 Remote 读取来代理图片。** 本切片不采用：那会新增一个带自身鉴权、缓存与限流策略的 HTTP 接口。Remote 已携带 owner 身份，面板也已与它通信。

**继续阻止图片，让 owner 去原客户端打开邮件。** 不采用：这正是 owner 报告为损坏的体验。

## 后果

正文中的每张远程图片现在都会加载，代价是每个唯一地址一次 Host 抓取；缓存限制重复，上限限制单封邮件。加载会把部署的地址暴露给发件人的图床，这是 owner 要求的取舍；远程追踪像素也会因此触发。内联 `cid:` 附件沿用既有路径，并在本步骤之前解析。MCP 邮件仍不显示附件，因为 `messages_attachment` 仍不在范围内。

## 测试

`corepack pnpm run typecheck` 通过；聚焦 Vitest 覆盖 `packages/faberloom/view`、`packages/client/ui-faberloom`、`packages/faberloom/mcp-registry`、`packages/faberloom/connections` 与 `packages/mcp/mcp-client`，71 个文件共 822 个测试通过。新增覆盖：Host 返回媒体类型与字节，拒绝非 URL、非 http 协议、私有与回环主机、非图片类型、空正文，并在 404 时报错而不是绘制错误页；解析器按地址去重并内联已抓取字节，同时排除无法解析的图片；面板为发件人地址调用 `emailImage`，框架绘制 `data:` URL，而脚本、表单与远程地址都不存在。
