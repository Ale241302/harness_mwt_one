---
description: "dsh Web 客户端的主题与正文字号设置：--dsw-* token 样式表、ThemeRuntime 状态、「通用」设置行与插件前引导。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-theme

[English](README.md) | 中文

## 概述

`dsh-client-ui-theme` 提供五套调色板——三套深色（`dark` = Faber Warm，默认；`slate`；`mono`）与两套浅色（`light` = Paper，默认；`cloud`）——并解析当前生效的一套；`system` 在默认两者之间跟随 `prefers-color-scheme`。用户在「外观」列表中选择调色板、在「语言」分区中选择界面语言，并设置会话正文字号（12 至 17 px）；回环客户端让每个选择都跨重启持久化。本包发布不可变的 `ThemeSnapshot`，提供 `--dsw-*` token 样式表，注入同步引导，并通过 `ctx.theme` 接受第三方别名 token 主题。本包发布不可变的 `ThemeSnapshot`，提供 `--dsw-*` token 样式表，注入同步引导，并通过 `ctx.theme` 接受第三方别名 token 主题。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用户从设置（「通用」分区）的「外观」列表中选择调色板、从「语言」分区中选择界面语言，字号行就在它们旁边；在回环浏览器上，每个选择都会跨重启持久化。功能插件通过 `ctx.theme` 消费当前快照，并在 CSS 中读取 `--dsw-*` token；它们不自行管理主题状态。

### 外观与字号

插件在「通用」分区注册「外观」调色板列表与字号步进器。列表按配色方案族展示每一套已注册调色板，深色在前；每行预览该调色板自身的底色与强调色，并标记当前生效的一套。这里没有「跟随系统」条目：`system` 仍是全新安装的持久默认值，通过 `prefers-color-scheme` 解析，列表只标记它解析到的那套调色板；点击任意一行即固定该调色板。步进器接受 12 至 17 px 的整数，默认值为 14 px。它以相同增量调整会话标题与基础文本，包括用户气泡与 composer 草稿；流内行的标题、摘要与表格跟随比正文低一档的字号，小号文本和代码保持固定字号。每次通过的变更都经 Host settings API 写入。连续快速变更按操作顺序携带命名空间 revision 串行写入，最新写入被拒时重新加载持久值。无论 loopback 还是远程，每个已认证页面都让两个选择由 Host 支撑。

### 界面语言

「语言」分区从共享 locale 服务渲染界面语言选择：收起控件显示当前语言的旗帜与打开列表的 chevron，列表每一行带该语言的旗帜与它自己的名称，并标记当前语言。旗帜作为共享品牌美术放在 ui-primitives 中，因此功能插件无需 import 另一个功能插件的值即可使用；语言包新增而没有图形的语言仍有带名称的行。选择语言经 `ctx.locale.setLocale` 写入，与 locale 功能自身行的路径一致。

### 注册主题

组合可以通过 `ctx.theme` 注册带别名 token 覆盖的第三方主题 id；覆盖层按注册顺序折入活动快照的 token 中。移除其中一个绝不会覆盖最后一个持久化的内置偏好。第三方主题 id 仍是进程内扩展，不会跨越内置 settings schema。

### 插件前调色板

当主机组合包含 HTTP 服务器时，宿主侧会把已注册的 `ui-theme` 设置或 schema 默认值嵌入每份 index 响应。head CSS 会在任何脚本运行前用所选调色板自身的底色与配色方案绘制画布；`system` 以及本构建不认识的 id 退回中性的浅/深配对，并使用 `prefers-color-scheme` 查询。随后，body 脚本依据该调色板的方案设置 `body[data-ds-dark-theme]`，并在加载页面和应用脚本之前设置 `--dsh-content-font-size`，因此首帧绘制就采用所选调色板与字号。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

服务拥有主题与字号状态并发布快照。ui-layout 展示转换器应用这些快照，token 样式表则拥有颜色与会话文本尺度。

### 样式表

`src/styles/` 下有八张样式表，由 ui-theme 的动态客户端 entry 依次导入：`fonts.css`、`base.css`、`app-type-scale.css`、`corner-shape.css`、`design-platform.css`、`scrollbar.css`、`gradient-shadow-text.css` 与 `shiki.css`。客户端 bundle 将其编译并注入为插件持有的全局样式，因此卸载与 HMR（热模块替换）会随 ui-theme 一同移除。`scrollbar.css` 是 `--dsw-alias-scrollbar-*` token 的唯一消费方，必须排在声明这些 token 的 `design-platform.css` 之后。

`app-type-scale.css` 把品牌的 app 字号阶发布为共享界面角色（app 标题、屏幕标题、面板标签、UI 正文、控件、说明文字、overline、数据），每个角色是一个复合 `--dsw-font-<role>` 简写加上 `-font-family`、`-font-weight`、`-font-size`、`-line-height` 与 `-font-style` 伴生变量。字号阶属于排版而非调色板，因此在每套主题中都相同：这些 token 只声明在 `:root` 上，没有任何调色板区块覆盖它们。它逐字转录自品牌排版页（「03 · APP」小节）；`--dsh-content-font-size` 仍是用户可自行调节的会话正文字号，不受影响。

`corner-shape.css` 平滑所有圆角：在 `@supports (corner-shape: superellipse(1.5))` 内定义 `--dsw-corner-shape`，并通过通配选择器应用到所有元素及其 `::before`/`::after`，因此不支持 `corner-shape` 的引擎保持普通圆弧。正圆形状——`border-radius: 50%` 的圆与胶囊半径——因超级椭圆会使其变形，须在所属组件样式表中把 `corner-shape: round` 与半径声明配对；corner-shape 样式表 spec 跨全部包样式表强制这一配对。

`gradient-shadow-text.css` 从 `--dsh-content-font-size` 派生 `--dsh-content-font-delta`，并以该增量移动 Markdown 标题与基础文本阶梯。它同时派生低一档变量 `--dsh-content-font-size-secondary`（设置 ≤14 时为设置值 −1，>14 时为设置值 −2；默认设置下为 13 px）及配套的 `--dsh-content-font-delta-secondary`，供表格变体与比正文低一档的流内行使用。紧凑的小号文本与代码变体保持固定字号。阶梯之外，用户气泡与 composer 草稿直接读取正文字号变量对，流内行的标题及摘要读取低一档变量对。该表还持有阴影阶（`--dsw-shadow-lv*`）与 elevation token：`--dsw-elevation-stroke` 经可重绑的 `--dsw-elevation-stroke-color` 画 0.5 px 发丝描边，`--dsw-elevation-panel`/`--dsw-elevation-prominent`/`--dsw-elevation-soft`（composer 专用的更大模糊、更低透明度档）在描边之上叠两层极淡柔光，因此高层级表面设 `border: 0`，不再有占布局的轮廓；派生 token 逐元素重声明，使表面对描边色的重绑真实生效。

### 滚动条重新绑定

`scrollbar.css` 在 `body` 上把 `--dsh-scrollbar-thumb` 与 `--dsh-scrollbar-thumb-hover` 绑定到 l1 基础表面 token；高层级表面（菜单、浮层、对话框）在自己的容器上把它们重新绑定为 l2 token；这组变量的另一个合法目标是 `transparent`（ui-sidebar 在指针不在栏内时就这样重新绑定自己的列）。WebKit 系浏览器还会读取 `--dsh-scrollbar-width`、`--dsh-scrollbar-thumb-border` 与 `--dsh-scrollbar-track-margin`；滚动表面可重新绑定它们，在较窄的可见滑块外保留较宽的拖动区域，或让轨道避开圆角两端。两条渲染路径在构造上互斥：Firefox 走 `@supports not selector(::-webkit-scrollbar)` 内的标准细滚动条，WebKit 系引擎走伪元素，因此几何与 hover 定制只经由伪元素路径生效。

### 偏好持久化

在 loopback 浏览器上，服务先以 schema 默认值立即提供自身，随后加载 `ui-theme` 命名空间，并把每次通过的主题或字号变更经 Host settings API 写入。收到推送的设置变更时或重连后都会重新拉取该命名空间。无论 loopback 还是远程，每个已认证页面都会创建该 Host 支撑的 scope。该持久化边界由 [Host 支撑的偏好笔记](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.zh.md) 与[远程页面设置笔记](../../../.agents/notes/implemented/architecture/2026-10-23-host-settings-on-remote-pages.zh.md) 拥有。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖布局展示转换器、token 消费方与样式规则。

- [ui-layout](../ui-layout/README.zh.md)——应用解析后主题快照的展示转换器。
- [ui-sidebar](../ui-sidebar/README.zh.md)——滚动条重新绑定约定的消费方。
- [ui-conversation](../ui-conversation/README.zh.md)——为 composer 席位消费 `--dsh-scrollbar-width` 的消费方。
- [Web 样式](../../../docs/web-styling.zh.md)——Web 客户端组件的权威样式规则。
- [Host 支撑的偏好](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.zh.md)——持久化边界决策。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义主题扩展表面与颜色权威；它们是当前包约束。

- **第三方主题是扩展点，不是产品**：注册主题意味着覆盖同名别名变量；目前不会验证一组覆盖是否完整。
- **持久化为 `system` 时没有对应行**：全新安装（或从未固定调色板的安装）保持 `system`，它通过 `prefers-color-scheme` 解析；因此「外观」列表标记解析到的那套调色板（浅色系统下为 Paper，深色系统下为 Faber Warm），而不是系统条目，点击任意一行即固定该调色板。
- **token 样式表是颜色值的唯一权威来源**：设计系统中缺失的值会有意不补入；一律采用最接近的语义 token，设计负责人批准的新增值须在同一变更中以一个静态尺度层级与一个语义别名的形式进入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。settings scope 校验并发布持久 theme section，注册表与自身变更同步发出 `theme/change`；存储与注册表的一致性由本包针对 Host、scope 与服务行为的测试直接覆盖。
