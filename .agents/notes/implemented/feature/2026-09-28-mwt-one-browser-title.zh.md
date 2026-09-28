# Agent Note: the deployed browser title reads Harness MWT.ONE

Status: implemented

[English](2026-09-28-mwt-one-browser-title.md) | 中文

## 问题

MWT.ONE 品牌化改动之后，部署的标签页仍然显示 "DSH Local Build"。那次改动设置了 `apps/web/index.html` 的 `<title>` 与 `apps/web/vite.config.ts` 的 `DEFAULT_CLIENT_TITLE`，而它们只负责初始文档标题。React 挂载后，`ui-layout` 的 `AppFrame` 会用 `process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')` 重新计算 `document.title`；部署构建未定义 `DSH_CLIENT_TITLE`，于是标签页回退为本地化的 "DSH Local Build"，并覆盖了静态标题。

## 决策

`scripts/deploy-vps.sh` 向运行 `pnpm run build` 的 builder 容器传入 `-e DSH_CLIENT_TITLE="Harness MWT.ONE"`。客户端构建本就把 `DSH_CLIENT_*` 当作公开产物输入（`client-build-environment.ts` 将每个值内联进 Vite 与 tsdown 产物），因此这一个环境值会同时到达静态文档与挂载后的 `AppFrame`。正如 `ui-brand-official` 的 README 所述，浏览器标题属于构建环境，而不是 locale 或 slot 覆盖。

## 考虑过的替代方案

**改 `brand.localBuild` 的 locale 字符串。** 该键命名的是本地构建，且是 app-frame 与侧边栏的回退值；改它会给每个非品牌化构建贴上错误标签，并使标题与侧边栏品牌名脱节。

**在 `AppFrame` 中回退到 vite 的 `DEFAULT_CLIENT_TITLE`。** 这两个常量按设计本就不同：一个是文档标题，另一个是未挂载外壳的回退值。环境值正是两者共同读取的唯一来源，定义它即可保持一致，无需新增耦合。

## 后果

- 部署的标签页显示 "Harness MWT.ONE"，选中会话时显示 "会话标题 — Harness MWT.ONE"。
- 未设置 `DSH_CLIENT_TITLE` 的构建（普通的本地 `pnpm run build`）仍显示 "DSH Local Build"，这正是预期的本地构建标签。
- VPS 的 `.env` 与 compose 栈不受影响：该值是传给持久化 builder 的构建参数，而非运行时配置。

## 测试

以 `DSH_CLIENT_TITLE="Harness MWT.ONE"` 构建 `@deepseek-ai/dsh-client-ui-layout`，确认 `lib/client.js` 内联了 `const productTitle = "Harness MWT.ONE";`。`packages/client/ui-layout` 的 app-frame 与 document-title 测试已覆盖 `DSH_CLIENT_TITLE` 分支与回退值。
