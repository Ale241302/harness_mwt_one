# Agent Note：永久删除会话

Status: implemented

[English](2026-09-25-session-delete.md) | 中文

## 问题

会话只能归档，无法删除。存储会永久保留每一代记录，侧边栏也没有办法移除用户不再需要的对话——尤其是“未分组”只能逐行隐藏，而被删除 Space 留下的会话也无从清理。

## 决策

会话持久层新增永久 `delete`，会话控制器把它暴露为一条带明确生命周期闸门的破坏性 Host 命令。

- `packages/session/session-persistence` 增加 `SessionPersistence.delete(id, options)`，返回 `boolean`。基类实现以具名错误拒绝，使未实现该能力的后端（以及继承该服务的测试替身）保持诚实，而不是假装删除成功。
- `packages/session/session-persistence-jsonl` 覆盖它：`findLog(id)` 定位存储目录，整个目录被删除，冷日志缓存条目被丢弃。删除只移除产物，绝不重写或快照。
- `SessionCommandController.delete({ sessionId })` 对任何在本进程中仍存活的会话（`ctx.sessions.get(id)`）以 `session/busy` 拒绝，然后删除该会话以及所有由它分叉出的会话。通过 `header.parentSession` 让子会话排在其父会话之前，使部分失败时绝不会留下指向已消失父会话的子会话。
- `SessionCommandController.deleteOrphans()` 删除所有记录在案的 `cwd` 未解析到任何已注册工作区的会话。存活会话被跳过而非拒绝，磁盘上已不存在的 `cwd` 视为无归属。
- `@Remote('delete')` 与 `@Remote('deleteOrphans')` 承载这两条命令；生成的 Client 接口由 Typert 构建自动产生。
- `WorkspaceRegistry.forgetSession(id)` 从内存中的 header 与路径索引里移除已删除的 id，使看板无需等待重建索引即可停止列出它。持久化的归档集合保持不变：已删除的 id 再也无法解析。

Client 数据层与 Host 对应：`ISession.delete()` 是 1:1 动词，`ISessions.deleteOrphans()` 在 Host 应答后重新投影列表，`SessionManager` 为每个返回的 id 记录一次 `remove` 列表变更。侧边栏在会话行 `…` 菜单中提供“删除会话”，位于浏览器自有的确认对话框之后；并在未分组分组头部提供“删除所有未分组”操作。

## 考虑过的替代方案

**中止正在运行的回合并强行删除。** 在存活写入者之下删除存储会与重放和工具输出竞争；拒绝能让破坏性路径保持同步且诚实。

**保留分叉出的子会话。** 父行已无法解析的子会话会在用户正清理的同一个未分组桶里表现为丢失的孤儿，因此级联删除才是唯一不留残留的结果。

**从归档列表删除已归档会话。** 归档有意保持可恢复；永久删除是在可见行和未分组桶上单独的、需要确认的操作。

## 后果

- 删除会话不可逆；确认对话框和“删除所有未分组”对话框都如此声明。
- `session/busy` 是会话控制器上新的 Remote 错误码。
- 任何界面中打开的会话在被关闭前都无法删除；Host 会报告是哪个 id 忙。

## 测试

`packages/api/session-controller/tests/commands-delete.host.spec.ts` 覆盖子会话先行的级联、不删除任何内容的存活拒绝、跳过存活与属于工作区会话的孤儿选择，以及缺少持久层时的拒绝。侧边栏删除菜单、其确认闸门和未分组头部操作由 `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` 覆盖。`packages/session/session-persistence-jsonl` 的生成套件在新的覆盖实现之上保持通过。
