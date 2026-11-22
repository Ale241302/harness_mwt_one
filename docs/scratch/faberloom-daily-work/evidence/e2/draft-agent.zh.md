# 草稿代理：对话、上下文、历史与学习

[English](draft-agent.md) | 中文

- 基础：`deepseek-harness-t14` worktree，包含未提交更改；未修改生产环境。
- 范围：通过原生对话编辑草稿、授权的来源与线程上下文、附件、持久会话、修订、按提案学习、签名与明确的 Space 操作。
- 级别：C1-I。
- 状态：CLOSED。
- 审批：本次隔离执行没有任何部署授权。
- 作者：OpenCode。
- 独立复核：最终功能复核 **PASS**，最终安全复核 **PASS**，均针对当前代码，前几轮缺陷已关闭。
- 组合 fixture：`packages/faberloom/view/tests/draft-agent-composition.spec.ts`，SHA-256 `0D4C00B86BB5BBCE7998BE3429F32277F17037C32F8FD754843F497B40D99BFC`，内容全部为合成数据。

## 命令与结果

- 重点 Host 测试：`mail-attachments`、`draft-revisions`、`draft-agent`、`space-files`、`space-from-email`、`space-entry-authority`、`spaces`、`draft-tools`、`send-space-file-by-email`、`save-space-attachment` 与 `export-space-view`：**11 个文件，147/147 通过**。
- `corepack pnpm exec vitest run packages/client/ui-faberloom`：**22 个文件，283/283 通过**。
- 对 `view`、`tool-faberloom`、`connections`、`spaces`、`working-directory` 与 `ui-faberloom` 执行 `tsc -b`：**0 错误**。
- `corepack pnpm run build:artifacts`：**8/8 gate 通过**（native、Typert、Host compiler 与 bundle、Desktop、Client compiler 与 bundle、Web），记录 381 个客户端产物。
- `corepack pnpm run build:check`：**2/2 通过**，包括 Host 与 Client。
- `corepack pnpm run verify-tool-catalog`：目录已更新。
- `corepack pnpm run verify-upgrade-guides`：升级指南符合规范。
- `corepack pnpm run verify-client-ui-i18n`：**1398 个文件**使用词典拥有的文本。
- 本次交付文件的 `verify-export-jsdoc`：没有新增问题；剩余 58 条是 `packages/fs` 的既有 T14 债务。
- 以 `DSH_SNAPSHOT=replay` 重放 `faberloom-draft`：**PASS**。此前一次混跑了全部 snapshot 并以真实模式失败，不是本次改动的回归。
- 修改的四个 README 双语对一致。`test:docs` 仍有无关 T14 失败，不声明为通过。

## 观察到的行为

编辑器先保存再打开。`draftSessionStart` 在 Host 创建专用会话，以 `inject` 注入上下文且不唤醒轮次，再根据先前会话与已审阅修订执行 CAS 关联。Client 不能提供任意 `sessionId` 或种子。重新创建已关联代理时，`agent/created` 会重新安装策略。

模型只能看到草稿读取、更新、历史与恢复四个工具。executor guard 拒绝其他工具及其他 `draftId`。敌意组合分别尝试 `faberloom_mail_trash` 和修改另一个草稿，均在工具体执行前被拒绝。

哈希涵盖消息、附件、来源、Space 与 `aiText`。`saveDraft` 只负责创建：已存在的 id 被拒绝，所有替换都通过 `updateDraft` 并要求预期修订。恢复与转移都要求编辑器中打开的修订。发送在创建意图或联系 SMTP 前必须取得哈希。`updateDraftAndRecord` 保留准确快照，并按草稿排序更新与历史。

完整种子最多 48,000 字符、8 条消息、12 个转换附件与 12 条有界课程。Space 在任何目标效果前检查确认修订；提交后如发生失败，会返回真实状态与 `completion: 'partial'`，界面不导航。

没有轮次的预配置会话在超过八个时被释放：`provision` 调用 `evict`，测试创建九个草稿并观察到恰好一次 `dispose`。种子不再点名被拒绝的工具；无法转换时改为向 owner 索取文件。

## 反向控制

测试拒绝错误 owner、只读身份、过期写入或恢复、并发双重关联、对草稿会话注入、旧种子重试、没有 Workspace 的 Space，以及不产生创建、复制、会话准备或附加效果的过期确认。没有测试激活课程，也没有发送、移动、标记或删除邮件。

安全复核新增了可执行控制：`faberloom_mail_download` 拒绝 loopback、私有网络、link-local、multicast、URL 中的凭据与超过 20 MB 的响应，并逐跳重新校验重定向；没有会话的调用以 `MAIL_WORKSPACE_UNAVAILABLE` 拒绝；附件落在 `workingDirectory` 的当前目录而非原始 `cwd`；`correo-adjuntos` 在每次写入前后按身份复核；附件上限按解码后的字节计算，不信任调用方的 `size`；签名与 `seedMailSession` 拒绝只读身份；重命名、删除、打开、导出或向 Space 保存附件都要求 `canManage`，拒绝指向区域外的符号链接，且不覆盖已有文件。

`space-entry-authority.spec.ts` 通过 executor 验证这些拒绝：`renameSpaceEntry`、`deleteSpaceEntries`、`openSpaceFile`、`attachMailToSpace`、`saveSpaceAttachment` 与 `sendSpaceFileByEmail` 在读写磁盘或邮箱前拒绝非管理者；区域内的链接在重命名、删除、打开与发送时被拒绝；管理者仍可重命名和删除普通文件。`export-space-view.spec.ts` 增加了无管理权限、`exportaciones` 链接与目标链接三种拒绝。

## 无密钥 snapshot

`snapshots/session/faberloom-draft` 通过 `dsh --profile headless` 挂载真实存储与工具，不使用邮箱或网络。以 `DSH_SNAPSHOT=replay` 的筛选重放在最终构建上通过，覆盖草稿代理的创建、schema 与 prompt。

## 视觉走查

隔离配置 `visual-t14` 运行在 `http://127.0.0.1:3099`，包含两个合成草稿，数据位于 `C:/Users/ale13/AppData/Local/Temp/visual-t14-data`。在深色主题下确认：两个草稿的列表、带附件的编辑器、「已审阅版本」、#1/#2 历史、以对话形式打开的 AI 按钮，以及无控制台错误。修改正文后点击「Vincular a default-workspace」，输入的文本仍留在编辑器；历史新增 #3（保存）与 #4（关联），按钮变为「此草稿已属于一个 Space」。

`--dsw-*` token 在 `[data-faberloom]` 内解析：`--dsw-font-ui-body` = 13px/20px，`--dsw-control-hit-target` = 44px，深色背景 `rgb(21, 21, 23)` 配 `rgb(249, 250, 251)` 文本，1000×700 下无水平溢出。

移动端用 Playwright 390×844 复现完整编辑器：`scrollWidth` 390 = `clientWidth` 390，无水平溢出，点击目标 44px，正文与新增文本可见，#1–#6 历史与 Space 提示存在，控制台无错误。截图：本目录的 `mail-mobile-editor.png`。

## 限制与独立工作

未使用真实邮箱、模型供应商、凭据或生产环境。移动宽度是 Playwright 的 viewport 模拟，不是物理设备。没有提交或部署。转移保留旧会话并注入有界历史，不复制完整日志。更新与历史仍是两次非事务写入，串行化只按实例验证，不保证跨进程。

以下 T14 工作保持独立且未声明关闭：`faberloom_sources_register` 在结果与日志中返回的摄取 token、按修订重复存储附件字节（需要 content-addressed 存储）、`spaces-ask`、`board-accounts`、`workspace-board` 的失败、`.zip` 安装决策，以及聊天中粘贴凭据的轮换。

附件写入器无法用 `dirfd` 只打开一次目录，因为 Node 不暴露该 API；缓解措施是在每次写入前后比较 `dev`/`ino` 与 `realpath`。剩余的 TOCTOU 窗口需要敌意进程已拥有 workspace 写权限。

下载不再使用 `fetch`：只解析一次、校验全部地址，并用 `node:https.request` 连接获批地址，TLS 使用 `servername`，请求头保留原 `Host`。测试断言 socket 使用 `93.184.216.34` 且不会再次解析，从而关闭经典 DNS rebinding。
