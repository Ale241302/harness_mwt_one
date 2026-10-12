---
description: "Web GUI 的外壳布局：三栏 AppFrame、其 54px 顶栏与响应式栏杆制度、面板几何服务与主题呈现；供窗口外壳的使用者与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

## 概述

本包提供 Web GUI 的外壳框架：位于三栏 AppFrame 之上的 54px 顶栏、左右栏宽度与 `ctx.layout` 呈现控制。右栏先让步以保护中栏空间，全屏由占用方呈现，框架保留宽屏底层轨道。低于平板断点时，两条栏杆离开文档流：左栏变为离屏抽屉，右栏浮盖在中栏之上；低于手机断点时，中栏即整页。主题呈现器负责配色、别名 token、正文字号与 document 元数据；布局状态在刷新后重置。

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

本插件在 root slot 中组合顶栏、侧边栏、主内容与右栏。侧边栏宽度为 264～420px，默认为 280px，在宽屏制度下收起后保留 56px 控制栏；打开右侧面板会收起手动展开的侧边栏。右侧面板首次打开时使用视口宽度的 45%，之后保留用户的像素宽度偏好，上限为 70%。为给中栏保留 400px，框架先将右侧面板缩减至 300px，再报告空间不足，使占用方将其关闭，最后才进一步压缩中栏。拖动没有过渡延迟；右侧手柄在关闭或全屏时不显示。

全局面板占据 root 作用域的 `main` keyed slot；`conversation` 是为会话界面保留的 key。`ctx.layout.selectPanel(id)` 选中已注册面板，`null` 则选中会话界面，但不改变当前会话。默认组合不注册任何全局面板。

### 顶栏

框架在各栏之上渲染一个 `header`：高 54px，底部为发丝分隔线，永不换行。左端是两枚栏杆开关，各自只在对应栏杆有占用方挂载时出现，并带有 `aria-expanded` 与本包 `layout` 字典提供的本地化 `aria-label`。左开关驱动布局存储（宽屏时收起列，窄屏时切换抽屉覆写）；右开关隐藏并恢复框架对右栏的渲染，面板自身的展开记录仍归其占用方所有。顶栏其余部分由三个座位填充：

- `shell.topbar.brand`——由唯一占用方渲染产品自己的标志与名称；该座位没有回退，未注册的品牌不占任何空间。
- `shell.topbar.center`——外壳的搜索/命令入口。框架只声明这个空位，在有包填入之前不渲染任何内容；这里刻意不提供回退控件。
- `shell.topbar.actions`——由各包自行拥有的工具栏控件列表（预算标签、主题按钮、状态药丸等），按列表顺序渲染在右端。

### 响应式制度

制度取决于框架自身测得的宽度，而非窗口：桌面应用经常处于浮动、缩放或分屏状态。达到或高于平板断点时，三栏保持文档流布局，顶栏位于其上。低于该断点时，两条栏杆离开文档流：侧边栏变为离屏抽屉（滑入、遮罩、Escape、打开时把焦点移入抽屉并在关闭时交还给开关，关闭期间 `aria-hidden`），右栏不再保留轨道，其面板因此浮盖在中栏之上而不是挤压中栏。低于手机断点时，中栏即整页，抽屉是唯一的导航方式；顶栏的开关保持可点且不换行。布局在 360px、768px、1024px 与 1440px 下都不会产生横向滚动，跨越断点会清除抽屉覆写，不会残留状态。

### 主题呈现

呈现器消费解析后的主题快照，并投影到 document：`html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，把主题的别名 token 与 `--dsh-content-font-size` 设为 body 上的内联变量，并持有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新。对呈现器执行 dispose（资源释放）时，它会连同其他全局写入一起移除自己的元数据节点。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`selectPanel(id)` 在改变选中态前检查实时 `main` 注册表；缺失的 key 会抛错并保留当前面板。`beginNavigation()` 为异步 UI 导航返回 abort signal。后续调用、有效面板选择（包括重复选择）或布局释放会中止该 signal，但不取消底层会话创建。消费方在提交导航或搬移草稿前检查 signal。

一次注册声明子 slot（三个栏、框架级浮层与顶栏的品牌、中央、操作三个座位），并绑定 `ctx.layout` 的 `selectPanel`、`toggleSidebar`、`openRightbar(track, fullscreen)` 与 `closeRightbar`。同一次注册的 inject 面把当前哪些栏杆有占用方发布为私有可观察对象，接到框架的 `useRails` selector hook：没有占用方的栏杆不显示开关，也不占空间。顶栏各座位做了 memo，无关的框架重渲染不会重新派发它们。同一个 root 存储把 `panelInfo` 选中态与 `layoutInfo` 测量、宽度偏好、呈现报告分开。`usePanelInfo` 订阅引用稳定的选中态对象，AppFrame 订阅引用稳定的布局对象。`rightbar` owner 提供实际 `width`、`viewportWidth`，以及表示能否以普通模式呈现的 `canShow`；占用方在空间不足时执行确定性的收起，变宽不自行重新展开。全屏隐藏宽度手柄，但不自行释放占用方要求保留的轨道。三种响应式制度由测得的框架宽度推导（`shellRegime`），抽屉的打开状态就是存储里既有的窄屏覆写，因此跨越断点只会清除它一次。AppFrame 保持各列容器挂载。右栏的 root 控制器仅在选中会话界面时，经 `SessionProvider` 渲染 `rightbar.session`；内容卸载时的报告释放轨道。独立的标题组件仅在会话界面可见时使用所选会话标题，以构建配置的产品标题或本地化 `brand.localBuild`（本包的 `layout` 字典会继续查共享的 common 词汇表）为回退值；语言变化会更新该回退值。主题呈现器是第二个 effect：从解析后的快照做纯 DOM 写入——初始状态经 getter 读取一次，此后仅事件驱动，不经过 React。它先应用调色板、字号与 token 变量，再把渲染出的背景测量为唯一的颜色依据。全屏呈现禁用网格和手柄过渡；占用方完全覆盖框架后才报告新的列布局。退出全屏时，框架先保持无过渡并安装目标布局：关闭移除右轨道，恢复保留右轨道。后续普通几何操作恢复正常过渡。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当布局面不够用时阅读以下页面。它们从框架进入它所渲染的栏与它所呈现的主题。

- [ui-sidebar](../ui-sidebar/README.zh.md)——占据 `sidebar` 栏及其座位。
- [ui-conversation](../ui-conversation/README.zh.md)——占据 `main` 中的 `conversation` key。
- [ui-sidebar-right](../ui-sidebar-right/README.zh.md)——以每会话一个停靠面占据 `rightbar` 栏。
- [ui-theme](../ui-theme/README.zh.md)——呈现器消费其解析快照的主题 seam。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前布局行为。它们是当前包约束，不是通用窗口管理器对比或任务积压。

- **面板几何是瞬时状态**——重新加载会恢复侧栏默认值并隐藏右侧面板；拖动设置的宽度是整个框架共用的一份偏好，而非每个会话各自的属性。
- **右栏的顶栏开关只影响呈现**——面板是否展开是占用方的记录事实；框架的开关只隐藏并恢复自己对栏杆的渲染，绝不改写该记录，因此占用方收起过的面板在栏杆重新出现时仍保持收起。
- **极窄窗口**——在宽屏制度下，右侧面板关闭后中栏仍可能小于 400px，此时旁边是 56px 控制栏；低于平板断点时两条栏杆改为离开文档流。
- **轨道与面板沿同一条曲线运动**——框架的轨道过渡和占用方的滑入读取同一组时长与缓动变量；占用方若自用一套，挤压时面板边缘就会与会话界面的边缘脱开。
- **挤压重排期间无滚动锚定**——布局变化可能移动读者的视口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。外壳中 `ctx.layout` 背后的浏览状态存储不发出 Cordis 事件；clamp 与轨道的时序由本包各栏与服务规格直接断言。
