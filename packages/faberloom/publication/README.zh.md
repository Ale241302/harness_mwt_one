---
description: "原生发布模块（ctx.faberloomPublication）：把一个已批准的 diff 应用到 Git，将提交后的字节存到不可变的 MinIO key，并只激活一次修订。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-publication

[English](README.md) | 中文

## 概述

本包通过 `ctx.faberloomPublication` 把一个已批准的变更从 diff 带到可读取且可认证的修订。`apply` 在跨进程锁内只提交服务端清单内的 diff。`publish` 把已提交文件与规范清单上传到不可变的 `publications/<commit>/` key，并条件式激活修订。清单摘要排除自身；分离 Ed25519 签名与发布者 id 独立于存储凭据认证清单。持久 `applications` 与 `publications` 行让重放、源故障或崩溃恢复时不产生第二个提交、对象或激活。

## 目录

- [使用本包](#use-this-package)
- [服务契约](#service-contract)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把该行与部署的仓库和对象存储一起挂载。服务是调用插件 fiber 上的 effect，销毁该 fiber 会移除服务。

```yaml
- id: publication
  plugin: '@deepseek-ai/dsh-faberloom-publication'
  config:
    repo: /srv/faberloom/knowledge
    endpoint: http://minio.internal:9000
    bucket: faberloom-publications
    region: us-east-1
    retentionDays: 30
    maxBytes: 1048576
    inventory:
      - knowledge/a.md
      - knowledge/b.md
    publisherId: publisher:faberloom
    signingKeyPem: ${FABERLOOM_PUBLICATION_SIGNING_KEY}
    keyId: faberloom-2026-11
```

凭据来自部署（`accessKey` 与 `secretKey`，或 SDK 的默认提供链）。它们不会被记录、返回或写入持久状态。签名密钥认证发布者身份，并与存储凭据分离。清单是目的地的服务端权威：空清单会以 `PUBLICATION_INVENTORY` 拒绝所有应用。

<a id="service-contract"></a>
## 服务契约

- `apply(approval)` — 只提交已批准 diff。每个 diff 路径都按清单解析；重命名、复制、模式与二进制区段以 `PUBLICATION_PATCH_INVALID` 拒绝，因为它们没有 `---`/`+++` 头。写入前在 `.git/faberloom-apply.lock` 内立刻复核基线、真实路径、符号链接、工作树与字节上限；应用后索引路径必须恰好等于清单路径，每个真实目的地必须仍在工作树内，硬链接会被拒绝。按 `(itemId, revision, artifactHash)` 加精确 diff 摘要幂等：重放返回同一回执，同一身份下 diff 变化以 `PUBLICATION_REQUEST_CONFLICT` 拒绝，已存在的提交按身份协调。基线、清单、路径、符号链接、工作树、锁、补丁或畸形区段拒绝记录为 `conflict`，其它失败记录为 `failed`。
- `application(itemId)` — 某个看板条目最近一次持久应用回执。
- `applicationReadiness()` — 是否配置了仓库；应用不需要对象存储。
- `publish(request)` — 应用、提交、上传文件及其签名清单、验证二者并激活一个已批准的 diff。按 `(itemId, revision, artifactHash)` 幂等：重放返回同一回执；同一身份携带不同 diff 会以 `PUBLICATION_REQUEST_CONFLICT` 拒绝。源故障时提交保持持久，记录 `failed` 与拒绝原因，重试从上传继续，不产生第二个提交。
- `read(revision, path)` — 按提交读取已发布文件，并对照持久记录校验长度与 SHA-256，然后加载清单、重算摘要并验证签名。未激活的修订以 `PUBLICATION_NOT_ACTIVE` 拒绝；修订绝不会被重新解析到更新的提交。
- `status(revision)` — 持久阶段：`pending`、`committed`、`uploaded`、`activated` 或 `failed`。
- `receipt(revision)` — 身份、基础修订、提交、对象与清单 key、摘要、字节长度、清单、签名、状态、`activatedAt` 与最近失败。
- `readiness()` — 部署是否完整，以及缺少哪项配置。
- `useObjectStore(store)` — 挂载另一个 `PublicationObjectStore`；生产使用由配置构建的 S3/MinIO 适配器。

请求的 `revision` 是审查该变更时对照的提交，绝不是分支。应用 diff 时它必须仍是 `HEAD`，因此过期批准会以 `PUBLICATION_BASE_STALE` 拒绝且工作树保持不变。另一个进程持有应用锁时以 `PUBLICATION_LOCKED` 拒绝。仓库、endpoint、bucket、发布者 id、签名密钥与 key id 是部署值：任一缺失时服务记录警告，相应操作以 `PUBLICATION_UNAVAILABLE` 拒绝，而不会回退到本地存储。

### 清单与真实性

清单 key 为 `publications/<commit>/.faberloom/manifest.json`。规范 JSON 对键排序；摘要覆盖去掉 `digest` 的清单，分离 Ed25519 签名覆盖包含摘要的规范清单。清单或签名被改动时以 `PUBLICATION_MANIFEST_INVALID` 或 `PUBLICATION_SIGNATURE_INVALID` 拒绝。公钥是外部提供的信任锚，绝不存入对象。

<a id="configuration"></a>
## 配置

| 字段 | 含义 |
|---|---|
| `repo` | 应用 diff 的本地 Git 工作树。 |
| `endpoint` | S3/MinIO endpoint 源。 |
| `bucket` | 保存发布对象的 bucket；需要 object lock 才能保留。 |
| `accessKey`、`secretKey` | 静态凭据；两者同时提供或都不提供。缺省使用 SDK 提供链。 |
| `region` | 签名区域。 |
| `retentionDays` | Object-lock COMPLIANCE 保留期；`0` 表示不启用 object lock。 |
| `maxBytes` | 最大发布对象，提交前与每次读取时强制执行。 |
| `inventory` | 应用可触及的仓库相对路径；为空时拒绝所有应用。 |
| `publisherId` | 写入签名清单的发布者身份，不同于存储凭据。 |
| `signingKeyPem` | 仅用于签名清单的 PKCS#8 Ed25519 私钥；不记录、不写入。 |
| `keyId` | 写在签名旁的信任锚 key id。 |
| `publicKeyPem` | 验证用 SPKI 公钥；缺省时从签名密钥派生。 |

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到什么

没有。`ctx.faberloomPublication` 是 host 侧服务：它不注册工具、不注入提示文本、不写会话事件。对话可读取的修订由其授权工作引用固定；提供该引用的消费者拥有模型可见结果。

#### Token 影响

每次请求零直接 token。

#### KV 缓存影响

与实时请求无关：注册不会触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **`publish` 每次修订存储一个文件。** `apply` 接受多文件 diff，但 `publish` 只上传请求中的单个路径，`read` 对该修订的其它路径以 `PUBLICATION_PATH_INVALID` 拒绝。多文件发布需要按修订记录清单。
- **批准会触发应用与发布；MCP 发布器仍可显式重试。** 知识提案批准后，视图先调用 `apply`，发布存储就绪时再调用 `publish`。MCP 工具仍用于对已批准条目显式重试。
- **没有撤销操作。** 状态只有 `activated` 或不是；撤销已激活修订并拒绝后续读取属于拥有工作引用的消费者。
- **应用锁跨进程；发布链仍在服务实例内。** 应用器持有 `.git/faberloom-apply.lock`，活跃持有者以 `PUBLICATION_LOCKED` 拒绝。发布效果链仍在单个服务实例内排队。
- **Object lock 是 bucket 属性。** `retentionDays` 写入 object-lock COMPLIANCE 请求；未启用 object lock 的 bucket 会拒绝写入，适配器以 `PUBLICATION_STORE_UNAVAILABLE` 呈现。发布者身份不会删除或覆盖受保护对象：服务不暴露删除，并拒绝同一 key 下的不同对象。
- **竞态插入的联接会造成瞬时写入。** 应用器在应用后复查每个真实路径并反向撤销自己的补丁，但本地写入者若在预检与 `git apply` 之间把父目录换成联接，Git 可能先写到工作树外。应用器会检测并撤销该写入；零写入保证覆盖应用器能够裁决的每次拒绝。这不是权限边界：该行为者已经需要工作树的写权限。

未发布 invariant 伴随包，因为该服务没有单元测试之外的独立观察。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

应用链为 `pending` → 清单、符号链接、基线与干净工作树检查 → `git apply --index` → 提交 → `applied`；基线、清单、路径、符号链接、工作树、锁或补丁拒绝变为 `conflict`，在确定性提交信息下找到的提交则被复用。发布链为 `pending` → Git 应用/提交（经同一应用器）→ `committed` → 内容上传 + 清单上传 → `uploaded` → 内容、清单与签名验证 → 条件激活 → `activated`。持久行在进入下一个效果前记录提交、对象 key、清单 key、摘要与签名，因此重试会继续而不是重复。Git 没有 compare-and-set；跨进程锁串行化应用器，服务内的 promise 链保证同一时间只有一个发布操作工作树。

</details>
