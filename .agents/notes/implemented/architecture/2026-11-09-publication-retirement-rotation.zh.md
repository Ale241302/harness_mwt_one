# Agent Note: Retirement and trust rotation survive a storage restore

Status: implemented

[English](2026-11-09-publication-retirement-rotation.md) | 中文

## Problem

发布行是激活状态的唯一记录。恢复旧行的备份可能让已退役修订重新可读，恢复对象存储也可能提供部署已退役密钥签名的字节。服务用单一公钥验证每个清单，且从不检查发布者身份。并发发布与不兼容清单版本没有被覆盖。

## Decision

**退役是追加式账本。** `retire(revision, reason)` 写入 `faberloom_publication.revocations` 并将行移至 `retired`。`read` 在行状态之前、返回字节之前检查账本；即使恢复行写着 `activated`，`status` 与 `receipt` 也报告 `retired`。已退役修订以 `PUBLICATION_RETIRED` 拒绝，包括其批准的重复调用。恢复旧发布行不能重新激活它。

**信任是显式密钥与发布者策略。** `verificationKeys` 把每个接受的 key id 映射到公钥、状态与退役时刻。`rotateSigningKey(signingKeyPem, keyId, retiredAt)` 让新密钥成为唯一活动签名者，并在该时刻退役旧密钥；退役写入持久 `key_retirements` 表，并记录 SPKI DER 的 SHA-256，因此同一材料不能在重启后以另一个 id 返回。`retiredAt` 之前产生的清单仍可验证；之后签名的清单以 `PUBLICATION_KEY_RETIRED` 拒绝。未知 key id 为 `PUBLICATION_KEY_UNKNOWN`。`trustedPublishers` 列出清单可命名的发布者身份；为空时只信任配置的 `publisherId`。不匹配为 `PUBLICATION_PUBLISHER_UNTRUSTED`。

**恢复不是重新激活。** 读取路径每次调用都重新校验对象摘要、清单摘要、策略所选密钥下的签名以及发布者信任。没有签名清单的发布行以 `PUBLICATION_INCOMPLETE` 拒绝，而不是被提供；行被恢复到另一个 commit 下也会被拒绝，因为行必须命名请求的 commit。测试对象存储在丢失后恢复会让有效修订重新可读；它不会让已退役修订或密钥已退役修订可读。`formatVersion` 高于软件支持的清单以 `PUBLICATION_MANIFEST_INVALID` 拒绝，而不是被提供。

**并发发布共享一条链。** 服务在同一进程内串行化发布链；同一批准的两个并发调用返回相同 commit 与相同 `activatedAt`，每个存储键只写一次。重启从持久行恢复，不重复 commit 或激活。

## Alternatives considered

**只在发布行保存退役。** 恢复旧行会复活修订。独立账本正是关键。

**退役时删除对象。** Object-lock COMPLIANCE 保留拒绝删除，删除也会破坏审计轨迹。退役改变授权，不改变存储。

**用唯一当前公钥验证所有清单。** 轮换会让所有旧行不可读，已退役密钥仍可签新行。密钥映射携带显式策略。

**信任清单里写的任意 `publisherId`。** 清单已签名，但签名者仍必须是授权发布者。受信发布者集合独立于存储凭据。

## Consequences

已退役修订会一直被拒绝，直到追加式账本本身从包含撤销的快照恢复；只恢复发布行不够。密钥轮换保留退役时刻之前的历史读取，并拒绝旧密钥之后的签名。不在受信集合中的发布者不能发布，也不能被提供。更新的清单格式被拒绝，因此部署必须发布兼容读取器或保持当前版本，而不是降级已存储格式。

## Verification

- `packages/faberloom/publication/tests/lifecycle.spec.ts`：退役与行恢复拒绝；移除修订索引后账本仍拒绝；测试存储丢失与恢复；退役前后的密钥轮换；相同密钥材料拒绝；密钥退役持久化；不受信发布者；并发发布；旧式无清单行拒绝；交叉索引拒绝；不兼容清单格式。
- `packages/faberloom/publication/tests/publication.spec.ts`：PUB-01/PUB-03/PUB-04/PUB-05 的恢复、篡改、保留与源中断证据仍在。
- `packages/faberloom/publication/tests/application.spec.ts`：PUB-07 的跨路径与并发证据仍在。
- `packages/faberloom/mcp-server/tests/oauth.spec.ts`：VER-02 rollback 重新校验引用并拒绝已撤销源。
