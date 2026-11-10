---
description: "原生可移植产物模块（ctx.faberloomPortable）：把一个空间允许的文档与 harness 记录导出为带版本、清单和签名的目录，并原子暂存。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-portable

[English](README.md) | 中文

## 概述

本包把一个空间允许的贡献变成一个可移植目录。规划器执行分类允许列表，拒绝会话、转录和机密，解析显式依赖，并写出带规范摘要的完整清单。写入器在新的目录中暂存产物，最后写入清单，并返回分离的 Ed25519 签名；公钥是外部信任锚。格式、内容与软件版本彼此独立。文档从授权 Git 提交读取，绝不从移动的工作树读取。

## 目录

- [使用本包](#use-this-package)
- [服务契约](#service-contract)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把该行与暂存根目录、Ed25519 签名密钥一起挂载。服务是调用插件 fiber 上的 effect，销毁该 fiber 会移除服务。

```yaml
- id: portable
  plugin: '@deepseek-ai/dsh-faberloom-portable'
  config:
    stagingRoot: /srv/faberloom/staging
    signingKeyPem: ${PORTABLE_SIGNING_KEY}
    keyId: faberloom-2026-11
    maxBytes: 1048576
```

签名密钥只留在部署配置中。验证公钥绝不会写进产物；消费者把它作为信任锚提供。

<a id="service-contract"></a>
## 服务契约

- `plan(request)` — 纯函数：合并自有与继承贡献，执行允许列表和会话/机密规则，解析依赖，返回文件、清单、摘要与逐文件拒绝。不写磁盘。
- `stage(request)` — 规划、在暂存根下新建 `mkdtemp` 目录、写入每个文件、最后写 `manifest.json`，返回目录、清单、分离签名、摘要与拒绝。写入失败只删除本目录。
- `replace(destination, request)` — 规划、签名并原地更新目标。校验已签名所有权清单，拒绝用户编辑过的管理文件或外来文件冲突，复制外来文件与空目录，使用同级暂存目录，保留上一棵树作为备份，验证新树后清理；崩溃留下签名日志，下次运行恢复。仅保证同卷 rename，不承诺跨卷或同步文件夹的原子性；同一目标一次只允许一个写入器。
- `verify(directory, signature, publicKeyPem, expectedKeyId?)` — 重算每个清单摘要与字节长度，拒绝多余或缺失文件，重算内容版本与清单摘要，并验证签名；期望 key id 绑定调用方选择的信任锚。
- `committedDocuments({ repo, revision, paths, classifications })` — 从授权提交读取文档正文，而不是工作树。
- `contributionsFromUsage(usage, options)` — 把 harness 投影的 agent、skill、workflow、routine 与 memory 映射为贡献。没有分类的记录会被规划器拒绝。

### 版本与规范形式

`formatVersion` 是产物布局。`contentVersion` 是清单的 `sha256:`，内容或元数据变化会推动它。`softwareVersion` 由调用方提供，与二者独立。清单摘要是去掉 `digest` 后的规范清单 SHA-256；分离签名覆盖包含 `digest` 的规范清单。

### 分类与继承

只导出 `N0`、`N1` 与 `N2`。缺失、未知或冲突的分类被拒绝；被排除的类别不会出现在清单、库存或标题中，也不写脱敏标记。父贡献只有在标记为可继承且按贡献授权时才继承；子级排除优先；同 id 的子级替换父级；同一路径被两个不同 id 声明则拒绝。父修订固定在清单中。

### 依赖、会话与机密

贡献的 `dependsOn` 命名其它贡献 id。缺失、被拒、会话或循环依赖会拒绝依赖者，而不是截断引用。会话或转录按种类、已知存储路径（英文或西班牙文）或元数据（`sessionId`、`transcriptId`、`source`、`kind`）被拒绝，即使属于同一空间。内容、元数据键与值、id、标题、路径与媒体类型都会扫描私钥和常见令牌形状；命中会拒绝该贡献，机密绝不写入产物或清单。

### 读取授权提交

`committedDocuments` 用 `git cat-file blob` 与 `--no-replace-objects` 读取每个正文。修订必须是完整的 40 或 64 位十六进制提交 id，且 `git rev-parse --verify <id>^{commit}` 解析回自身，因此短 id 或长得像哈希的分支不能替换内容。绝不读取工作树。

### Claude Code 适配器

`planClaudePackage` 把一个签名产物转换为 Claude Code 插件：`.claude-plugin/plugin.json`、`CLAUDE.md`、`faberloom-space` 与 `faberloom-proposals` skills、产物资源、由 host 管理的连接描述符，以及带精确 host 版本的加载记录。`installClaudePackage` 写入目录；`validateClaudePackage` 只检查清单与 skills，不声称已安装；`loadClaudePackage` 只在精确 host 版本下注册组件；`removeClaudePackage` 只删除包目录。包内没有 bearer 令牌、全局令牌变量或 `bin/`：连接描述符携带不透明的 host 管理引用。本地 runtime 缺失时，计划是带 `sent:false` 与 `mesa:false` 的草稿，绝不发送，也绝不模拟 Mesa。

`convertPortable` 生成适配器使用的逐字段转换表：文档、skills、agents 与 skill 资源被保留或翻译；agent 的 frontmatter 与 `tools` 字段保留，只规范化 name，因为省略 `tools` 会扩大 host 权限；workflow、tool、session、transcript 或完整备份被拒绝，只保留在源产物中；routines、memory 与 metadata 作为非 host 组件被省略。清单携带每个文件的来源（`child` 或 `inherited`）。旧生成器保留其消费者，报告中记录 `legacyGenerator: retained` 与 `D13-open`；不声称完全替换。

`CLAUDE_SURFACE_MATRIX` 是带日期的逐表面契约。Code 及其桌面扩展在记录版本上以插件目录与本地 loopback OAuth 认证；chat 与 Cowork 以 ZIP 及各自的远程/host 认证保持开放。`planClaudePackage` 对开放表面返回无运行组件的草稿；`ignored` 列出转换省略或拒绝的内容。`archiveClaudePackage` 为消费 ZIP 的表面生成确定性归档，`removeClaudePackage` 只移除该包。

`checkUsabilityObservation` 用会话前批准的门槛校验一次 4A.3 真实代表用户会话：拒绝开发者或合成观察者、未批准门槛、超时或帮助次数超限、含 token/命令/配置的路径、未解释的 diff、失败恢复，以及来自另一修订的加载记录。填写表单在 `docs/faberloom/evidence/4a3-usability.template.json`；真实会话填写前检查器拒绝模板。

<a id="configuration"></a>
## 配置

| 字段 | 含义 |
|---|---|
| `stagingRoot` | 已存在目录；每次运行在其下新建产物目录。 |
| `signingKeyPem` | PKCS#8 Ed25519 私钥 PEM；不记录、不写入。 |
| `keyId` | 写在签名旁的信任锚 key id。 |
| `maxBytes` | 最大产物文件；默认 1 MiB，可按请求覆盖。 |

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到什么

没有。`ctx.faberloomPortable` 不注册工具、提示段或会话事件。只有把产物文件提供给模型的消费者才使其对模型可见。

#### Token 影响

每次请求零直接 token。

#### KV 缓存影响

与实时请求无关：服务不会触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **一个父修订，不是完整层级。** 规划器解析一个固定父修订和扁平继承列表。多级继承、逐贡献来源轨迹与别名声明属于 3B.1。
- **文档来自 Git，记录来自投影。** 上下文条目的正文不从 harness 投影的标题列表读取；调用方从授权提交导出文档正文。投影适配器覆盖 agent、skill、workflow、routine 与 memory。
- **产物是目录，不是压缩包。** 打包、传输与对象存储属于后续切片；清单与摘要已是稳定输入。
- **会话规则基于信号，而不是查询会话存储。** 如果记录的种类、已知存储路径或元数据没有把它标识为会话，它就可能看起来像文档；导出器在这一点上信任生产者的标注。打包器绝不读取会话存储。
- **Claude 包只认证 Code。** Claude chat 与 Cowork 不在本适配器认证范围内，并在任务前列为不支持。针对 D01 账号的真实已认证模型任务不属于本包的自动证据；适配器清单已用已安装的 Claude Code 版本验证，组件通过合成 host loader 加载。
- **Rollback 与连接引用是 host 状态。** 包只命名不透明引用；host 把它解析为令牌并决定连接是否仍有效。包绝不携带该权限。
- **路径规则按 Windows 安全设计。** 空格、盘符、反斜杠、设备名、大小写别名、双向字符与非配对代理项会被拒绝，因此产物无法表达所有合法 POSIX 名称。这是 Windows 优先产品的有意选择。
- **签名密钥是部署状态。** 密钥轮换、撤销与分发不属于本包；信任锚是调用方的公钥。

未发布 invariant 伴随包，因为该服务没有单元测试之外的独立观察。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

`src/plan.ts` 负责合并、分类、路径分配、依赖解析与清单，是纯函数。`src/stage.ts` 负责新目录与写入顺序，清单最后。`src/verify.ts` 重算库存、两个摘要与签名。`src/policy.ts` 负责允许列表、机密形状与会话规则。`src/git-source.ts` 通过 `git cat-file blob` 读取授权提交，绝不读工作树。

</details>
