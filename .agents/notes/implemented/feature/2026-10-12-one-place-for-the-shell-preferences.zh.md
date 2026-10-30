# Agent Note: One place for the shell's preferences

Status: implemented

[English](2026-10-12-one-place-for-the-shell-preferences.md) | 中文

## Problem

登录后的外壳把它的两项偏好放在侧边栏脚部：`packages/client/ui-faberloom` 把调色板菜单与界面语言菜单注册为紧挨 Settings 控件的两个 `sidebar.footer.action` 占用者，各自通过自己的服务写入。这让每项偏好在其设置行之外多了一个家，让脚部承载三个控件，而 owner 只想要一个入口；还把两个菜单的 locale 键与旗帜美术留在产品插件里，而不是留在拥有调色板的主题功能与拥有语言的 locale 功能里。用户可以从两个随后必须保持一致的地方设置同一个偏好。

## Decision

**侧边栏脚部只承载 Settings 控件。** `packages/client/ui-faberloom` 不再向 `sidebar.footer.action` 注册任何内容：它的调色板菜单、语言菜单、其背后的 store 接线与 locale 键，以及该插件曾持有的旗帜美术都已移除，因此脚部唯一的占用者是 `ui-settings` 的 `sidebar.settings` 控件，它打开 Settings 模态框。`ui-sidebar` 无需改动：`sidebar.footer.action` 是一个 `list` 席位，空列表不贡献宽度，而脚部的规则——每个图标控件保持自身尺寸，标签先让出该行空间并在自己的控件内截断——保持不变。

**调色板选择就是 Apariencia（外观）行的列表。** `ui-theme` 的 Apariencia 行列出已注册的调色板，按品牌的深色与浅色两个家族分组（深色在前），每行一个色样，取自该调色板定义自身的 token——底色取 `--dsw-alias-bg-base`，强调色取 `--dsw-alias-brand-primary`——并标记当前生效的调色板，即快照的 `active.id`，而不是持久化的偏好。`system` 仍是持久化的默认值，仍通过操作系统（`prefers-color-scheme`）在默认那一对之间解析；它自身没有行，因此全新安装显示它解析到的调色板，点选某一行即固定该调色板。

**界面语言是一个 Settings 分区。** `ui-theme` 注册一个 id 为 `language`、order 为 25 的 `settings.section` 贡献。其闭合控件显示当前 locale 的旗帜与一个不显示可见文本的 chevron；其列表显示每个 locale 用自己的语言写下的名称，并标记当前项。三面旗帜——英语、中文、西班牙语——是 `packages/client/ui-primitives`（`LocaleFlag`）里的小型内联 SVG；它们能放在那里，是因为功能插件不得运行时导入或再导出另一个功能插件的值；没有图形的 locale 仍渲染带名称的行，只是没有图标。locale 包不再注册自己的 `settings.general.item` 行，因此界面语言的选择只存在一处。

**产品组合禁用两个设置行，而不是删除它们的包。** `packages/bundle/faberloom-app/cordis.patch.yml` 对 `ui-settings-models` 与 `ui-settings-unarchive-sessions` 两行设置 `disabled: true`，这两个包仍由其他部署交付，因此本产品的 Settings 导航承载 General、Complementos（插件）、Presets de agente（Agent 预设）与 Idioma（界面语言）；`packages/client/ui-settings-general` 把 `language` 分区 id 映射到地球图标。接受随之而来的后果：Modelos 曾是唯一可以录入部署级提供方密钥的界面，而这些密钥现在来自环境（`.env`，包括 `<NAME>_FILE` 形式）与每个 agent 自己的密钥字段。

## Alternatives considered

**保留脚部的两个控件。** 脚部菜单本已建成且在每个界面都能触达，但 owner 要求一个入口，而紧挨 Settings 的两个条目让每项偏好都保留着第二个家。

**把语言行留在 General 分区。** locale 包自己的行本已写入同一个偏好，但它重复了选择，并把语言的名称显示为文本，而 owner 想要的是当前 locale 的旗帜。

**删除两个设置包，而不是禁用它们的行。** 这两个包仍由 web-app 组合挂载，也能服务于其他部署，因此产品覆盖层只移除它们的导航行，把包留在仓库里。

**把旗帜美术留在 `ui-faberloom`。** 美术必须随语言选择移入 `ui-theme`，而客户端 bundle 纯净性门禁禁止一个功能插件导入或再导出另一个插件的值；`ui-primitives` 是每个功能插件都可使用的共享包，因此 `LocaleFlag` 放在那里。

**在调色板中列入一行「跟随系统」。** `system` 仍是持久化的默认值，也仍通过操作系统解析，但 owner 只要求调色板，因此列表没有这样一行，而是标记 `system` 解析到的那个调色板。

## Consequences

外壳的调色板与界面语言各自只在一个地方选择，即 Settings 模态框，侧边栏脚部只剩一个控件。全新安装保持 `system`，并显示它解析到的调色板；点选某一行固定一个调色板，界面语言在闭合控件与其列表行中都显示当前 locale 的旗帜。两项选择仍通过它们早已使用的服务写入，因此主题或语言包无需新路径，locale 包的界面少一行。

代价是：导航列不再显示这两项偏好，想查看或更改调色板或语言的用户要打开 Settings。两个设置包留在仓库中，在本产品里导航行被禁用，部署级提供方密钥从环境或 agent 自己的字段录入，而不是从某个页面录入。
