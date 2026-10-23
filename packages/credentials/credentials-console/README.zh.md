---
description: "通过加密的 MWT.ONE 控制台密钥库，在本地桌面 harness 与云端 web harness 之间同步模型提供方 API 密钥。"
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-console

[English](README.md) | 中文

## 概述

`dsh-credentials-console` 让用户在桌面应用与 web 应用里填写的模型提供方 API 密钥保持一致。两个 harness 登录同一个 MWT.ONE 控制台账户；控制台加密保存每个密钥，本插件在启动时和固定间隔读取该集合，并在每次本地写入时推送。缺少 `CONSOLA_API_BASE` 或 `CONSOLA_TOKEN` 的组合完全保持本地。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

产品 bundle 会自动挂载它；只要进程带有控制台凭据，就无需配置：

```yaml
- name: '@deepseek-ai/dsh-credentials-console'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `consoleBase` | `$CONSOLA_API_BASE` | 控制台 API 基址，例如 `https://consola.mwt.one/api` |
| `consoleToken` | `$CONSOLA_TOKEN` | Bearer 令牌；每次调用都从实时环境读取 |
| `intervalMs` | `60000` | 本地存储重新读取密钥库的间隔 |
| `refSuffix` | `_API_KEY` | 密钥库拥有的引用后缀 |

只有以该后缀结尾的引用会被同步；保存的密钥会在一个间隔内到达另一安装，而在写入它的安装上立即生效。

### 配置

控制台必须提供 `GET/POST /api/harness/provider-keys/` 与 `DELETE /api/harness/provider-keys/<ref>/`，并认证到同一账户。控制台使用 `HARNESS_VAULT_KEY`（Fernet）加密值；缺失时从 `DJANGO_SECRET_KEY` 派生密钥。

### 每轮做什么

启动时读取密钥库，写入本地存储尚未持有的远程密钥，然后发布密钥库缺失的本地 `*_API_KEY` 值，因此已有安装不需要重新输入密钥。之后每次本地写入都会立即推送；推送失败会被记住，避免拉取在编辑到达控制台前覆盖它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

插件注入 `credentials` 并读取可选的 `settings` 接缝。它从不阻塞激活：首次同步在后台运行，控制台故障只记录警告。

### 方向与冲突

拉取时远程值优先，并通过 `credentials.set` 应用，后者发出 `credentials/reference-updated`；插件在拉取应用期间忽略该事件。本地写入会解析当前值并 POST；当本地来源不再是存储文件时（取消设置，或回退到部署环境）删除该行。两个设备同时编辑时后写者胜出。

### 种子列表

首次同步从 settings 描述符派生提供方引用：每个 `llm-pi-ai` 提供方的 `apiKeyEnv`，未声明时派生 `<ROUTE>_API_KEY`，再加上 `llm-deepseek.apiKeyEnv`。只播种来源为存储文件的本地值，因此从环境继承的部署密钥不会变成用户密钥。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [credentials](../credentials/README.zh.md)——本插件同步的接缝。
- [credentials-local](../credentials-local/README.zh.md)——每个 harness 保留的文件存储。
- [settings](../../settings/settings/README.zh.md)——种子读取的命名空间描述符。

-----

<a id="model-experience"></a>
## 模型体验

间接影响：提供方密钥属于配置，而不是提示词内容。同步它们改变下一次请求解析到的凭据，从不改变请求前缀。

#### KV Cache 影响

无；任何密钥值都不会进入请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **跨设备后写者胜出**——密钥库没有逐键 revision 围栏；两个人或两台设备保存同一引用时收敛到较晚的推送。
- **只同步 `*_API_KEY` 引用**——OAuth grant、MCP 令牌与记录留在写入它们的安装里。
- **密钥库故障只表现为警告**——本地密钥继续工作，失败的推送在下次本地写入或间隔轮询时重试。
- **控制台持有密钥材料**——值在静态时加密，但控制台部署及其 `HARNESS_VAULT_KEY`/`DJANGO_SECRET_KEY` 成为信任边界的一部分。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生包。被拥有的关系——本地写入到达密钥库、远程写入到达本地存储——是由单元套件固定的异步网络行为；凭据接缝拥有自己的事件生命周期不变式。
