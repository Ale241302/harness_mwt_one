# Agent Note: Baseline agents and skills travel between homes and across the deployment

Status: implemented

[English](2026-10-27-baseline-agents-and-skills-travel.md) | 中文

## Problem

所有者在网页端修改了 `Operador Marluvas` 的提供方、模型和邮件连接，桌面端仍保留旧值；在桌面端的修改也从未到达网页端。原因有四个，并且叠加在一起。

镜像让部署基线智能体（`seeded`、无 owner）留在本地（[基线重复](../architecture/2026-10-24-baseline-duplicates-and-managed-instructions.zh.md)）：每个 home 都以自己的 id 播种它们，按 id 携带会让每个名称重复。这条规则同时也把所有者对这些智能体的每一次修改都留在了做出修改的 home 中。

同一所有者的两个 home 都持有 79 个智能体、41 个名称：早期的镜像把每个 home 的基线以未播种、无 owner 的行带到了另一个 home，这些副本随后作为普通智能体传递。

镜像的行日志只保存在内存中。桌面端重启后，两个 home 之间每一行不同的数据都被当作首次同步，而首次同步规则保留本地值并推送它，于是桌面端关闭期间在网页端做出的修改被桌面端的旧行覆盖。这影响所有被镜像的域，不仅是智能体。

由 Admin/CEO 编辑的基线智能体或目录技能只改变了该 Admin 自己的 home，而产品承诺全局目录由 Admin/CEO 编辑、所有人可见。

## Decision

**基线智能体的所有者设置按名称传递。** 镜像存储为 `faberloom_agents` 提供一个虚拟的 `baseline` 表（`packages/faberloom/mirror/src/baseline.ts`），以智能体名称为键。读取时把每个本地基线行投影为所有者可编辑的字段（职责、技能、工具、提供方、模型、联网、MWT 与 SICOP 访问、邮件连接、策略、经验、启用状态），已连接的智能体以名称表示；写入时修补该名称的本地行，并把已连接的智能体绑定到本地 id。基线的 `agents` 行仍然留在本地。由于该表通过与其他行相同的表接口读写，行日志决定方向的方式与其他地方完全一致。对端的墓碑永远不会删除基线智能体，本 home 尚未播种的名称会被忽略，直到播种器创建它。

**提供方密钥随设置一起在所有者自己的 home 之间传递。** 存储从凭据接缝中按 `agentCredentialRef(id)` 预先读取每个基线智能体的密钥，投影携带它，写入时把它存入接收方 home 的接缝并更新 `hasApiKey`/`apiKeyTail`；密钥永远不进入 `agents` 行。无法应答的接缝会让该周期不携带密钥并报告这一情况。

**日志在重启后保留。** 镜像在每个受保护的周期之后把日志写入 `mirror-status.json` 旁边的 `mirror-journal.json`，并在进程的第一个周期之前读取一次。为其他所有者或网关记录的日志，或无法解析的日志，会被忽略。

**删除另一个 home 基线的副本。** `faberloom-defaults` 删除这样的智能体：未播种、无 owner，名称和职责与本 home 的某个基线智能体相同，且 `originRef` 不是控制台共享。同名但职责不同的无 owner 智能体会保留。

**Admin/CEO 对基线智能体的编辑成为部署版本。** 在部署设置了 `globalAgentsFile` 的地方（网关使用所有用户 home 共享的卷上的 `/data/shared/faberloom-global-agents.json`），`faberloom-defaults` 每隔 `globalAgentsIntervalMs` 运行一轮（`packages/faberloom/defaults/src/global.ts`）。自上一轮以来基线智能体发生变化的特权 home 会以下一个修订号发布设置和密钥；每个 home 都会应用比其持有修订更新的版本。一个 home 的第一轮只记录它持有的内容，不发布任何东西。邮件连接不进入该版本，因为它们指向每个用户自己的邮箱。非特权所有者本来就不能编辑基线智能体，因此版本对他们是强制的。桌面端通过其镜像接收该版本，因为它的网页 home 应用了版本，而 `baseline` 表会携带它。

**Admin/CEO 对目录技能的编辑成为部署版本。** 设置了 `globalSkillsRoot` 时（网关使用 `/data/shared/skills`），Admin/CEO 保存角色、共享或已是全局的技能会写入该目录，并删除编辑者自己同名的副本；删除它会为所有人恢复目录版本。行报告 `origin: 'global'` 和 `editsGlobally`，对话框说明保存会应用到每个用户。网关在 `faberloom-role` 提供方中把全局目录排在所有者自己的技能之后，镜像的网页端会把全局技能包提供给桌面端，所有者自己同名的技能包优先。成员对目录技能的编辑仍是个人副本。

## Alternatives considered

像镜像处理例程那样按 id 携带基线 `agents` 行并按名称调和，会改写每个 home 中空间、会话和已存密钥已经引用的 id。

不让密钥进入镜像，会让另一个 home 上的提供方切换一直失效，直到所有者再次粘贴密钥；所有者选择让密钥在自己的 home 之间传递。

所有者否决了在 Admin 版本面前保留每个成员自己的提供方选择：全局目录是强制的，想要变体的成员把智能体复制为自己的智能体。

## Consequences

此变更后的第一个周期没有已保存的日志，因此在两个 home 不同之处，桌面端的值会胜出一次；所有者需要重新应用升级前在网页端所做的修改。

随版本发布的 Admin 密钥会存入每个 home 的凭据接缝，并被每个用户的该智能体副本使用；非特权所有者无法显示它。

桌面端只能通过其网页 home 接收部署范围的智能体与技能版本，因此镜像关闭的桌面端保持它播种的目录。

## Verification

- `packages/faberloom/mirror/tests/baseline.spec.ts`：编辑后的基线智能体在两个 id 不同的 home 之间按名称传递，已连接的智能体绑定到本地 id，密钥进入接收方接缝而不进入行，接收方的投影等于发送的投影；墓碑和未播种的名称不改变任何内容；持有密钥的行、其次最早的行代表一个名称；失败的接缝会报告，设置仍然传递。
- `packages/faberloom/mirror/tests/sync.spec.ts`：进程关闭期间对端做出的修改从已保存的日志中落地，而不是被当作首次同步冲突保留；无法读取的日志、其他所有者的日志和格式错误的条目都从空开始；网页端提供全局技能包，所有者自己的技能包优先。
- `packages/faberloom/defaults/tests/defaults.spec.ts`：删除另一个 home 基线的副本，同时保留自有、有 owner、共享和无关的智能体；部署范围的一轮只在设置了 `globalAgentsFile` 时运行，并能承受不可写的路径。
- `packages/faberloom/defaults/tests/global.spec.ts`：Admin 的编辑被发布并连同密钥和本地伙伴 id 强制应用到另一个 home，同时每个 home 保留自己的邮箱；成员的修改永不发布，下一个版本会替换它；格式错误的共享文件按空读取。
- `packages/faberloom/view/tests/workspace-board.spec.ts`：Admin 对目录技能的编辑成为全局版本并删除 Admin 的旧副本，成员的编辑保持个人，删除版本会恢复目录版本。
