# Agent Note: Provider keys sync through an encrypted console vault

Status: implemented

[English](2026-10-23-shared-provider-key-vault.md) | 中文

## 问题

桌面应用与 `harness.mwt.one` 是两套独立的 harness 安装：桌面读写用户 PC 上的 `%USERPROFILE%\.dsh`，而每个 web 用户在 VPS 上拥有自己的 `dsh` 进程与 `/data/users/<id>` 主目录。模型提供方 API 密钥存放在各安装自己的凭据存储里，因此在一边的“设置 → Models”里填写的密钥从不会到达另一边。用户不得不把每个提供方密钥输入两次，而在一侧轮换密钥还会悄悄让另一侧的回合失败。

两边本来就登录同一个 MWT.ONE 控制台账户，gateway 也已经为每个 web `dsh` 提供 `CONSOLA_TOKEN` 与 `CONSOLA_API_BASE`。该账户就是天然的共享身份；缺的是一个共享的、经过认证的提供方密钥存放处。

## 决策

**控制台拥有按账户隔离的加密提供方密钥库。** `core.harness_provider_keys` 保存 `(owner_email, ref, ciphertext, updated_at)`；Django viewset 提供 `GET/POST /api/harness/provider-keys/` 与 `DELETE /api/harness/provider-keys/<ref>/`，只作用于已认证邮箱自己的行，并绕过模块 RBAC，因为它只触碰调用者的数据。值使用 Fernet 加密：优先 `HARNESS_VAULT_KEY`，否则使用由 `DJANGO_SECRET_KEY` 派生的密钥。写入响应只携带引用与时间戳，从不返回值。

**host 插件让两套安装收敛。** `@deepseek-ai/dsh-credentials-console` 注入本地 `credentials` 服务，在启动时与每 60 秒读取密钥库，通过 `credentials.set` 应用远程值，并在每次本地写入时推送。只有以 `_API_KEY` 结尾的引用参与。缺少 console base 或 token 时插件保持惰性，因此没有控制台登录的组合仍可在本地工作。

**首次同步会播种已有的本地密钥。** 插件从 settings 描述符派生可配置的提供方引用（`llm-pi-ai` 提供方的 `apiKeyEnv` 或派生的 `<ROUTE>_API_KEY`，加上 `llm-deepseek.apiKeyEnv`），并发布来源为存储文件的本地值。从环境继承的部署密钥绝不会被当作用户密钥发布。

**推送失败代表一次尚未落地的本地编辑。** 该引用留在 dirty 集合中，后续拉取不会在控制台接受它之前覆盖它。除此之外远程值在拉取时优先；跨设备的后写者胜出。

## 考虑过的替代方案

**让桌面直接连接云端 harness。** 所有者否决：Windows 安装必须保持本地，才能读取用户的文件夹与文件。

**同步整个设置文档。** 否决：提供方密钥是与主题、语言偏好不同的秘密信任边界，密钥库还必须能排除 OAuth grant 与 MCP 令牌。

**把密钥库放进 FaberLoom context 或共享内容。** 否决：那些行对 Space 成员与 context 界面可见。提供方密钥必须只对其账户可读。

**从登录密码派生密钥库密钥。** 否决：两个客户端在登录后都不保留密码，改密还会让已有行无法读取。`HARNESS_VAULT_KEY`（或部署的 `SECRET_KEY`）稳定且已被信任。

## 后果

在桌面保存的密钥会在一个间隔内到达 web（反之亦然），升级后首次同步会发布本地已有的密钥。控制台数据库及其加密密钥成为提供方秘密信任边界的一部分；在没有 `HARNESS_VAULT_KEY` 的情况下轮换 `DJANGO_SECRET_KEY` 会让旧行无法解密，插件会跳过它们，直到该密钥被重新写入。OAuth grant、MCP 令牌与凭据记录仍留在各自安装本地。删除密钥会移除其密钥库行，但不会到达另一安装已保存的副本；该副本会保留，直到它在那边重新保存或清除。

## 测试

`packages/credentials/credentials-console/tests/vault.spec.ts` 覆盖远程应用、dirty 写入保护、种子列表与派生引用、本地推送与取消设置时的删除、未接线情形，以及间隔轮询的释放。控制台端点已用测试账户实测：POST 保存加密行，GET 只把该行返回给所有者，DELETE 将其删除。
