# Agent Note: 面板记录在整宽表格之上的对话框中打开

Status: implemented

[English](2026-10-14-panel-record-dialogs.md) | 中文

## Problem

FaberLoom 有四个面板把编辑器放在双列网格中右侧的检查器里：Skills、Mesa de trabajo、Conexiones 与 Contexto。该网格把 `clamp(380px, 38vw, 880px)` 给检查器、剩下的给表格，因此在宽屏上列表只占窄的一半，字段还会折行。第五个一次处理一条记录的面板 Memoria 早已对此给出答案：它的表格横跨整宽，点击行会打开对话框。

同一批界面里还有三处较小的缺陷。Skills 的安装控件（选择文件夹、选择目标、安装）在所有部署中都固定在面板顶部，包括浏览器端，而它选择的文件夹属于宿主而不是操作者。`+ Nueva conexión` 只是清空选择，因此新建连接会打开编辑器上一次持有的那条记录的值。还有两个文件输入标签 `Subir .md` 与 `Importar`，绘制出来比旁边的按钮更高。

## Decision

**记录在整宽表格之上的对话框中编辑。** 这四个面板去掉网格与检查器：表格成为 screen 的直接子元素，点击行会在该包其余十一个对话框已经使用的 `Modal` 原语中打开该记录，创建动作（`Nueva tarea`、`+ Nueva conexión`）以新记录打开同一个对话框。按 Escape、点击遮罩、标题栏的关闭控件以及页脚的 `Cerrar` 都会关闭它，因为那正是该原语自身的行为。这些对话框传入 `panelDialog`（`min-width: min(620px, 94vw)`），因为这些编辑器带双列字段行，而原语的默认卡片宽 380px。`Inspector` 组件与 `split` 网格保留：另外六个面板仍在使用它们。

**新建连接会打开一张空表单。** `startNewConnection` 在打开编辑器之前把每个字段重置为协议默认值（IMAP、端口 993、TLS 开启），因此新记录绝不会继承上一条记录的值。

**安装控件只出现在 Desktop 应用中。** `isDesktopApplication()` 读取 Desktop 预加载注入到应用文档中的 `{ protocolVersion: 1 }` 标记；浏览器没有这样的全局变量。对这个控件而言该标记是诚实的信号：只有文件夹属于操作者自己时，选择文件夹才有意义，而那就是本机 Host。这也意味着网关模式会隐藏该控件，这是正确的，因为在那里 Host 运行在部署端，选择器列出的是容器。

**文件输入标签与邻位对齐。** `.fileAction` 让标签使用 `box-sizing: border-box` 并居中其单行文本。原因是盒模型而不是内边距：用户代理给 `button` 的是 border-box，给 `label` 的仍是 content-box，而工具栏是 flex 容器，其子项被块化，于是共享的 `min-height: 44px` 落在了标签的内容盒上。

## Alternatives considered

**保留检查器，只把它的列加宽。** 促成这次改动的判断是：占着宽度的是编辑器而不是列表。加宽同一条轨道只会让列表继续狭窄，并让双栏的设想原样留存。

**为每条记录做一个详情路由，而不是对话框。** 这些面板已经由一个 `MainPanelId` 寻址、由一个插槽 key 渲染；再加一个导航维度会需要一套路由词汇、一个返回手势和它自己的空状态，而用户到达这个界面的方式只是点击一行、离开的方式只是按 Escape。

**把文件选择器改造成按钮并点击隐藏的 input。** 它能让控件在构造上对齐，但两处调用都需要一个 ref 和一个 click 处理器，而标签本身已经包裹 input，因此任何点击都会让浏览器打开选择器。两处共用一条 CSS 规则是更小的改动，且不触碰行为。

**用构建期标志判断 Desktop 与浏览器。** Desktop 应用加载的是与浏览器相同的构建产物，因此构建期的值无法区分二者；只有预加载不同。

**把表格中被移除的两列改为隐藏而不是删除。** 详情对话框保留了这两个事实（`field.origin`、`field.usedBy`）并有空间渲染它们，因此列表在这件事上不欠用户任何东西。把列作为死条目留下会留下两个没有读者的语言键与两个列定义。

**让 Skills、Conexiones 与 Contexto 也在其对话框中创建。** Contexto 已经从表头创建，而 Skills 的上传控件在设计里是工具栏动作。把它们搬进对话框，等于为一个屏幕已经能用一次手势完成的事情再加一个对话框。

## Consequences

四个面板的列表都获得整宽，记录字段也获得一张为其尺寸而设的卡片。Skills 表格让出的两个事实（来源、使用者）现在只出现在详情对话框中，它们的两个语言键已从三本字典中删除。

代价是点击行不再留下一个常驻面板：读一条记录再读另一条现在需要两次点击和一次关闭，而检查器此前是就地替换。每个面板的页脚都把破坏性动作与其主操作分开：Conexiones 与 Contexto 把 `Eliminar` 放在最前、`Guardar` 放在最后，而模态框自身的关闭控件又重复为 `Cerrar` 按钮，这正是 Memoria 的对话框此前的做法。

## Testing

`packages/client/ui-faberloom/tests/registration.client.spec.tsx` 增加五个用例：两列的技能表格且旁边没有网格、技能在对话框中打开并带来源与使用者字段、浏览器中不出现安装区块而设置标记后出现、连接编辑器从按钮打开为空表单并从行打开为该记录且能保存该记录，以及任务与上下文条目各自在对话框中打开。该测试台补齐了这些面板所需的桩（`contextEntries` 及其同类、`modelCatalog`、`mcpTokens`、`grants`、`backups`、`shares`、技能动作），因为此前没有用例渲染它们。

`packages/client/ui-faberloom/tests/registration.client.spec.tsx` 与该包其余十个测试文件全部通过（106 个用例），`tsc -b packages/client/ui-faberloom` 干净，oxlint 干净，`verify-client-ui-i18n` 干净。

高度修正是**在真实浏览器中测量**的，而不是推理出来的：一个带有工具栏自身规则探针页测得该标签修正前 64px、修正后 44px，且与旁边两个按钮的顶部和底部一致。没有组装浏览器（Playwright）场景覆盖这些面板，因此这份浏览器证据是那个探针，而不是产品点击流；对话框行为由上述 jsdom 用例固定。
