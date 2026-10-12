# Agent Note: Brand FaberLoom with its own type, mark, icons, and theme control

Status: implemented

[English](2026-10-12-faberloom-brand-system.md) | 中文

## Problem

客户端及其 Windows 安装程序在一个 FaberLoom 产品里沿用了上游 DeepSeek 的身份：系统字体栈而非品牌字体、侧边栏与 hero 及官方品牌占位中的鲸鱼标记与字标、产品自有面板行沿用外部图标库、登录界面既没有主题开关也没有请求中的反馈；在 Windows 上，安装程序还带着 NSIS 自带的蓝色向导图形，既不确认卸载，也不提供保留用户数据的选项。

## Decision

`Diseño entrelazado 3x3 Faber-Loom` 中的品牌系统是唯一依据，所有界面都从它渲染。

**字体。** 三款自托管的 OFL 字体承载产品：界面与正文用 Geist，数据、标识符与代码用 Geist Mono，标题与字标用 EB Garamond 斜体。`packages/client/ui-theme/src/styles/fonts.css` 声明它们，并由 `--dsw-font-family`、`--ds-font-family-code` 以及新增的 `--dsw-font-family-serif` 绑定，因此 Web 客户端、桌面内置客户端与 gateway 的无会话页面一起变化。woff2 二进制分别位于 `apps/web/public/fonts`（以 `/fonts/*` 提供）、`apps/desktop/renderer/fonts`（登录前文档从磁盘加载）与 `gateway/assets/fonts`（gateway 以 `GET /fonts/:file` 白名单自行提供），每份旁边都带 SIL OFL 文本。品牌的排版文档还固定了界面字号阶，并将其作为共享 token 发布在 `packages/client/ui-theme/src/styles/app-type-scale.css`（紧随 `base.css` 之后挂载）：app 标题、屏幕标题、面板标签、UI 正文、控件、说明文字、overline 与数据（等宽数字），每项都是一个复合 `--dsw-font-<role>` 加上其字体族、字重、字号、行高与字形伴生变量。该字号阶属于排版而非调色板，在每套主题中都相同：等宽 overline 是唯一的 11px 界面档，`--dsh-content-font-size` 仍留给用户自行调节的会话正文字号；产品的各个界面与侧栏都消费这些 token，而不是各自写死字面值。

**标记与字标。** `packages/client/ui-primitives` 拥有 `FaberLoomMark`——品牌 48 单位面上的 3×3 织结，低于 24px 时收敛为单一织十字——以及双色 `BrandWordmark`：`Faber` 持珊瑚色，`Loom` 取其所在底色的墨色。侧边栏的品牌占位同时使用两者：`sidebar.brand.mark` 用等距图标取代鲸鱼图形，`sidebar.brand.name` 则渲染共享的 `BrandWordmark`（衬线斜体），因此 `Faber` 显示珊瑚色别名，`Loom` 取其所在底色的墨色：浅色调色板上为墨色，深色调色板上为奶油色。`packages/client/ui-theme/tests/themes.client.spec.ts` 在五套调色板上钉住这两个半边，因此调色板改动无法再把字标变成单色。同样的标记与字标取代官方品牌占位与对话 hero 中的鲸鱼图形；hero 原有的鲸鱼游动变形改为品牌那枚珊瑚色实心锚点，在悬停时出现。

**图标。** `packages/client/ui-primitives/src/icons/faberloom.tsx` 在同一套 24×24、描边 1.75 的网格上承载品牌的十个字形与其文档化的标准库（共 45 个）。客户端的侧边栏面板行、Settings 触发器与 hero 都使用它们，使产品自身的界面语言成为一套；品牌文档未描述的外部字形（文件类型、编辑器界面）保留现有图形，另行迁移。

**主题与语言控件。** 登录后的侧边栏脚部通过两个 `sidebar.footer.action` 条目承载产品调色板与界面语言：调色板菜单按配色方案分组列出所有已注册主题，每行带取自该主题自身定义的色样；语言菜单列出已注册的语言，每行带一枚旗帜：英语（美国）、中文（中国）或西班牙语（西班牙），因 Windows 不渲染旗帜 emoji 而绘成内联小 SVG；没有图形的语言则不显示图标。注册这两个条目的是 FaberLoom 产品插件而非其自然归属者 `ui-theme`，因为该座位由 `ui-sidebar` 声明，而 `ui-sidebar` 到达 `ui-layout`，后者到达 `ui-theme`——在该处建立项目引用会形成环，slot 目录也拒绝在第二个包中重复声明同一座位。各自通过自己的服务（`theme`、`locale`）写入，与设置行同一条路径，因此控件与其设置行始终是同一个设置；五套调色板本身是[外壳设计系统笔记](2026-10-12-faberloom-shell-design-system.zh.md)的主题。页脚行的每个控件都在锚点上方请求 tooltip，气泡按 caption 字号（`--dsw-font-caption`）渲染，因此不会压到旁边的控件。桌面登录文档与 gateway 的无会话页面各自带有明暗开关——分别持久化在 `$DSH_HOME/desktop-appearance.json` 与 `localStorage`，默认跟随操作系统——因为尚未登录的用户没有可读取的服务端偏好。

**登录反馈。** 桌面提交按钮与 gateway 登录表单在请求进行中以行内 spinner 标记忙碌状态，并在用户用浏览器返回时重新复位。

**Windows 安装程序。** `apps/desktop/build` 携带由已提交品牌 SVG 渲染的安装与卸载窗口图标、标题标记以及 164×314 向导面板，取代 NSIS 自带的蓝色位图。`apps/desktop/scripts/installer.nsh` 补上引导式流程不会显示的确认，以及点名 `$PROFILE\.dsh` 与应用配置的保留或删除询问，默认保留数据，并在更新的静默卸载中保持静默。

## Alternatives considered

**Google Fonts CDN 链接。** 会失去桌面文档的离线渲染，并给已登录产品增加第三方请求；自托管把三款字体连同许可文本一起放进产物，代价是在各服务面各留一份副本。

**把字标继续做成 SVG 轮廓。** 双色需要构建期的字体转路径步骤；用品牌字体排的实时文本是同一件作品而机械更少，且在字体不可用时仍回退到 Georgia。

**为 hero 织结自制悬停动画。** 品牌把动效留给织造进度状态；珊瑚色锚点是文档化的「en uso」信号，且不需要关键帧。

**一次性重绘全部上游字形。** 品牌文档未描述的字形没有设计来源；在此凭空创作等于在没有决策的情况下撰写品牌图形，因此它们另行迁移。

**沿用 electron-builder 的 `deleteAppDataOnUninstall`。** 它按构建开关静默删除、无法询问用户；该询问需要卸载 hook，因此该开关保持关闭。

**从 `ui-theme` 注册侧边栏底部开关。** 那是该功能自然的归属者，但座位属于 `ui-sidebar`，而 `ui-sidebar → ui-layout → ui-theme` 这条链使项目引用成环；slot 目录也拒绝重复声明同一座位（"SlotMap merges duplicates silently, so the catalog cannot tell which documentation wins"）。因此注册方位于 `ui-theme` 闭包之外——放在本已同时依赖两者的产品插件里——并通过 `theme` 服务写入，而不导入该功能的内部实现。

## Consequences

界面一次性换脸，因此任何按旧字标图形测量的布局都需要自行核对：字标现在是文本加 token 字体，而不是固定 viewBox。桌面、Web 与 gateway 三份字体必须保持字节一致，OFL 文本必须随每份一同分发。侧边栏底部在展开状态下是三个控件共用的一行，因此 Settings 触发器只保留图标，靠悬停提示而非文字标签命名。卸载询问为 electron-builder 加载的每一种语言都做了声明——makensis 对每种缺失语言发出 6040 警告，而 electron-builder 把警告当作错误——`apps/desktop/tests/branding.spec.ts` 现在对此断言，因此新增安装器语言是对 `installer.nsh` 的机械改动，而不是构建期的意外。安装器图形由品牌 SVG 手工渲染；打包冒烟只检查每个文件以 NSIS 所需尺寸存在，而不检查它是否仍与设计源一致。
