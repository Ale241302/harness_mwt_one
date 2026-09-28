# Agent Note: MWT.ONE 产品品牌

Status: implemented

[English](2026-09-28-mwt-one-branding.md) | 中文

## 问题

已部署的 fork 仍然带有 harness 自身的身份：浏览器标签写着“DSH Local Build”，favicon 是 DSH 的 svg，侧边栏与空白对话的 hero 显示的是 harness 的标记，侧边栏品牌名写着“faberloom”。而产品是 MWT.ONE。

## 决策

- `apps/web/index.html` 设置 `<title>Harness MWT.ONE</title>` 并把 favicon 指向 `/brand-dark.png`；`apps/web/vite.config.ts` 的 `DEFAULT_CLIENT_TITLE`（以及它在构建产物 HTML 中替换的字符串）随之更新，因此构建出的文档保留该标题，除非 `DSH_CLIENT_TITLE` 覆盖它。web manifest 的 name、short name 与 icon 一并更新。
- 两个随发布的 logo 文件放在 `apps/web/public/`：`brand-dark.png`（白色 swoosh，用于深色主题）与 `brand-light.png`（绿色，用于浅色主题）。
- `ui-faberloom` 把 `FaberloomBrandMark` 注册进 `sidebar.brand.mark` 与 `conversation.hero.brand.mark`，在这两处替换 harness 的标记。组件同时绘制两张图片，并由 CSS 依据 `body[data-ds-dark-theme]` 切换，因此无需运行时读取 DOM 即可跟随主题。
- `brand.name` 的 locale 值在所有语言中均为 `MWT.ONE`（品牌名不翻译）。
- gateway 从 `/brand-dark.png` 提供登录页 favicon（该文件随 `gateway/assets/` 发布），登录页与公司选择页都链接它。

## 考虑过的替代方案

**保留 DSH 标记，只改标题。** 标记是每个界面上最显眼的身份；保留它会与名称相矛盾。

**在 gateway HTML 中以 data URI 内嵌 favicon。** 无需文件即可工作，但会让源码膨胀数 KB 的 base64 并复制该资源；改为提供随发布的 PNG 可保持单份副本。

## 后果

- 所有用户可见的品牌界面——标签标题、favicon、侧边栏、hero、登录页——都是 MWT.ONE。
- 标记跟随主题：深色为白，浅色为绿。
- 图片由 app 的 public 根目录与 gateway 的资源目录提供；若其它部署想要自己的标记，覆盖相同的槽位与相同的 public 文件即可。

## 测试

`packages/client/ui-faberloom/tests/registration.client.spec.tsx` 断言侧边栏品牌名现在读作 `MWT.ONE`；ui-faberloom 套件通过（28 项测试）。gateway 的 HTML 与路由改动由 `node --check` 构建门禁与部署冒烟覆盖。
