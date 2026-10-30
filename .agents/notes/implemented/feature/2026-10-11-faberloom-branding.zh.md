# Agent Note: FaberLoom product branding

Status: implemented

[English](2026-10-11-faberloom-branding.md) | 中文

## Problem

该 fork 此前使用 **MWT.ONE** 品牌（见已归档的 [MWT.ONE product branding](../../archived/feature/2026-09-28-mwt-one-branding.md) 与 [MWT.ONE browser title](../../archived/feature/2026-09-28-mwt-one-browser-title.md) 笔记）：浏览器标签、favicon、Web manifest、侧边栏与 hero 标记、以及 gateway 的登录 favicon 都是 MWT.ONE。产品名是 **Faberloom**；MWT.ONE 是产品对接的控制台，不是产品本身。

## Decision

产品品牌为 `Faberloom`，Web 应用与 Desktop shell 同时生效；部署主机 `harness.mwt.one`、以及所有对 MWT.ONE 控制台、其 MCP 与其权限的引用保留原名。

- `apps/web/index.html` 设置 `<title>Faberloom</title>` 并把 favicon 指向 `/faberloom_favicon32.svg`；`apps/web/vite.config.ts` 的 `DEFAULT_CLIENT_TITLE` 同步，且 `scripts/deploy-vps.sh` 传入 `DSH_CLIENT_TITLE="Faberloom"`，使部署构建在 `ui-layout` 的 `AppFrame` 重算标题后仍保持该标题。
- `apps/web/public/manifest.webmanifest` 将应用命名为 `Faberloom`，并列出 `faberloom_appicon512.svg`（maskable）与 `faberloom_favicon32.svg`（any）。四个随附资源 —— `faberloom_isotipo_dark.svg`、`faberloom_isotipo_mono.svg`、`faberloom_favicon32.svg`、`faberloom_appicon512.svg` —— 位于 `apps/web/public/`。
- `ui-faberloom` 的 `FaberloomBrandMark` 把这两个 isotipo 文件渲染进 `sidebar.brand.mark` 与 `conversation.hero.brand.mark`，由 CSS 在 `body[data-ds-dark-theme]` 上切换 `faberloom_isotipo_dark.svg`（米白）与 `faberloom_isotipo_mono.svg`（墨黑）。`brand.name` 与 `brand.localBuild` 在所有语言下都是 `Faberloom`，因为品牌名不翻译。
- 产品强调色为 FaberLoom 橙 `#c96442`，设置在 `ui-theme` 的 `design-platform.css` 两个主题块的 `--dsw-alias-brand-primary-new-colorprimary-new-color`。该 token 驱动产品界面的按钮、选中标签、链接、焦点环与 Work Flow 强调色；语义化的 `--dsw-alias-state-success-*` 绿色保持绿色。
- gateway 从 `gateway/assets/faberloom_favicon32.svg` 提供 `/favicon.ico` 与 `/faberloom_favicon32.svg`，其登录页与公司页链接该文件。
- Desktop 的 `productName` 与 `artifactName` 为 `Faberloom` / `faberloom-${version}-${os}-${arch}`，其 shell 文案（启动、更新、插件窗口）在两种语言下都读作 `Faberloom`。

## Alternatives considered

**保留 MWT.ONE，不做改动。** 否决：产品名是 Faberloom；标记与标题是每个界面上最显眼的身份。

**保留按主题切换的 PNG 标记，只改文字。** 否决：随附 SVG 是品牌自有资源，缩放清晰，且无需按主题重新光栅化。

**连 MWT.ONE 控制台与其 MCP 引用一并改名。** 否决：MWT.ONE 是产品对接的独立系统；改其控制台、MCP 服务器与权限词表会让代码谎报它所调用的对象。

**按界面分别设置品牌（Web 与 Desktop 各一）。** 否决：一个产品一个品牌；Desktop 加载同一客户端，不能与 Web 不一致。

## Consequences

所有用户可见的品牌表面 —— 标签标题、favicon、manifest、侧边栏、hero、gateway 登录 —— 在 Web 构建与 Desktop 中都读作 Faberloom 并使用橙色强调色。MWT.ONE 控制台、其 MCP 工具、其权限字符串与 `harness.mwt.one` 主机保持不变。想要自有标记的部署覆盖同样的 slot 与同样的 public 文件即可。未挂载 `ui-faberloom` 的纯 `apps/web` 构建会在上游 harness 标记旁显示 `Faberloom`，直到部署挂载 faberloom profile。

## Testing

`packages/client/ui-faberloom/tests/registration.client.spec.tsx` 断言侧边栏品牌读作 `Faberloom`；`packages/client/ui-sidebar`（root spec 与快照）、`packages/client/ui-layout`、`packages/client/locale` 与 `apps/desktop/tests`（含 `expected/startup-*.txt` 文档）承载新文案。`apps/web/tests/pwa-manifest.e2e.ts` 与 `apps/web/tests/built-boot.expected.e2e.ts` 断言来自 `apps/web/dist` 的构建 manifest 与本地构建标签。
