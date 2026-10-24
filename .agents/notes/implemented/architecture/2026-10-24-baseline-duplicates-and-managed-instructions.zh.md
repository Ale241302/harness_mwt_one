# Agent Note：基线行、共享指令与 Client B2B 的写入范围

状态：已实现

[English](2026-10-24-baseline-duplicates-and-managed-instructions.md) | 中文

## 问题

密钥库上线后仍有五个产品缺口：

1. Agents 面板把每个部署基线列出两三次，Spaces 面板的同名行无法区分。同一账号的两套安装各自播种同一目录并镜像产品行，于是一套安装收到另一套的同名基线（不同 id）；镜像还携带了各安装从控制台共享中物化的 agent 副本。
2. MWT MCP 把调用者解析成另一个身份。网关用 `MWT_MCP_GATEWAY_KEY` 发送 `X-MWT-Gateway-Key`，而 MCP 容器持有不同的值，中间件因此拒绝传递的身份并回落到服务令牌。
3. 控制台未发送 actions 时，`client_b2b` 被推导为只读。这些账号是产品的客户；角色锁定移除了他们的写入入口，尽管拥有 Space 一直允许写入。
4. 在 Web 创建的例程不会到达桌面。镜像插件已挂载但处于关闭状态：桌面登录只写控制台令牌，没有启用镜像，而且镜像还要求桌面无法获得的内部凭据。
5. 手工编辑的 `AGENTS.md` 在下一次投影时消失。投影重写整个指令文件，运维笔记没有持久位置。

## 决定

**部署基线每个名称只保留一行，并由本机拥有。** `faberloom-defaults` 在每次执行前合并已播种的基线：只对 `seeded` 且 owner 为空的行分组；持有已存供应商密钥的行成为保留行，保留行吸收组内全部技能与已连接 agent，其余删除。用户自建的同名 agent 永不受影响。镜像不携带这些行，也不携带 `share:` 副本，因为每套安装自行播种或导入。

**带外部 Workspace id 的镜像 Space 会被重新锚定，而不是计为已锚定。** `adoptOrphanWorkspaces` 把本地注册表不认识的 `workspaceId` 视为未绑定，于是同名 Space 接管本地文件夹，而不是再建一个。真正位于不同文件夹的同名 Space 仍然分开，面板在同名时追加文件夹名。

**控制台令牌就是镜像凭据。** 路由原本就向 `POST /portal/me/` 验证 Bearer 令牌；现在只在调用方出示内部密钥时才校验它。桌面登录写入 `FABERLOOM_MIRROR_ENABLED=1` 与 `FABERLOOM_MIRROR_OWNER`，保留可选的 `FABERLOOM_MIRROR_KEY`，退出时清除这四个名称。

**Client B2B 在自己的范围内可写。** `deriveReadOnly` 只让 `viewer` 在没有显式 `permissions.read_only` 时保持只读；显式标志或控制台动作列表仍然生效。产品侧的守卫（播种 agent、外部 Space、共享）继续阻止客户改动部署目录。

**投影只拥有标记块。** `renderInstructions` 用 `<!-- faberloom:begin -->` 与 `<!-- faberloom:end -->` 包裹输出，`mergeInstructions` 原地替换该块。旧的整份投影会被整体替换；其他文件保留原文，并在其后追加该块。

**重复 Space 被合并，而不是被隐藏。** `FaberLoomSpaces.merge` 把重复项的记忆与文件移到保留项，合并成员、排除、来源、上下文、提示词与 agent，然后删除重复行。`FaberLoomContext.reassign` 与 `FaberLoomSessionShares.reassign` 会先移动策划条目与会话记录，因为这些行以重复项的 id 命名。`mergeDuplicateSpaces` 选择**最早的行，然后是最低 id**：两套 home 从相同的 `createdAt` 计算出同一个保留项，因此两端收敛而不是各留一行。绑定到不透明 `spaces/fw_*` 区域的保留项会重新绑定到同名真实文件夹，Spaces 面板在同名时显示文件夹。

**共享会话每个会话一个文件。** `faberloom_session_shares` 域使用 JSON 后端的 `per-record` 布局：`single` 文档在每次捕获时重写并重新解析全部会话，真实目录达到 117 MB，把桌面宿主堆推到 4 GB 上限。首次打开时后端会把现有整单元文件引导为每行一个文档。

**Space 永不把自己当作父级。** `ensureSpaceWorkspace` 把 `null` 视为无父级，并拒绝 `parentId === id`，因此父级为 null 或指向自身的记录不会递归到宿主内存耗尽。同一守卫也保护父级修复过程。

**子 Space 必须位于父级文件夹内。** Workspaces 侧边栏按路径前缀嵌套，所以即使 `parentId` 指向父级，位于 spaces 根目录的子文件夹仍会显示为单独条目。`ensureSpaceWorkspace` 在无法准备父级文件夹时拒绝把子级放到根目录；`repairNestedSpaceFolders` 会把落在父级之外的子级移回内部，并携带其文件、后代、Workspace 注册与会话附件。该修复与重复合并运行在同一轮 overview 中。

**Workspace 绑定只属于本机。** 镜像在接收 Space 行时保留本机的 `workspaceId`：Workspace id 属于某一套注册表，写入对端的 id 会让 Space 失去文件夹。标题、父子关系、记忆与上下文仍然传输；每套 home 把 Space 绑定到自己的文件夹，嵌套修复保证该文件夹位于父级之内。

**桌面配置从自己的 bundle 携带密钥库插件。** `@deepseek-ai/dsh-credentials-console` 是 `faberloom-app` 的依赖并随打包集发布；配置的模块回退会像其他仅由 bundle 携带的包一样链接它。`~/.dsh/profiles/desktop/node_modules` 下手工创建的 junction 是开发期权宜，不是打包要求，已移除。

## 考虑过的替代方案

**自动删除重复 Space。** 否决：同名 Space 可能指向不同文件夹，删除会连同记忆与文件一起丢失。预防加可见文件夹可逆，删除不可逆。

**镜像携带基线 agent 并在两端启动时去重。** 否决：镜像会复活一端刚删除的行，两端会争抢 id。让基线留在本机从源头消除冲突。

**要求桌面持有部署镜像密钥。** 否决：桌面永远看不到该秘密，新安装无法在无人复制的情况下启用镜像。控制台令牌才是真正的授权，并按请求验证。

**保持 `client_b2b` 只读并新增客户角色。** 否决：控制台已用权限表达只读，新角色会让网关、桌面与产品守卫三处映射翻倍。

**单独的运维文件（`AGENTS.local.md`）。** 否决：客户端只加载 `AGENTS.md`；指针文件依赖每个客户端都跟随它，而投影自己的 README 说明没有客户端保证如此。

## 后果

一套安装现在每个基线名称只显示一行、每个本地文件夹只显示一个 Space；删除已播种 agent 仍然有效，因为标记阻止重新播种，镜像也不会把它带回来。Workspace id 属于另一套安装的镜像 Space 会按标题重新锚定，这是尽力匹配：同一安装中两个不同文件夹的同名 Space 仍然分开，面板会显示各自的文件夹。

镜像不再需要运维把秘密复制到桌面，已登录的安装会在下一个周期开始同步例程与工作流。定时器保持被引用——unref 的定时器无法唤醒空闲的桌面宿主，这正是 Web 改动只在本地编辑碰巧触发镜像时才到达的原因——Windows 上被扫描器拒绝的 rename 会在周期失败前重试。网关在调用方出示内部密钥时仍会校验，设置了该密钥的部署保留额外检查。

`client_b2b` 账号获得产品的写入入口；希望其只读的控制台发送 `permissions.read_only: true`。`AGENTS.md` 现在由双方共同拥有：投影只替换标记块，块外的笔记在每次刷新后保留。

## 验证

- 单元：基线合并（持钥行胜出、技能合并、用户行不受影响）、镜像仅本地行（导出与应用）、可选镜像密钥、标记块替换，以及 `client_b2b` 的只读推导。
- 单元：Space 合并（记忆与文件移动、重复行消失）、null/自引用父级守卫（41 项工作区测试不再因递归堆耗尽而崩溃），以及共享会话的 per-record 布局。
- 单元：子 Space 创建在父级文件夹内；位于 spaces 根目录的子级会连同文件被移回父级之下。
- 镜像的例程与工作流同名合并测试保持通过；登录启用镜像后例程会到达桌面。
- GUI 套件全绿，包括仅桌面显示的安装块；完整的 `faberloom/view` 套件 132 项通过。
- 部署：网关与 MCP 容器的 `MWT_MCP_GATEWAY_KEY` 已对齐，镜像周期以 `missing: []` 完成，移除手工 junction 后桌面配置仍能解析密钥库插件。
