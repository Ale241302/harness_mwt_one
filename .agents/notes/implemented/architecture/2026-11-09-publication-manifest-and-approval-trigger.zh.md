# Agent Note: A published revision carries a signed manifest and follows the approval

Status: implemented

[English](2026-11-09-publication-manifest-and-approval-trigger.md) | 中文

## Problem

3A.3 已打通 Git 提交、对象上传、摘要校验与单次激活，但修订只靠旁边保存的 SHA-256 认证。没有任何东西证明发布者是谁，批准后仍需单独调用 MCP，源故障没有持久的等待状态或经过测试的恢复。存储凭据与发布者身份是同一个值，保留声明只存在于文字中。

## Decision

**每个修订携带规范清单与分离签名。** 清单记录条目、基础修订、提交、路径、摘要、字节长度、产物哈希、发布者 id 与生成时间。规范 JSON 对键排序；清单摘要排除 `digest`，分离 Ed25519 签名覆盖包含摘要的规范清单。公钥是外部信任锚，绝不存入对象。清单位于 `publications/<commit>/.faberloom/manifest.json`；内容仍在 `publications/<commit>/<path>`。

**发布者身份与存储凭据分离。** `publisherId`、`keyId` 与签名密钥标识并认证发布者；`accessKey` 与 `secretKey` 只授权对象存储。清单记录发布者 id 与 key id，因此回执能指出谁发布了修订，而不暴露存储凭据。

**上传在构造和检查上都是不可变的。** 内容对象只写一次；同一 key 的不同字节以 `PUBLICATION_OBJECT_CONFLICT` 拒绝。S3 适配器还发送 `IfNoneMatch: '*'`，即使版本化允许第二个版本，已存在的 key 也不会被替换。`retentionDays` 写入 object-lock COMPLIANCE 请求；适配器没有删除操作。激活与每次读取都会加载清单、重算摘要、与行记录比较并验证签名，然后才信任内容。

**源故障是持久等待，不是丢失批准。** 提交先于任何上传记录。存储拒绝读或写时，行变为 `failed` 并保留存储拒绝原因、提交与批准；下一次 `publish` 从最后持久事实恢复。重试上传缺失的对象与清单、验证二者并只激活一次；不会产生第二个提交、对象或激活。

**批准触发发布。** `boardApprove` 与 `boardApproveWithEdits` 先调用 `apply`，存储就绪时再用持久条目的路径、diff、基础修订、产物哈希、原因与证据调用 `publish`。发布拒绝会记录并保留批准；MCP 发布器仍是显式重试路径。直接 `publish` 仍可用于重放。

## Alternatives considered

**只签持久行。** 行不是读者下载的对象；读者没有可验证的清单。签署规范清单并与内容一起存储，才能把字节绑定到修订。

**把清单嵌进内容文件。** 这会改变已发布字节和读者消费的文档。独立不可变对象让内容保持精确，认证文档可检查。

**把公钥存进清单。** 产物会用它自带的密钥认证自己。公钥属于消费者信任库；清单只携带 key id。

**把存储凭据当发布者身份。** 凭据授权写入，不表示作者；轮换还会改变身份。签名密钥与发布者 id 是独立值。

**只依赖 bucket 版本化。** 版本化保留旧版本，但不能阻止同一 key 的新版本，也不能在删除后保留版本。COMPLIANCE object lock 加 `IfNoneMatch` 与服务的摘要检查覆盖真正的不变量。

**保持批准与发布分离。** 操作者批准后必须手动调用 MCP 发布器。从同一批准调用 `publish` 关闭缺口；显式工具保留用于重试和无法挂载存储的部署。

## Consequences

一个修订现在有两个不可变对象：内容与清单。清单摘要与 key id 进入回执，读者可用信任锚离线验证作者。源故障留下带原因的 `failed` 行与可恢复提交；重试收敛且不重复。代价是每个发布部署都需要签名密钥与发布者 id、两次对象写入，以及必须保留的清单 key。真实证据运行使用带 object lock 的 MinIO 容器：发布者身份删除被 `AccessDenied` 拒绝，覆盖被 `PreconditionFailed` 拒绝；记录在 `docs/faberloom/evidence/3a3-minio-publication.json`。

## Verification

- `packages/faberloom/publication/tests/publication.spec.ts`：应用、上传、清单、签名、激活；重放；崩溃恢复；清单篡改与错误签名；源关闭产生 `failed` 行并恢复；对象摘要篡改；外部 key 冲突；发布者删除/覆盖拒绝；过期基线；超大内容；半配置凭据。
- `packages/faberloom/publication/tests/s3-store.spec.ts`：不可变 key、COMPLIANCE 保留、`IfNoneMatch`、缺失对象、字节上限、不含凭据的拒绝。
- `docs/faberloom/evidence/3a3-minio-publication.json`：带 bucket object lock 的真实 MinIO 运行、签名清单摘要、已验证读取、删除与覆盖被拒。
- `packages/faberloom/view/tests/approvals.spec.ts`：批准先调用 `apply`，再调用 `publish`；发布拒绝保留批准。
