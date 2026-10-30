# Agent Note: 主按钮使用专用表面色，而不是品牌珊瑚色

Status: implemented

[English](2026-10-15-primary-button-contrast.md) | 中文

## Problem

米色文字 `#F4F1ED` 配品牌珊瑚色 `#C96442` 的对比度为 3.46:1。14px、字重 600 的文字要达到 4.5:1 才满足 WCAG AA，因此每个把珊瑚色当作标签底色的主按钮都不达标。

有三个已发布界面使用该配色：桌面端的 `apps/desktop/renderer/startup.css`、网关已部署的登录页 `gateway/server.mjs`，以及 `packages/client/ui-theme` 的调色板目录：它为 `--dsw-alias-button-primary-fill` 填入调色板的珊瑚色，并用调色板的画布色作为标签，该组合在 Paper 上为 3.20:1，在 Bond 上为 3.46:1。珊瑚色本身是产品身份色，而字标、焦点环与装饰性标记不承载文字，因此它们不是缺陷所在。

[Desktop 登录界面 Agent Note](../architecture/2026-10-15-desktop-launch-backend-and-sign-in-card.zh.md) 记录过该配色，并保持原样。

## Decision

每个界面都保留珊瑚色作为品牌强调色，并让承载文字的主按钮使用专用的主按钮表面色。

- `apps/desktop/renderer/startup.css` 声明 `--accent-surface: #A24E2C` 与 `--accent-surface-hover: #94472A`，基础 `button` 规则与 `#recovery-submit` 使用它们，而 `--accent` 仍为焦点环与字标保留 `#C96442`。米色 `#F4F1ED` 在浅色表面色上为 5.09:1，在悬停色上为 5.84:1。两个深色块把 `--accent-surface` 设为 `#CD6B4A`、`--accent-surface-hover` 设为 `#D97757`，二者在深色墨色 `#1F1E1C` 下分别为 4.60:1 与 5.34:1。
- `gateway/server.mjs` 的 `AUTH_CSS` 把 `--auth-primary` 设为 `#A24E2C`、`--auth-primary-hover` 设为 `#94472A`；`--auth-coral` 为字标保留 `#C96442`。深色的 `--auth-primary` 仍为 `#CD6B4A`，悬停色仍为 `#D97757`。
- `packages/client/ui-theme/src/theme-palettes.ts` 新增 `coralSurface` 与 `coralSurfaceHover` 两个调色板角色，别名映射把 `--dsw-alias-button-primary-fill` 与 `--dsw-alias-button-primary-hover` 指向它们。Paper 与 Bond 使用 `#A24E2C` 与 `#94472A`；Faber Warm 与 Slate 沿用各自的珊瑚色 `#CD6B4A`，悬停色为 `#D97757`；Ink 沿用 `#D6724E`，悬停色为 `#E08760`。`--dsw-alias-brand-primary`、`--dsw-alias-brand-primary-new-colorprimary-new-color`、链接与焦点环在所有调色板中都保留珊瑚色。

调色板的深色悬停色从 `coralDeep` `#A84F33`（在深色画布墨色下为 3.17:1）改为更亮的珊瑚色；壳与网关在深色主题下本来就用更亮的悬停色。

## Alternatives considered

**直接把强调色本身调暗。** 否决：字标、焦点环与装饰性标记读取同一个 token，且不承载文字；为一个按钮而调暗强调色等于重做品牌色。

**保留珊瑚色，把标签调亮。** 否决：白色配珊瑚色为 3.90:1，在字号不变的前提下没有任何标签颜色能在该底色上达到 4.5:1。

**只修桌面端壳。** 否决：三个界面渲染同一个控件、使用同一套配色，且 [Desktop 登录界面 Agent Note](../architecture/2026-10-15-desktop-launch-backend-and-sign-in-card.zh.md) 已把它们记作一次改动。

**为每个界面新建一套 token（`--accent-primary`、`--auth-submit`、第二个 `--dsw-*` 名称）。** 否决：每个文件已经用同一族命名承载自己的文字表面，Web 客户端主按钮本来读取的别名就是新值的正确归属。

**只按米色标签达到 4.5:1（`#A5502E`）。** 否决：Web 客户端的 Paper 调色板用更暗的画布色 `#EDE8DF` 作为同一按钮的标签，该值对它只有 4.55:1；`#A24E2C` 对两种米色都留有更多余量。

## Consequences

一个浅色主按钮表面色同时服务三个界面，因此品牌改版要在三处修改它。壳的禁用态与焦点环未改动。Web 客户端深色主按钮的静止底色不变，悬停色变亮。

有两个样式表出于同样原因把珊瑚色当作文字底色：`packages/client/ui-faberloom/src/client/faberloom.module.css` 与 `packages/client/ui-faberloom/src/client/mcp-servers-section.module.css` 中的 `.primary` 都用 `background: var(--dsw-alias-brand-primary-new-colorprimary-new-color)` 配调色板画布色标签，在 Paper 上为 3.20:1，在 Bond 上为 3.46:1。两者已在同一轮收口：现在都改用 `--dsw-alias-button-primary-fill` 与 `--dsw-alias-label-primary-foreground`，因此产品里的每个主按钮都使用本决策定义的表层。

## Testing

`packages/client/ui-theme/tests/themes.client.spec.ts` 自行计算 WCAG 相对亮度比，要求每个调色板的 `--dsw-alias-label-primary-foreground` 与 `--dsw-alias-button-primary-fill`、`--dsw-alias-button-primary-hover` 的比值不低于 4.5:1。`apps/desktop/tests/startup-renderer.spec.ts` 在保留的珊瑚色旁锁定壳的两个新值。`test:gui`（418 个文件、5989 个用例）、两个聚焦 spec、`verify-client-ui-i18n` 以及对改动文件的 oxlint 均通过。没有网关 spec 锁定登录页的标记。
