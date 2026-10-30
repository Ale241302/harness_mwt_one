---
description: "本 DeepSeek Harness 构建中的原生产品模块（ctx.faberloomAccess）：选择性自主授权，以及受保护操作类型所需的 CEO 签名。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-access

[English](README.md) | 中文

## 概述

此包承载选择性自主与 CEO 签名。它注册 `ctx.faberloomAccess` 主机服务：授权针对一位所有者、一个智能体和一个上下文放行一项操作，签名则在审批之前放行某租户的受保护操作类型——资金、库存与外部发运。

## 目录

- [使用此包](#use-this-package)
- [配置](#configuration)
- [CEO 签名](#ceo-signatures)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在组合中挂载此行即可暴露 `ctx.faberloomAccess`。该服务是调用插件 fiber 上的副作用，释放该 fiber 即移除。

`grant` 与 `check` 负责选择性自主：`check` 在效果执行前给出答案，`revokeGrant` 让下一次检查拒绝。`issueSignature`、`requireSignature`、`signatureStatus` 与 `revokeSignature` 负责 §7.4：受保护集合中的操作类型没有默认值，缺少有效签名时审批被拒绝，而不是收到警告。

该服务抛出的每一次拒绝都是 `FaberLoomAccessRefusal`，消息以 `faberloom: <CODE> — ` 开头，因此调用方只需匹配一个错误类和一个前缀，并依据 `code` 分支。授权相关代码为 `GRANT_NOT_FOUND` 与 `GRANT_NOT_OWNER`；签名相关代码为 `SIGNATURE_REQUIRED`、`SIGNATURE_REVOKED`、`SIGNATURE_EXPIRED`、`SIGNATURE_NOT_FOUND`、`SIGNATURE_NOT_PERMITTED`、`SIGNATURE_AUTHORITY_UNCONFIGURED`、`SIGNATURE_SCOPE_REQUIRED`、`SIGNATURE_SCOPE_INVALID`、`SIGNATURE_WILDCARD_DISALLOWED` 与 `SIGNATURE_INVALID_INSTANT`。

-----

<a id="configuration"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `protectedActionTypes` | `[]` | 需要 CEO 签名的操作类型。为空表示不保护任何操作类型，并在加载时记录警告。 |
| `allowWildcardSignatures` | `false` | 一个签名是否可以覆盖全部受保护操作类型。§7.4 按 `action_type` 逐一签名，因此默认拒绝通配。 |
| `signatureValiditySeconds` | `null` | `issueSignature` 未收到 `expiresAt` 时采用的有效窗口。`null` 表示签名持续有效直至被撤销。 |
| `signingAuthorities` | `[]` | 有权签发签名的身份。为空则拒绝签发；它从不让任意已认证主体签名。 |
| `revocationAuthorities` | `[]` | 除签名人之外，有权撤销本租户任意签名的身份。 |
| `signerIdentityAudience` | `[]` | 除签名人之外，有权在 `signatureStatus` 中读取签名人身份的身份。 |

§7.4 将操作类型字符串、有效窗口与撤销权限留空。上述默认值即随包发布的值；审批资金、库存或外部发运的部署需自行声明取值。

-----

<a id="ceo-signatures"></a>
## CEO 签名

签名记录按每次签署存储，并归属单一租户：`tenantId`、`signedBy`、`signedAt`、`active`、`expiresAt`、`actionTypes`、`wildcard`、`revokedBy` 与 `revokedAt`。记录覆盖其列出的操作类型，或在部署允许时覆盖全部受保护操作类型。租户取自操作者的 `companyId`，因此签名只对同租户操作者可见可用：其他租户的签名既不会被列出，也不会被接受。

| 成员 | 返回 |
|---|---|
| `requireSignature(actor, actionType, options?)` | 被接受的签名；操作类型不受保护时返回 `null`。抛出 `SIGNATURE_REQUIRED`、`SIGNATURE_REVOKED` 或 `SIGNATURE_EXPIRED`。 |
| `signatureStatus(actor, actionType, options?)` | `protected`、`state`（`ACTIVE`、`MISSING`、`REVOKED`、`EXPIRED`、`NOT_REQUIRED`）、匹配签名的 id 与时间点，以及仅对有权限的读取者显示的签名人身份。 |
| `issueSignature(actor, input, options?)` | 为操作者所在租户及其身份存储一个签名。 |
| `revokeSignature(actor, id, options?)` | 将签名标记为非活动，并保留 `revokedBy` 与 `revokedAt`。重复撤销保留第一次结果。 |

签名可重复使用：在其到期或被撤销之前，它放行该操作类型的每一次审批。§7.4 未规定单次使用，因此为一次审批使用签名不会削弱其后的审批，一个签名可覆盖同一组审批背后的整个批次。`requireSignature` 读取当前快照；检查之后才落地的撤销不会回溯取消调用方已做出的审批。

到期在每次检查的时间点判定，签名在其自身 `expiresAt` 时刻到期。`active` 只记录撤销。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomAccess` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **并非所有取值都已签署。** §7.4 将操作类型字符串、签名有效窗口、签署与撤销权限、签名人可见范围留空；上文记录的默认值是占位值，部署必须替换。
- **派发时不再复核。** `requireSignature` 在调用方询问的时刻作答。CEO 确认在审批与派发之间是否仍然有效属于规格待定项，因此此包不提供第二次检查。
- **没有签名列表。** 服务通过 `signatureStatus` 一次报告一个操作类型；需要列出某租户全部签名的面板缺少此包尚未提供的读取接口。
- **记录按每次签署存储，而非按操作类型。** 一条记录携带其覆盖的操作类型集合，因此同一租户的同一操作类型可能被两个签名覆盖；检查优先精确覆盖而非通配，其次取最早的签名。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

`signatures` 表加入既有 `faberloom_grants` 域时未提升版本号：该变更属追加式，缺少该表的已存文档打开时为空表，且该后端布局没有重写版本标记的迁移钩子。

</details>
