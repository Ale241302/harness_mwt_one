---
description: "本 DeepSeek Harness 构建中的原生产品模块（ctx.faberloomAgents）：代理目录与版本化模型策略。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-agents

[English](README.md) | 中文

## 概述

此包承载代理目录与版本化模型策略、模型池、共享解析器与推荐器、每次执行的选型记录，以及上下文结果证据。它注册 `ctx.faberloomAgents` 主机服务。代理的提供方 API 密钥存放在凭据接缝（`ctx.credentials`）中，以由代理 id 派生的引用寻址；持久化记录只保留非机密的尾部与存在标志，任何读取都不返回密钥。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在组合中挂载此行即可暴露 `ctx.faberloomAgents`。该服务是调用插件 fiber 上的副作用，释放该 fiber 即移除。持久化状态经由 `ctx.storageDomain`，密钥经由可选的凭据接缝。

### 代理 API 密钥存放于何处

`createAgent` 与 `updateAgent` 接受 `apiKey`。补丁未携带该字段时，已存密钥保持不变；`null` 或空字符串会清除它。密钥通过 `ctx.credentials.set` 写入，绝不持久化到代理记录中：

```ts
const ref = agentCredentialRef(agentId)       // FABERLOOM_AGENT_API_KEY_<hex id>
await ctx.credentials.set(ref, value)         // createAgent / updateAgent do this for you
await ctx.credentials.unset(ref)              // clears the key
await ctx.credentials.describe(ref)           // { configured, source?, writable } — never the value
```

引用由 `AGENT_CREDENTIAL_REF_PREFIX`（`FABERLOOM_AGENT_API_KEY_`）拼上代理 id 的 UTF-8 字节的大写十六进制编码构成。十六进制编码是单射且前缀固定，因此任意两个代理 id 都不会指向同一引用，且每个引用都是合法的 POSIX 环境变量名。路由可调用 `agentCredentialRef(id)` 得到该引用并自行解析；代理服务本身无需该值。

`hasApiKey` 读取自 `ctx.credentials.describe(ref).configured`，因此在应用之外轮换或移除的密钥会立即不再显示为存在。`apiKeyTail` 是密钥的后四个字符，保存在记录中以便其所有者辨认；它只是便利信息而非事实来源，故直接在接缝上更换的密钥可能留下过时的尾部，而标志依然正确。

### 兼容与迁移

在接缝之前写入的记录仍带有原始 `apiKey`。它的首次读取会把该值迁入接缝并清空该字段，同时写入标志与尾部；该迁移是幂等的，再次读取不会改变任何内容。若接缝拒绝写入，值会留在记录中并记录失败，后续读取可重试，绝不丢失任何机密。

### 没有凭据提供方时

接缝是可选的，组合可以省略它。此时记录是唯一的存储：密钥保存在记录的 `apiKey` 字段中，`hasApiKey`/`apiKeyTail` 回退到已存标志、尾部与取值。挂载接缝后再读取此类记录，会按上述方式迁移该值。因此在没有接缝时写入的密钥尚未进入受管存储。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomAgents` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **副本不携带密钥** — `duplicateAgent` 复制配置，但绝不复制凭据，因为已存密钥无法被读回；副本从无密钥开始。
- **没有接缝时密钥留在记录中** — 未挂载凭据提供方的组合没有受管存储，因此在那里写入的密钥会留在持久化记录中，直到一次挂载了接缝的读取将其迁移。
- **尾部可能过时** — 直接在接缝上更换的密钥会保留记录中的旧尾部；`hasApiKey` 依然正确，因为它跟随 `describe`。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
