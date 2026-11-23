# 智能体笔记：MCP 服务器采用输入的名称，并保留一个纯标识符

Status: implemented

[English](2026-11-23-mcp-server-name-derives-identifier.md) | 中文

## 问题

“新建连接”对话框要求输入的名称符合 `[A-Za-z0-9_-]{1,32}`，字段说明也重复了同样的规则。负责人填写了类型、URL 和凭据，输入 `MCP Hostinger` 后点击保存，却读到 `Connection failed: faberloom-mcp-registry: server name "MCP Hostinger" must match /…/`。名称是显示上的选择；那套文法属于 MCP 客户端拼装工具名所用的命名空间。表单把后者当成了前者的规则。

## 决定

### 由一个推导函数拥有标识符

`packages/client/ui-faberloom/src/client/connections.ts` 中的 `mcpServerId` 把输入的名称变成保存的标识符。已经符合标识符文法的名称保持不变，因此像 `hostinger-email` 这样已保存的服务器保留其命名空间和工具名。其他名称先去掉变音符号，再删除 ASCII 字母和数字之外的每个字符，然后截断到 32 个字符。只有结果为空才算无效：即名称中既没有字母也没有数字。

### 两个 MCP 界面都推导并显示它

“连接”对话框和 MCP 服务器设置页通过同一个函数校验并保存，因此名称不会再因为形状被拒绝。连接测试与工具列表使用推导出的标识符，因为每个公开工具名携带的正是这个命名空间。当推导改变了输入文本时，名称字段会显示该标识符，负责人在点击保存前就能看到服务器将以什么名称保存。

### 注册表仍然拒绝不可用的名称

MCP 注册表中的 `validateServerName` 未改动。直接访问注册表的调用方不得创建 MCP 客户端无法挂载的命名空间，那里被拒绝的名称仍会指出它违反的文法。

## 考虑过的替代方案

**接受带空格的原样名称。** 否决：该名称就是工具名命名空间（`mcp__<name>__<tool>`），MCP 客户端的文法不支持空格。

**把每个分隔符替换成连字符。** 否决：这仍然要求负责人了解标点规则，而这正是要解决的问题。

**在标识符旁保存一个显示名称。** 暂缓：持久记录会新增一个被所有界面读取的字段，表格、设置列表和连接测试都需要优先使用它。推导标识符现在就能消除拒绝；独立的显示名称是另一项改动。

## 后果

“连接”表格和设置列表显示保存的标识符，即 `MCPHostinger` 而不是 `MCP Hostinger`，因为并没有保存单独的显示名称。归约为同一标识符的两个名称指向同一个服务器：保存第二个会替换第一个，这与一直以来保存已存在标识符的行为一致。

## 测试

`vitest run packages/client/ui-faberloom/tests/registration.client.spec.tsx packages/client/ui-faberloom/tests/mcp-servers-section.client.spec.tsx` 覆盖了：自然名称按其推导出的标识符保存、推导结果为空的名称为无效、以及说明结果的提示。`tsc -b tsconfig.client.json` 通过。
