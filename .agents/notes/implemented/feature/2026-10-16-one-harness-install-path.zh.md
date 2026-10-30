# Agent Note: 一次安装一个 harness（文件夹或归档），Skills 面板只保留一条安装路径

Status: implemented

[English](2026-10-16-one-harness-install-path.md) | 中文

## Problem

Skills 面板原本提供的卡片只安装 *skills*：选文件夹、选当前工作区或全局根、替换或跳过、安装。团队 harness 实际携带的东西它装不了——代理、常驻规则、命令与脚本——而那个双作用域选择让面板每次都问一个用户每次都会同样回答的问题。产品自身的知识库路径已经能识别带 `skills/` 与 `agents/` 的文件夹；而带 `rules/`、`commands/` 的文件夹，或把整包压成一个 `.zip`，都完全无法安装；按语言分组规则的 harness 也没有办法声明"这些是参考资料组"而不是"把所有语言都打开"。

## Decision

**一次 harness 安装把每个部分写进该用户自己的 Harness home。** `SkillInstallService.installHarness({ source, replace })` 按约定为每个部分识别其目录，并写进产品本来就会读取该类型的位置：`skills/`、`skills-shared/` 与 `skills-catalog/` 的每个角色成为 skill；`agents/` 与 `agents-shared/` 成为 `<dshHome>/.agent-presets` 下的 preset；harness 自带的 `AGENTS.md` 与 `rules/`、`.agents/rules/` 顶层的 Markdown 成为 `<dshHome>/AGENTS.md` 受管块内的常驻规则；`commands/`、`scripts/`、`hooks/` 与 `mcp-configs/` 原样复制；规则目录的子目录会被复制并在块中按安装路径列出，而不是被激活。跨根出现的重名 skill 与重名 agent id 只安装一次，取约定顺序中的第一个根。

**目标作用域的问题消失了，承载它的区块随之消失。** harness 是该用户自己的配置而不是项目内容，因此每个部分都对该用户全局，面板不再询问写到哪。`FaberLoomViewService.skillInstallTargets` 及其类型作为该选择的最后消费方被删除；`installSkill` 保留，因为产品的模型可见工具仍经由它路由。`installHarness(source, replace?)` 是面板的路径，而面板控件是被替换而非扩展：`SkillInstallBlock` 被删除，由 `HarnessInstallBlock` 接替。

**`.zip` 也是 harness，其条目名在写入任何内容之前先被校验。** `source` 可以指向归档，它会被解压到临时目录，并在 `finally` 中由本次安装删除；绝对路径、带盘符、或用 `..` 上跳的条目会使整个归档被拒绝而不是被跳过，因为这样的归档要么损坏要么带有敌意，而半途解压会掩盖这一点。解压基于 `fflate`，因此没有任何平台需要 `tar`。

**规则块是受管的，而不是追加的。** 安装写在 `<!-- faberloom-harness:begin -->` 与 `<!-- faberloom-harness:end -->` 之间：重新安装会替换该区域，并保留用户指令文件中其他每一行原样不动。缺少收尾标记的块延伸到文件末尾；孤立的收尾标记会被移除而不会带走它前面的文本。

**原生选择器只增加一个文件选择器，而不是第二个 seam。** `DirectoryPickerNativeCapability` 在 `pick` 旁携带 `pickFile`，而 Win32 子进程以 `DSH_DIALOG_KIND` 接收其模式：同一个 `IFileOpenDialog` 会话，`FOS_PICKFOLDERS` 置位或清零。能力每个服务仍只有一个对象，因此能显示目录选择器的组合也能显示这一个，而浏览后端与该动词的拒绝方式与拒绝 `pick` 时相同。

**每个被投影的作用域都把这两个知识工具作为规则携带。** harness 投影写入 `## Reglas por defecto del ámbito` 一节（内容取自 `DEFAULT_SCOPE_RULES`）：在阅读代码之前先通过 `graphify` 技能查询项目的 `graphify-out/` 图谱，改动之后保持它为最新，并用 `archify` 技能绘制架构与流程，而不是只用文字描述。因此一个首次被投影的文件夹无需任何人手写该规则就会去查阅自己的图谱。

## Alternatives considered

**保留 `installSkill` 作为面板路径，为 harness 另加一个按钮。** 否决：harness 路径是超集（单个 skill 文件夹与知识库都是只含一个部分的 harness），两条路径会为一个决策维护两套拒绝词表，而这正是此前那次合并说明所移除的重复。

**把文件选择器做成选择器 seam 的 `files` 能力类型。** 否决：该 seam 每个服务只暴露一个能力对象，因此提供 `files` 的后端无法再提供 `pick`，而桌面端恰好只组合一个原生后端。扩展原生能力让一个后端同时提供同一对话框的两个动词。

**通过子进程（`tar`，或 PowerShell 的 `Expand-Archive`）解压归档。** 否决：本仓库的 native-command 边界是为平台选择器与打开器存在的，而归档只是数据——`fflate` 在每个平台上都在进程内读取它，且条目名校验与写入位于同一模块。

**把规则组的文件同时复制进指令块。** 否决：按语言分组规则的 harness 携带每一种语言，全部激活会把 Angular 与 C++ 指引放进同一次请求。按路径列出这些组，既保持可达又不会全部开启。

**无条件把 harness 自带的 `AGENTS.md` 写进 home 的指令。** 否决：只有已经携带可识别部分的文件夹才被当作 harness，因此把安装器指向一个普通项目文件夹不会悄悄把该项目的指令当作该用户自己的指令采纳。

## Consequences

面板的安装控件改变了形态：它选择文件夹或归档，安装一次，并按部分各报告一行（数量、状态、目标），外加安装器拒绝的任何候选名称。已记录在案（marker）的安装仍按根列出，也仍可逐一移除，因此此前说明中的"每次安装一条记录"行为未变。

`skillInstallTargets` 离开视图的 Remote 表面，因此该方法任何其他消费方都会停止编译；`installHarness` 加入其中，出现在生成的客户端、API 目录与生成的子系统页面里。

harness 安装会从调用方给出的路径写入用户 home，不施加双作用域 skill 安装所用的工作区限制。该限制从来不是针对用户的边界，因为两端都归用户所有；但把该 Remote 暴露给浏览器的部署，应把操作者自己的选择器读作构成约束的东西，包的 README 已记录这一点。

`hooks/` 与 `mcp-configs/` 落在 home 中并报告其目标，但没有任何东西为它们接线：产品从各 CLI 自身的设置读取 hook，从其自身注册表读取 MCP 服务器。期望安装器激活它们的 harness，是在要求一个产品并不具备的机制。

## Testing

`packages/skill/skill-install/tests/harness.spec.ts` 构造一个携带每个部分、外加检测器必须拒绝的候选的文件夹，把它安装到临时 home，并断言各根、安装标记、代理 preset、被复制的部分、受管块、幂等性、替换，以及用户在块之外自己写的文本得以保留；它还用 `fflate` 构造真实归档，覆盖包裹根、扁平、不可读与逃逸条目几种情形，并通过启动的插件断言解压目录随后已被删除。

`packages/faberloom/view/tests/install-skill.spec.ts` 启动真实安装器，断言视图的分部分报告、每种整次调用拒绝，以及只读身份拒绝；`packages/faberloom/view/tests/prepare-harness.spec.ts` 固定面板按钮返回的投影报告。

`packages/client/ui-faberloom/tests/harness-install.client.spec.tsx` 驱动该控件：选择文件夹与归档、取消选择、每种本地化拒绝与部分状态、被拒绝候选行、传输失败，以及带移除操作的上限安装列表。

`packages/host/directory-picker-native/tests/native-picker.spec.ts` 覆盖四条平台路径上的 `pickNativeFile`，`win32-dialog-logic.spec.ts` 与 `win32-dialog.spec.ts` 固定文件对话框的标志与协议，`directory-picker.host.spec.ts` 覆盖 `pickFile` Remote，包括它在浏览组合下的拒绝。

`packages/faberloom/harness-projection/tests/harness-projection.spec.ts` 断言每条默认规则按顺序到达被投影作用域的指令，包括一个完全没有登记任何记录的作用域。
