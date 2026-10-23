# Agent Note: Remote web pages read and write the Host settings document

Status: implemented

[English](2026-10-23-host-settings-on-remote-pages.md) | 中文

## 问题

`harness.mwt.one` 上的 Models 设置页报出“No se pudo cargar el directorio de proveedores: settings are unavailable in this browser”。只要 `remote.$host.isLoopback` 为 false，Client 就让设置镜像进入进程内模式，因此远程源提供的页面从不调用 `settings.describe`，所有提供方行都保持不可用。负责人可以在桌面应用里填写 OpenAI、Anthropic、Google、Moonshot 或 Kimi 的密钥，却无法在 web 应用里填写，尽管两者运行同一套 UI 和同一套 Host 组合。

部署本身已经认证浏览器会话，为每个用户运行一个拥有独立 `DSH_HOME` 的 `dsh`，并对已登录用户返回 `writable: true` 的 `settings.describe`。因此 loopback 分类拦下的是一个正常工作的、按用户隔离的传输，而不是保护了什么：它拒绝读取的设置文档属于同一个身份，而该身份已经拥有 Session、Workspace 和 shell。

## 决策

**设置是否可用由 Host 的应答决定，而不是页面来源。** `ui-settings` 构建唯一的 describe 镜像时不再携带持久化模式。每个页面都调用 `settings.describe`，并从应答派生各命名空间 scope；镜像的终态 `unavailable` 与 scope 快照的 `mode` 字段被删除。未挂载设置提供方的 Host 会返回类型化失败，各界面渲染自己的不可用或错误状态，而不是静默保留默认值。

**只有原生文档打开动作仍限 loopback。** `ui-settings-general` 在非 loopback 页面仍不提供“打开设置文件”动作，因为它要执行 Host 桌面命令。读写文档本身不需要桌面。

**提供方凭据走同一份持久化的用户文档。** Models 页面列出每个已声明的可配置提供方（产品 bundle 中的 `DeepSeek`，以及 pi-ai 路由 `openai`、`anthropic`、`google`、`kimi` 和 `moonshotai`），并把输入的密钥存入该用户的凭据存储。密钥引用来自提供方 profile 的 `apiKeyEnv`，或页面派生的 `<ROUTE>_API_KEY`，因此 web 输入的密钥与桌面输入的一样，会在下一次请求中生效。

**授权仍由既有传输层负责。** 设置写入使用与其他 Host API 相同的浏览器会话认证、Host/Origin 检查与字段脱敏。每个用户的 `dsh` 进程在自己的 `DSH_HOME` 下拥有自己的设置文档，所以远程写入只改变该用户的偏好。移除来源检查不会新增任何权限。

## 考虑过的替代方案

**为远程页面增加一条仅服务 Models 的设置传输。** 否决：该页面需要与所有偏好行相同的 describe/mutate/凭据读取，第二个读取方会复制镜像，并让两个界面就文档 revision 产生分歧。

**先探测 Host，再保留进程内模式作为回退。** 否决：镜像已经报告读取失败并保留最后一个正确视图。再增加一个分类状态没有消费者，还会把真实诊断藏在静默的本地模式之后。

**允许远程读取但只允许 loopback 写入。** 否决：这会让远程用户看到提供方状态却无法添加密钥，正是本次报告的缺陷。已认证用户本来就通过同一页面运行命令并编辑自己的文件。

## 后果

已登录的 web 用户可以在“设置 → Models”中添加或替换 DeepSeek、OpenAI、Anthropic、Google、Moonshot 与 Kimi 的 API 密钥，下一次请求即使用它们。外观、语言、busy-Enter 与权限预设也在远程页面由 Host 支撑，因此会跨浏览器和来源跟随用户，而不是刷新即重置。web 与桌面现在按用户读取同一份设置文档。

远程设置写入可以改变 Host 暴露的任何命名空间，包括权限默认值与 MCP 服务器配置。这与桌面应用对同一身份提供的权限相同；服务不受信浏览器的部署必须在 Connection 层强制认证，随产品发布的 web profile 正是如此。

未挂载设置提供方的自定义组合现在会在每个页面报告读取失败，而不是让偏好留在进程内。随产品发布的 web 与桌面 profile 都挂载文件提供方。

## 测试

`packages/client/ui-settings/tests/settings-mirror.client.spec.ts` 与 `settings-scope.client.spec.ts` 覆盖由 Host 应答的镜像、scope 派生、写入围栏与恢复。`packages/client/ui-settings-models/tests/` 覆盖提供方连接、密钥引用与缺失文档诊断。`packages/client/ui-settings-general/tests/apply.client.spec.ts` 固定非 loopback 页面仍不提供原生文档动作、但会读取 Host locale。`packages/client/ui-permission-presets/tests/` 覆盖同一镜像之上的权限行。
