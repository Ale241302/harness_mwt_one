# Agent Note: 从 Hero 直接开始对话，无需工作区

Status: implemented

[English](2026-10-14-workspace-less-hero-session.md) | 中文

## Problem

要到达 composer 就必须先选一个工作区。没有选定时，Hero 让 composer 停在「选择一个工作区开始」的占位状态；而在一个工作区都没注册时，选择器会跳过菜单直接打开目录流，因为那时「添加工作区」是它唯一的目标。只想聊天的用户被迫先去接纳一个文件夹。

这个阻塞只在客户端。Host 本来就接受既不指定 Workspace 也不指定 cwd 的 `session.create`，由它自己解析工作目录；会话列表也早已把不属于任何 Workspace 的会话渲染到末尾的 Ungrouped 分组。客户端这边，`ConversationContent` 用 `sessionId === undefined || (hero && chipTitle === undefined)` 派生 `inert`，而所有 `chipTitle === undefined` 的情形都是没有任何 Workspace 归属的会话，于是对一个已经存在的会话仍然显示选择器触发器。

## Decision

**Hero 选择器的首位是一个不指定任何 Workspace 的目标。** 菜单是用户声明新会话目标的唯一位置，所以这一项放在那里：属主提供该操作时，`WorkspacePickFlow` 把它排在最前；该操作经 ui-conversation 的 `conversation.hero.workspace` 属主约定到达（`EmptyWorkspaceOwnerProps.onOpenUnassignedSession`）。文案归 ui-workspace 自己（`menu.startWithoutWorkspace`）。只有属主提供该操作时这一项才渲染，因此侧栏的仅添加界面与目录流的空弹层守卫都保持原状。

**新增一条导航臂，创建调用仍只有一处。** `UiWorkspace.openUnassignedSession(beforeOpen?)` 以无参数调用 `sessions.create()`，由 Host 解析默认目录、不挂任何 Workspace，随后在请求未被后续导航替代时打开返回的会话。它执行与 `openWorkspace` 相同的同步准备回调，而 ui-conversation 的 `main.conversation` inject 让两条臂复用同一个草稿搬运闭包，因此任何一次选定都不会丢掉用户已经输入的内容。

**已存在的会话即可对话。** composer 的 inert 判据改为 `sessionId === undefined`：选定才是物化会话的动作，而会话一旦存在，composer 就是可用的，无论是否有 Workspace 归属。chip 回退到不使用工作区的标签（`hero.noWorkspace`）而不是占位文案，于是这个状态被明确命名，而不是停留在一个无法满足的「选择工作区」提示上。这同时改变了工作区已从侧栏消失的那个会话：它就是一个普通的 Ungrouped 会话，而删除文案本来就已经告诉用户其会话会出现在 Ungrouped 下。对等模型、空白复用与供数通道不变；这是对 [Web 客户端 scope 笔记](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.zh.md) 的细化，放宽了其中「入口可达」的说法。

**不新增任何持久化。** 没有新的会话种类、事件或标记：不使用工作区的会话就是普通会话，只是其记录的 cwd 是 Host 默认目录。列表分组、归档与删除路径都已覆盖它，客户端也没有任何路径能事后把它挂到某个 Workspace 上，因为工作区成员关系在 Host 上只有一个写入方。

## Alternatives considered

**在 composer 里加第二个操作。** composer 本来就持有 inert 的工作区触发器，因此可以再放一个「不使用工作区开始」的控件。否决：选择器本来就是决定目标的菜单，从 chip 和 inert composer 两处都可达，另开一个界面还要重复繁忙与替代规则。

**把 `onPick` 放宽为 `WorkspaceId | undefined`。** 否决：同一个 flow 也服务侧栏的仅添加界面，而那里永远不会产生该目标，共享一个回调会把一个不可能的情形塞进浏览界面的约定。单独的可选回调让两个界面的约定各自精确。

**在列表为空时保留直接跳进目录流。** 否决：空列表恰恰让不使用工作区的目标最有价值；只有添加项是菜单唯一一项时，那个跳跃才说得通。

**像 `connectWorkspace` 复用工作区成员那样，复用已存在的空白无工作区会话。** 未采用：需求是创建；重复选定会留下第二个空白会话，而它的列表可见性已有既定规则（只有当前空白会话显示），归档与删除也走普通路径。

**给不使用工作区的会话加标记，让 chip 能区分它与工作区已删除的会话。** 否决：这只是呈现层面的区分，两者都是 Ungrouped 会话，如今读起来也一样。

## Consequences

什么都没有注册时，Hero 也能开始对话：选择器提供不使用工作区的目标，选定后在 Host 默认目录上打开一个空白会话，composer 立即可用，而 chip 读作不使用工作区的状态。选定与接纳流程不受影响：选择工作区、原生与浏览式的文件夹接纳、仅添加的厂商界面、文件夹错误对话框，以及接纳期间的繁忙门控，行为都与之前一致；侧栏的仅添加界面仍从其唯一入口打开目录流。

代价落在组装 Web 测试通道上：空世界里选择器弹层现在有两行，因此共享的 `connectFreshWorkspace` 辅助函数改为从菜单里选添加动作，而不再直接收到对话框。所有会向 composer 输入内容的场景都经这个辅助函数连接，所以改动只落在一处。

## Testing

`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` 覆盖 Hero 选择器操作触达注入回调并关闭弹层、启动失败时保留选定前状态并告警、不使用工作区的会话保持可对话且 chip 显示其标签，以及功能块仍然作用于这个可用的 composer。`packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` 覆盖注入操作打开该会话并把草稿搬移过去。`packages/client/ui-workspace/tests/workspaces-service.client.spec.ts` 覆盖无参数创建、先准备后打开的顺序、替代与导航属主释放。`packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx` 覆盖首位项、列表为空时的菜单、空的目录流 slot，以及新项上的接纳期间门控。`apps/web/tests/startup-auto-selection.e2e.ts` 启动组装后的 Web 组合，并断言不使用工作区的选项位于 inert Hero composer 所打开菜单的首位。
