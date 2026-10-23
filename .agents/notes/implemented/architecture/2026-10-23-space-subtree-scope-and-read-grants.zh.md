# Agent Note：Space 会话读取其整棵子树，且只读取其子树

Status: implemented

[English](2026-10-23-space-subtree-scope-and-read-grants.md) | 中文

## 问题

某个 Space 中的会话只知道其工作目录所属的那一个 Space。`faberloom-session-agent` 注入该 Space 的代理 persona 与指令，`agent-instructions` 从工作目录向上加载 `AGENTS.md`。没有任何东西暴露其下的子 Space：它们的记忆、精选上下文、代理、技能、`AGENTS.md`、`.agents/`、`.claude/` 或文件。因此 Costa Rica 中的会话无法使用 Sondel 或 Muitowork Limitada，尽管两者都是 Costa Rica 的子 Space；父级 Marluvas 中的会话也无法聚合其子级。叶子 Space 中的会话也没有办法向用户请求兄弟 Space 的读取权限；唯一的跨 Space 工具只返回上下文与文件元数据，从不返回文件夹或其文件。

反向也存在缺口：`faberloom-session-agent` 对没有负责代理的 Space 提前返回，因此这样的 Space 根本没有会话组合或作用域。

## 决定

**可读作用域就是 Space 子树。** `faberloom-session-agent` 读取会话的 Space、每个可读后代以及任何已授予的子树，并安装一个 `faberloom:space-scope` 系统提示段落，排在记忆与跨 Space 规则之后。每个节点携带其绝对文件夹、记忆、精选上下文条目、负责代理、技能名称、harness 产物（`AGENTS.md`、`.agents/`、`.claude/`、`.claude/skills/`）、文件夹顶层条目以及 `AGENTS.md` 文本。该段落在每个轮次的第一个步骤重新计算；没有变化时逐字节相同，因此未变化的轮次仍保留提示前缀。

**没有负责代理的 Space 仍获得其作用域。** Space 解析与代理组合分离。没有 `agentId` 的 Space 安装作用域段落并保持部署 persona；有代理的 Space 两者都安装。

**子树之外只列名，不可读。** 该段落在“其他 Space”下按标题与 id 列出其他可读 Space，但不给出文件夹。`faberloom_spaces_open_read` 通过 `ctx.approval` 询问用户一次，记录一个 `faberloom/space-read-grant` 仅日志事件，并把被授予的子树加入作用域。已经在 `danger-full-access` 下运行的会话会直接记录授予而不弹出提示：该常驻模式本就授权用户自己的文件操作，而授予更窄（仅读取）。受限预设会询问，并在拒绝或通道不可用时失败关闭。授予通过重放跨越恢复，且限定在该会话内。spaces 服务会在显示任何批准之前拒绝行为身份不可读的 Space，因此授予绝不会扩大产品访问。

**守卫与作用域一致。** `read`、`read_image`、`write`、`edit`、`glob`、`grep`、`bash` 与 `pwsh` 在执行前检查：位于作用域之外 Space 文件夹下的路径会被拒绝，并提示使用 `faberloom_spaces_open_read`；shell 命令按 token 扫描绝对或相对的外来文件夹拼写。位于任何 Space 之外的路径仍像以前一样可读。会话沙箱根之外的写入仍由沙箱决定；授予不改变该根。

**父→子方向由层级授权，而不是由共享授权。** 后代可读，是因为它是行为身份在 spaces 域中可读的后代。它没有被共享、发布或复制；无法读取某个子 Space 的成员不会通过其父级获得它。

## 考虑过的替代方案

**只做向上的继承，正如 `inheritContext` 已经做的。** 否决：这与所需行为相反。父级必须聚合其子级，子级不得看到其兄弟。

**从文件系统解析后代，而不是从 `parentId`。** 否决：嵌套在另一个文件夹中的文件夹不一定是产品子 Space，且产品已经拥有层级。Spaces 面板在加载时把遗留的物理嵌套修复为 `parentId`，因此记录是权威的。

**在默认提示中完整渲染每个后代的 `AGENTS.md`、`.agents/*.md` 与技能正文。** 否决：深树会在用户问题之前耗尽上下文窗口。作用域携带受限摘要与产物路径；模型在任务需要时读取具体文件。

**新增一个感知 Space 的文件系统后端。** 否决：读取守卫属于产品作用域，而不属于通用的 `ctx.fs` 接缝；第二个后端会重复沙箱。产品工具与 shell 命令是模型使用的表面；沙箱继续负责写入。

**让授予永久有效或按身份生效。** 否决：用户要求在对话中激活权限。会话事件是仍能跨越恢复的最窄持久记录。

## 后果

Marluvas 中的会话自动读取 Costa Rica、Colombia 及其后代。Costa Rica 中的会话读取 Sondel 与 Muitowork Limitada，但不读取 Colombia。Muitowork Limitada 中的会话只有在用户批准 `faberloom_spaces_open_read` 之后才能看到 Sondel；授予在该会话余下时间内覆盖 Sondel 及其后代。没有负责代理的 Space 保持部署 persona，且仍读取其子树。

作用域文本有字符与 Space 上限（`maxScopeChars`、`maxScopeSpaces`），因此非常大的树会带明确提示截断，而不是让轮次失败。在授予之前，通过文件工具读取外来 Space 会被拒绝；混淆后的 shell 命令仍可能到达同一个用户自有文件，因为 shell 不是沙箱边界，包 README 已将其记录为已知限制。在轮次中创建或重命名 Space 会在下一个轮次出现在作用域中。

## 测试

`packages/faberloom/session-agent/tests/session-agent.spec.ts` 覆盖父级子树、不含兄弟的子 Space 子树、授予扩大作用域、后代的 harness 文件、无负责代理时的作用域，以及针对绝对与相对外来路径的文件工具守卫。`packages/faberloom/tool-faberloom/tests/spaces-scope.spec.ts` 覆盖 `faberloom_spaces_scope`、无需批准打开作用域内的 Space、作用域外 Space 的批准路径、拒绝、缺少批准通道，以及产品访问拒绝。
