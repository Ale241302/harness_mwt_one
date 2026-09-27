# Agent Note: space memory outlives its origin

Status: implemented

[English](2026-09-27-memory-outlives-its-origin.md) | 中文

## 问题

“记忆”面板用原始 space id 列出空间记忆行，把每条记录整封邮件/文档正文渲染进行内（行高达数百行），并且没有办法删除条目。删除一个 Space 会让这些 id 悬空，于是表格对来源已不存在的条目显示出无法阅读的 uuid。

## 决策

空间记忆是知识，不是子行：它在来源 Space、Workspace 或对话片段被删除后依然保留，只有显式操作才会移除。

- `FaberLoomSpaces.remove` 删除空间记录及其文件，绝不删除其记忆行；`forgetMemory(actor, id)` 是唯一的删除路径，并拒绝删除他人拥有的条目。
- `faberloomView.deleteSpaceMemory(id)` 遗忘一条记忆并返回刷新后的列表。
- 面板把每个记录的 space id 解析为标题，并在空间已不存在时渲染 `(espacio eliminado)`，使来源读起来像历史而不是 uuid。
- 表格改为全宽四列——单行文本摘要、类型标签（Correo / Documento / Nota）、空间名称、日期。点击某行打开弹窗，显示全文、其空间、其日期和 **删除记忆**；删除说明指出移除记忆不会改变来源的邮件、文档或空间。

Teachings 注册表保留：它是邮件声音画像读取的、带版本且可撤销的纠正与指令存储，与旁边的 agent 记忆行是不同的东西。

## 考虑过的替代方案

**随 Space 级联删除记忆。** 会销毁 Space 消失后所有者可能仍需保留的知识；记录的来源是历史，不是外键。

**保留原始 space id。** 无法阅读，而且掩盖了空间已被删除这一事实。

**保留侧栏检查器就地截断。** 检查器把表宽减半，且仍显示完整正文；弹窗释放了宽度，并承载全文与删除操作。

## 后果

- 记忆行可能无限期引用已删除的空间；面板会标注它们，其它地方不再把它们解析为存活空间。
- 删除 Space 不再有丢失其记忆的风险，但想清除它的用户必须在“记忆”面板逐条（或全部）删除。

## 测试

`packages/faberloom/view/tests/email-actions.spec.ts` 覆盖 `deleteSpaceMemory` 遗忘条目并返回刷新后的列表。`packages/client/ui-faberloom/tests/registration.client.spec.tsx` 覆盖空间名称解析、已删除空间标签、摘要行以及从弹窗删除。
