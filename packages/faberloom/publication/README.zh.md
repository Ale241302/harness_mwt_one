---
description: "原生发布模块（ctx.faberloomPublication）：把一个已批准的 diff 应用到 Git，将提交后的字节存到不可变的 MinIO key，并只激活一次修订。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-publication

[English](README.md) | 中文

## 概述

本包把一个已批准的变更从 diff 带到可读取的修订。它注册 `ctx.faberloomPublication`，将 diff 应用到配置的 Git 工作树，以确定性的提交信息提交，把提交后的字节上传到不可变的 `publications/<commit>/<path>` key，校验已存储对象，并通过条件式持久更新激活修订。持久状态位于 `faberloom_publication` 存储域：每个 `(itemId, revision, artifactHash)` 一行，每个提交一行索引，因此重放或崩溃会从最后记录的事实继续，而不会产生第二个提交、对象或激活。

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
```

凭据来自部署（`accessKey` 与 `secretKey`，或 SDK 的默认提供链）。它们不会被记录、返回或写入持久状态。

<a id="service-contract"></a>
## 服务契约

- `publish(request)` — 应用、提交、上传并激活一个已批准的 diff。按 `(itemId, revision, artifactHash)` 幂等：重放返回同一回执；同一身份携带不同 diff 会以 `PUBLICATION_REQUEST_CONFLICT` 拒绝。
- `read(revision, path)` — 按提交读取已发布文件，并对照持久记录校验长度与 SHA-256。未激活的修订以 `PUBLICATION_NOT_ACTIVE` 拒绝；修订绝不会被重新解析到更新的提交。
- `status(revision)` — 持久阶段：`pending`、`committed`、`uploaded`、`activated` 或 `failed`。
- `receipt(revision)` — 基础修订、提交、对象 key、摘要、字节长度、状态与 `activatedAt`。
- `readiness()` — 部署是否完整，以及缺少哪项配置。
- `useObjectStore(store)` — 挂载另一个 `PublicationObjectStore`；生产使用由配置构建的 S3/MinIO 适配器。

请求的 `revision` 是审查该变更时对照的提交，绝不是分支。应用 diff 时它必须仍是 `HEAD`，因此过期批准会以 `PUBLICATION_BASE_STALE` 拒绝且工作树保持不变。仓库、endpoint 与 bucket 是部署值：任一缺失时服务记录警告，所有操作以 `PUBLICATION_UNAVAILABLE` 拒绝，而不会回退到本地存储。

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

- **每次发布一个文件。** 发布只存储其 diff 触及的一个路径；`read` 对该修订的其它路径以 `PUBLICATION_PATH_INVALID` 拒绝。多文件工件需要后续切片按修订记录清单。
- **已有 MCP 接线；批准不会自动发布。** `faberloom_publication_read` 优先使用本服务，`faberloom_publication_publish` 对已批准条目调用它，但看板批准本身不会启动发布；由消费者调用工具。把批准事件接上属于后续切片。
- **没有撤销操作。** 状态只有 `activated` 或不是；撤销已激活修订并拒绝后续读取属于拥有工作引用的消费者。
- **单进程 Git 串行化。** 发布 effect 链在单个服务实例内排队。两个进程共享一个工作树时依赖 Git 自己的 index lock 拒绝第二次应用。
- **Object lock 是 bucket 属性。** `retentionDays` 写入 object-lock 请求；未启用 object lock 的 bucket 会拒绝写入，适配器以 `PUBLICATION_STORE_UNAVAILABLE` 呈现。

未发布 invariant 伴随包，因为该服务没有单元测试之外的独立观察。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

效果链为 `pending` → Git apply/commit → `committed` → 对象上传 → `uploaded` → 条件激活 → `activated`。持久行在进入下一个效果前记录提交与对象 key，因此重试会继续而不是重复。Git 没有 compare-and-set；服务内的 promise 链保证同一时间只有一个发布操作工作树。

</details>
