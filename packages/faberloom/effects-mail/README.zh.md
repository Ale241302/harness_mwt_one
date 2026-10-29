---
description: "Mesa 邮件效果适配器：通过条目所有者自己的 SMTP 连接发送已批准条目，并把 mail.send 注册到看板的效果机。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-effects-mail

[English](README.md) | 中文

## 摘要

看板决定效果何时离开，并按动作类型各注册一个适配器（E15）；它不拥有邮件客户端。本行就是 `mail.send` 的提供者：读取已批准条目，用人类批准的那一版组成一条纯文本消息，并通过 `faberloomConnections` 中所有者自己的 SMTP 连接发送。目的地址是批准时命名的规范化收件人列表。

适配器声明 `idempotent: false`：SMTP 无法去重，因此看板不对未知结果提供重试，只提供对账。连接抛出的错误以 `DESCONOCIDO` 到达看板，绝不会被当成“已发送”（W-22）。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把本行挂在看板与连接服务旁。默认 bundle 已挂载；`FABERLOOM_EFFECT_MAIL=0` 可移除。只有当部署声明了该动作类型时看板才接受它，因此 `FABERLOOM_EFFECT_ACTION_TYPES` 为空时本行不注册任何东西（A-05）。

```yaml
- id: faberloom-effects-mail
  name: '@deepseek-ai/dsh-faberloom-effects-mail'
  config:
    actionType: mail.send
```

只有看板校验过预留、精确执行、条目状态、控制项与受保护动作类型的 CEO 签名之后，效果才会到达适配器。适配器每次派发尝试只发送一次。

消息正文是已批准修订的摘要、证据引用与文档引用；主题是条目标题。不虚构任何内容：没有已批准修订的条目抛出 `NO_APPROVED_REVISION`，效果不会被报告为已发送。

## Model Experience

### 效果派发

#### 模型看到什么

没有。本行不添加提示词、工具或 schema；批准及其效果都是看板已暴露的产品操作。

#### Token 影响

零直接 token。已批准修订与收件人都从看板读取，而不是来自模型。

#### KV Cache 影响

无关：本行从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅纯文本** — 带文档引用的已批准产物只会在正文中写出引用，不会作为附件发送。发送附件需要产品目前还没有的文档渲染器。
- **目的端不去重** — SMTP 不报告幂等键，因此 `idempotent` 为 false，未知结果由操作员对账，绝不自动重试。
- **派发超时不会取消 SMTP** — 看板在配置的超时后停止等待并报告 `DESCONOCIDO`；套接字可能仍会完成，这正是结果未知而非失败的原因。
