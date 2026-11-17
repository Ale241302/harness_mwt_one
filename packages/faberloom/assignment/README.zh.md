---
description: "分配规则（ctx.faberloomAssignment）：精确条件、来源、版本、冲突报告与持久撤销，用于 FaberLoom 的工作分配，不操作任何邮箱或空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-assignment

[English](README.md) | 中文

## 摘要

分配服务决定一个条目归到哪里。规则读取一个条目字段（`from`、`subject`、`account`、`company`），用一个精确操作符（`equals`、`contains`、`startsWith`），并指定空间、智能体或两者。`evaluate` 返回决定、所有匹配的规则以及冲突：两条活动规则指向不同目标时返回 `conflict` 且不给目标，因此任何一方都不会悄悄扩大范围。服务从不移动邮件、不读取邮箱，也不授予空间访问权；消费者在自己的权限下执行决定。

规则携带来源（谁写的、何时、来自哪个条目）、每次编辑都会改变的版本，以及永久的 `revokedAt`。被撤销的规则仍会列出但不再匹配；被撤销的规则不能编辑，历史不会被意外复活。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在存在 `ctx.storageDomain` 的位置挂载本行。服务仅在后端：编写界面与可见标签由 O5-02B/C 提供，规则通过存储域持久化。

```ts
const rule = await ctx.faberloomAssignment.createRule(ownerId, {
  criterion: { field: 'from', operator: 'contains', value: 'eguisa' },
  target: { spaceId: 'sp-eguisa', agentId: null },
})
const decision = await ctx.faberloomAssignment.evaluate(ownerId, { from: 'compras@eguisa.example' })
// { status: 'assigned', target: { spaceId: 'sp-eguisa', agentId: null }, matches: [...], conflicts: [] }
```

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到什么

没有直接内容。服务不注册工具，也不写入提示词。

#### Token 影响

零直接 token。

#### KV 缓存影响

与实时请求无关。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **还没有编写界面。** `faberloom-assignment` 行已把服务挂载进产品组合，O5-02C 加入带可见规则与 `asignado por regla` 标签的分配手势。
- **条件是单字段、纯文本。** 复合条件、数值区间与邮件正文延后；规则从不检查附件或正文。
- **决定是建议性的。** 这里不强制执行目标；执行属于拥有该条目的消费者。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作背景 — 点击展开</summary>

比较会折叠大小写并裁剪条件值，因此大小写不同的发件人行仍可匹配。缺失字段永不匹配。`evaluate` 只读：它不写任何东西，测试固定了连续两次评估不会改变版本与撤销状态。

</details>

**运行时不变式：** 不发布 companion。每次读取都在调用时从存储域解析所有者的规则，并按创建时间排序。
