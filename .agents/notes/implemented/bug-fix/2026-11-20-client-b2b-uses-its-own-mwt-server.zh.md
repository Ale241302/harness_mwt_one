# Agent Note: A B2B client mounts only its own MWT server

Status: implemented

[English](2026-11-20-client-b2b-uses-its-own-mwt-server.md) | 中文

## Problem

`contabilidad@comercializadoraummie.com.gt`（角色 `client_b2b`）的 Conexiones 面板列出了两个 MWT 服务器：`mwt`（52 个工具）和 `mwt-comercializadora-ummie-s`（53 个工具）。部署内置的 `mwt` 行返回主目录——61 个在售 Marluvas SKU——而客户门户只启用 12 个。助手列出了客户无法订购的产品，同一批工具还以不同前缀出现了两次。

`renderPatch` 为每个账号注入 `mcp-mwt`。B2B 客户还会注册控制台为它配置的 MCP 服务器（`faberloom_mcp_registry.json`，名称 `mwt-<client>`），于是两个表面共存：内置行按客户的 company id 限定但仍读取主目录，客户自己的行则从门户回答。

## Decision

**已有自己 MWT 服务器的客户不再收到内置服务器。** 当控制台角色为 `client_b2b` 且账号的 `faberloom_mcp_registry.json` 中存在以 `mwt` 开头的服务器时，`renderPatch` 跳过 `mcp-mwt` 行。员工账号以及尚未注册服务器的客户保留内置行，因此没有账号会失去 MWT 工具。

## Alternatives considered

**两者都保留，只在面板里隐藏内置行。** 否决：模型仍能看到两个目录、产品不同，并且可以调用任意一个，错误列表仍只差一次工具调用。

**让模型优先使用客户服务器。** 否决：提示偏好不能移除重复的工具，偏好被忽略时主目录仍会回答。

## Consequences

B2B 客户只看到一个 MWT 服务器，即代表其门户的那个，助手不再能引用其启用集合之外的产品。内置行仍是员工和尚未注册自有服务器的客户的回退。自有服务器连接失败的客户在重新连接前没有 MWT 工具；删除其注册表条目即可恢复内置回退。

## Testing

`node --check gateway/server.mjs` 通过。在部署服务器上验证渲染出的补丁：`contabilidad@comercializadoraummie.com.gt` 不再带有 `mcp-mwt`，员工补丁仍然带有。
