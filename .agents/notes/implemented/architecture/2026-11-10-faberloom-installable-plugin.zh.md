# Agent Note: FaberLoom 作为可安装 DSH 插件交付

Status: implemented

[English](2026-11-10-faberloom-installable-plugin.md) | 中文

## Problem

`@deepseek-ai/dsh-faberloom-app` 是 workspace bundle。它的 34 个依赖使用 `workspace:^`，包未发布，行内引用只存在于 monorepo 中的包。按包名或本地路径安装插件的 host 无法加载它：`pnpm` 只链接本地目录而不安装其依赖，链接目录又因 Node 解析真实路径而丢失 profile 的 host 包。

## Decision

**打包脚本把已构建 bundle 转为自包含插件。** `scripts/faberloom-portable/package-plugin.ts` 把每个产品包复制到插件内的 `node_modules/@deepseek-ai/<name>`，把 host core 保留为 peer，把外部依赖（`zod`、`@aws-sdk/client-s3`、`@firecrawl/anydoc`）保留为 registry 依赖，并把 `cordis.patch.yml` 的每行改写为该目录树内的相对路径。插件声明 `dsh.bundle.patch`，host 的插件管理器因此接受它。

**相对行让产品留在一个目录内。** `applyEntryPatches` 对以 `./` 开头的 `name` 按 patch 文件解析并转为 file URL。每个内置包因此从插件加载，而其 `@deepseek-ai/cordis`、`schemastery` 等 host 包的裸导入向上走到 profile 链接的 host 树。不打包任何 core 包，只有一份 Cordis 实例。

**插件必须复制，不能链接。** 指向构建目录的 junction 会让 Node 解析到 checkout 下的真实路径，profile 的 host 链接因此不可见。已验证的安装把目录复制进 profile。manifest 保留 `bundledDependencies`，后续 `npm pack` 可携带同一目录树。

## Alternatives considered

**把产品包声明为 `file:./vendor/*` 依赖。** `pnpm` 会链接本地包并跳过其依赖，profile 既解析不到产品包，也解析不到它们的 peer。

**连 core 包一起打包。** 插件会挂载第二份 `@deepseek-ai/cordis` 与 `schemastery`，破坏 service 身份并重复 host 已提供的 runtime。

**先发布再按名称安装。** 发布是独立且未获授权的操作。本地路径已能证明产物与组合。

## Consequences

具有链接 core 包（Desktop 与源码启动器）的 host 可按本地路径安装插件并加载完整产品 UI。插件携带 34 个产品包与 48 个 peer；npm 发布仍需渠道决策，打包 Desktop 的“Add plugin”对话框在通过它安装前仍未验证。更新与卸载属于 host 插件管理器，此处不作声明。

产物按 0.1.8 编译。官方 Desktop 0.2.1 移除了 `providerAccountFailureCode`，因此 `model-catalog` 在 host 提供该助手时调用它，缺失时在本地应用同一规则。目录安装会变成 pnpm 链接，跳过插件的外部依赖；`.tgz` 安装副本并从 profile 根解析 `zod`、`@aws-sdk/client-s3` 与 `@firecrawl/anydoc`。

## Verification

- `pnpm exec tsx scripts/faberloom-portable/package-plugin.ts --out dist/dsh-plugin-faberloom`：34 个内置包、48 个 peer、无 `workspace:` 引用。
- `dsh --profile plugin-test --dump-config`：退出码 0；每个 FaberLoom 行都解析到插件内的 `file://` 路径。
- 该 profile 的真实 web 启动在 `http://127.0.0.1:3080` 无导入失败；页面渲染 FaberLoom 品牌、Mesa de trabajo、Espacios、Archivos、Rutinas、Flujos 与 Correo。
