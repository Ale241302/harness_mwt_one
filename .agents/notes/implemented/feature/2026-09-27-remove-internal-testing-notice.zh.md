# Agent Note: remove the internal-testing welcome notice

Status: implemented

[English](2026-09-27-remove-internal-testing-notice.md) | 中文

## 问题

`ui-settings-models` 把首个 `settings.onboarding` 步骤注册为一个首次运行的“内测声明”对话框。它带有 DeepSeek 自己的文案，并在用户点击“继续”前阻塞应用（根节点 `inert`），且每当随发布版本变化时又会重新出现。对 MWT.ONE 产品而言，该声明不是产品的声音，每次新会话都不受欢迎。

## 决策

彻底移除该欢迎声明，而不是让它沉睡。

- 删除 `WelcomeNotice.tsx`、`WelcomeNotice.module.css`、`welcome-store.ts` 与 `onboarding-copy.ts`，并从 `ui-settings-models` 移除 `welcome-notice` 槽位注册及其控制器。
- 删除组件与 store 的单元测试、`vitest.config.ts` 中的 `welcome-store` 覆盖率条目、欢迎文案的 locale 键，以及专门的 `remote-welcome` web e2e。
- 从共享的引导 e2e、scaffold 的欢迎镜像与 `welcomeNoticePending` 选项、以及 fixture 清单中移除欢迎步骤，并重新生成客户端槽位目录（`scripts/gen-client-catalog.ts`），使其占用列表不再包含该声明。
- `ui-settings-general` 的宿主半边继续注册通用的 `ui-onboarding` 设置 namespace；只是使用它的欢迎步骤不存在了。

## 考虑过的替代方案

**保留组件注册但不渲染任何内容。** 这会留下死代码及其测试，且未来任何版本号变更都会让它复活；移除该功能可消除歧义。

**中和确认版本。** 隐藏确认会让声明在下次版本变更时再次出现，并把 DeepSeek 文案留在 bundle 中。

## 后果

- 加载时没有首次运行模态框；应用立即可以交互。DeepSeek 凭据引导步骤不变。
- `ui-onboarding` 设置 namespace 仍然存在，但随发布的客户端不再使用它。

## 测试

`packages/client/ui-settings-models/tests` 与 `packages/client/ui-settings-general/tests` 通过（273 项测试），引导名单现在只剩单个 `deepseek-official` 步骤；web e2e 引导场景不再断言欢迎对话框，重新生成的 `slot-catalog.ts` 只列出 `deepseek-official`。
