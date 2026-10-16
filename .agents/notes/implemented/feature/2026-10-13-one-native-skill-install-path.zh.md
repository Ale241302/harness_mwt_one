# Agent Note: One native skill-install path, shipped enabled

Status: implemented

[English](2026-10-13-one-native-skill-install-path.md) | 中文

## Problem

有两条代码路径都能安装技能文件夹。原生安装器（`packages/skill/skill-install`）会识别文件夹、通过 `ctx.userQuestions` 询问目标、把它复制到 `@deepseek-ai/dsh-skill-filesystem` 扫描的根中、给副本打标记，并把 `install_skill`/`uninstall_skill` 作为模型工具暴露——但基础 bundle 以 `disabled: true` 发布它的行，因此这些工具从未进入任何请求，生成的工具目录也漏掉了它们。较旧的 FaberLoom 管理路径（`packages/faberloom/view`，由 `packages/client/ui-faberloom` 的 Skills 面板呈现）把同样的文件夹复制到同样的根中，却带着自己的校验、自己的 `faberloom_skill_installs` 存储域、自己的拒绝词汇以及自己的模型工具。两者在根、来源规则以及重复安装的含义上并不一致，后者还在产品面板内部重复了前者的校验与复制逻辑。

## Decision

**原生安装器是唯一路径，并在模型可见之处随产品启用。** `packages/bundle/base` 挂载 `@deepseek-ai/dsh-skill-install` 时不再带 `disabled`，且每个已发布的 agent preset（`standard`、`cordis`、`ptc`）都把它挂载在条目本地的 `isolate` realm 之内，使其两个工具注册到该 preset 的层而非进程全局层。`packages/bundle/web-app` 像禁用 `tool-skill` 一样禁用该基础行，因此 Web 组合的全局工具层保持为空；`packages/bundle/faberloom-app` 重新启用该基础行，因为 Skills 面板的 `ctx.skillInstall` 是主机面服务。因此 `install_skill` 与 `uninstall_skill` 出现在每个已发布 profile 的模型可见工具列表以及 `docs/tool-catalog.md` 中。这取代了此前模仿 `skill-badge`、因启用会改变每条已记录请求的工具列表而以禁用行发布的选择；已记录的预期改在同一次改动中重新录制（见[结果](#consequences)）。

**FaberLoom 管理面路由到 `ctx.skillInstall`。** `FaberLoomViewService` 通过 `ctx.get('skillInstall')` 读取服务并委托：`installSkill()` 即 `install({ source, destination, cwd, replace })`，`skillInstalls()` 即 `list(cwd)`，`uninstallSkill()` 即先 `uninstall({ name, destination, cwd })` 再重新 `list`。面板与 `faberloom_skill_install` 保留原有的 Remote 名称与报告字段，因此浏览器与不可触碰的工具包无需改动。[harness 安装说明](2026-10-16-one-harness-install-path.zh.md)随后把面板自身的控件替换为 harness 安装，并删除了把目标变成问题的 `skillInstallTargets()`；`installSkill()` 保留，因为 `faberloom_skill_install` 仍经由它路由。

**视图只保留自己的策略，不保留安装逻辑。** 两个守卫留在视图本地，因为它们是 FaberLoom 的身份与工作区策略，而非文件夹处理：只读身份被拒绝，解析后位于工作区根之外的来源被拒绝。其余一切——来源识别、候选校验、目录复制、`.dsh-skill-install.json` 标记、幂等性与移除——都属于安装器。`packages/faberloom/view/src/spec.ts`、`faberloom_skill_installs` 域、安装键、复制辅助函数与安装域关闭 effect 均被删除；`storageDomain` 随该包、依赖与 tsconfig 引用一起离开视图的 `inject` 列表。

**标记就是安装记录；面板是这些记录之上的视图。** `skillInstalls()` 读取全局根以及（当工作区可解析时）工作区根下安装器的标记，`uninstallSkill` 只移除带标记的目录。按身份划分的账本已移除：标记记录技能来自何处、何时安装，而根是部署范围的，因此同一部署的两个用户看到的是根下的带标记安装，而非各自的记录。

**不存在任何遗留账本行。** `faberloom_skill_installs` 域是在最新的 `deploy-*` 与 `faberloom-*` 标签之后引入的，因此没有任何已发布或已部署的产物写入过一行；下一个功能引入了原生安装器与本决定，使该账本成为源码树内的死路。故无可迁移之处，且该域声明被删除，而非读取一次再转换。

## Alternatives considered

**保留禁用行，只在产品 overlay 中启用。** 拒绝：这会让这些工具既不在生成的目录中，也不在任何已记录的工具列表中，于是该功能在已发布 profile 中对模型始终不可见，而代码却声称它可用——正是 README 此前不得不解释的状态。

**保留新工具名并删除旧面板工具。** 拒绝：`faberloom_skill_install` 是产品面向模型的安装面，面板调用的也是同一个 Remote 方法；把原生报告映射进既有字段即可避免删除任一者所带来的用户可见回归。

**把 FaberLoom 账本作为第二条持久记录并入安装器。** 拒绝：安装器的标记已经把来源、目标、时刻与摘要保存在技能旁边，而并行的表还得与加载器可能在底下改动的目录保持一致。

**让复制经由 `ctx.fs`。** 拒绝，理由与[安装与 MCP 说明](2026-10-12-install-a-skill-and-an-mcp-server.zh.md)所记相同：复制携带目录树中的二进制资源，而 `ctx.fs` 没有目录复制。

## Consequences

这些工具在已发布 headless profile 与已发布 preset 的每条已记录请求中可见，因此快照伴生文件（`tool-schemas.expected.json`）、CLI 与 Web 的工具列表金标以及工具目录都在本次改动中随两条新 schema 条目重新录制；会话夹具本身是归一化不动点，未被重写。刻意收窄目录的测试专用组合（`pwsh`/`fs-glob-sampling`/`sdk-minimal` 补丁）现在与 `tool-skill` 一起禁用该行，以保留其枚举集合。

面板失去了按身份的安装列表与账本行卸载：它现在显示根下的每一次带标记安装，并通过安装器移除其中一次，安装器拒绝没有标记的目录。这在多用户部署中可观察到，是单一记录所付出的代价。

安装会复制整个来源目录，因此 `.shared-by` 发布者标记会随副本一起带走，而旧视图会剥离它。该标记是来源信息而非配置，而且面板的移除仍然有效，因为移除依据的是安装标记而非发布者标记。

视图的拒绝词汇比安装器更粗：不是目录、为空或不含 `SKILL.md` 的来源都读作「不是 skill」，不可读或缺失的 front matter 读作缺失或非法的名称，并复用面板既有的文案。工作区包含性检查保留，因此 `outside-workspace` 仍然可达。

## Testing

安装器的真实组合规格在临时根上启动技能注册表与提供方；`packages/faberloom/view/tests/install-skill.spec.ts` 启动真实安装器并断言面板的报告、被复制的目录、标记与移除；无密钥快照通道以两条新 schema 条目重放已发布 profile，并重放作者手写的 `skill-install` 与 `skill-uninstall` 场景——其中模型对临时 harness home 调用 `install_skill` 与 `uninstall_skill`，从而把被拒绝的文件夹、被复制的目标以及卸载后的目录撤回端到端地固定下来。
