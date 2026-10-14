# Agent Note: 桌面后端选择持久化在 Harness home

Status: implemented

[English](2026-10-14-desktop-backend-choice.md) | 中文

## Problem

桌面端此前只凭一个进程环境变量 `DSH_DESKTOP_GATEWAY_URL` 决定后端，并默认指向 `harness.mwt.one` 上的共享网关。因此打包安装会继承启动它的进程恰好带有的值，而出厂默认又让应用成为某个服务器的客户端：应答的宿主运行在部署端，它的 Workspace 是服务器上的文件夹，发送者自己的磁盘不可达。运营需求恰恰相反。应用运行在操作者自己的电脑上，它的 Workspace 就是这台电脑上的文件夹。

## Decision

**桌面端启动两种后端之一，并记住启动的是哪一种，记录由操作者持有。** `apps/desktop/src/backend-choice.ts` 读写共享 Harness home 中的 `desktop-backend.json`：一条非机密 JSON 记录，内容为 `{"mode":"local"}` 或 `{"mode":"gateway"}`，与 `desktop-appearance.json`、`desktop-locale.json` 完全一样地经由临时同级文件原子写入。`resolveBackend(dshHome, environment)` 是唯一的解析步骤。启动环境优先于该文件，该文件优先于出厂默认，而出厂默认现在是本机 harness。

**三种环境状态，而不是两种。** `apps/desktop/src/gateway.ts` 保留环境变量名、出厂网关源，以及 `resolveGatewayRequest`，它把单个字符串无法区分的请求分开：变量未设置时是 `kind: 'none'`，由已保存的选择决定；变量为空时是 `kind: 'local'`；变量带有 URL 时是 `kind: 'override'` 及该源。`DEFAULT_GATEWAY_URL` 仍是出厂网关的唯一出处，因此写有 `gateway` 的记录跟随部署，而不会钉住操作者点击当时生效的某个 URL。

**环境一旦表态，后端就由它掌管。** 在设置了该变量的安装中，`dsh-desktop:backend-selection-get` 报告 `{ mode, fixed: true }`。登录界面隐藏其后端分组并说明是哪种条件固定了它，应用菜单也禁用两个后端点。`dsh-desktop:backend-selection-set` 在该状态下拒绝切换，并对照出厂两种模式校验请求，因此渲染进程无法写入一个会被环境忽略的选择。

**切换会重建应用窗口。** `BrowserWindow` 在创建时即固定其会话分区，因此 `switchBackend` 会停止正在运行的后端、记录选择、销毁窗口并创建新窗口，也就是此前窗口关闭后已在使用的那条替换路径。网关模式在 `persist:gateway` 中加载远程源，窗口承载已登录用户的 Space、会话与产品模块；本机模式在默认分区中加载壳自有页面。操作者从登录界面的后端分组触达切换，全新安装就在那里遇到它；也可从应用菜单的 **Backend** 组切换，那是网关模式下唯一存在的入口，因为该窗口属于远程源。菜单会指明目标后端并请求确认，因为两种后端展示不同的数据。

## Alternatives considered

**只保留环境变量作为唯一选择器。** 该变量对操作者不可见，无法从应用中更改，每次重新指向网关都需要改动启动器。它被保留下来，因为部署或开发运行有正当理由固定后端，而它现在是优先级最高的请求，而不是唯一的请求。

**让已保存的选择优先于环境。** 设置了该变量的开发运行会悄然输给几个月前写入的记录，而这正是保存的偏好本应避免的失败。显式的进程设置在启动时到达，因此也不会像文件那样过期。

**重载窗口而不是重建。** `webPreferences.partition` 在创建之后无法更改，而把带分区的窗口复用于本机 harness 会把网关的 cookie 带进壳自有页面。重建窗口与 `focusPrimaryWindow` 在窗口已不存在时执行的正是同一操作。

**切换后要求操作者自行重启应用。** 重启会为了更改一个偏好而丢弃正在进行的真实工作，而应用早已能在不结束进程的情况下停止后端，因此切换比操作者所需少一步。

**把网关源存进记录。** 钉住 `https://harness.mwt.one/` 的记录会让安装继续发往 fork 可能已经放弃的源。操作者选择的是后端，不是 URL，因此 URL 保持为部署数据。

**把每次安装的记录放在共享 Harness home 之外。** 外观与语言已经放在那里，同一套单实例规则也在守护该目录。第二处位置会让操作者的桌面偏好有两个存放地。

## Consequences

全新安装启动本机 harness 并触达操作者自己的文件夹，而想要共享界面的操作者选择一次网关后即可保持。两种后端保有各自的数据，登录界面说明会写明这一点，菜单确认也会重复它，因此存在于一个后端上的 Workspace 不会出现在另一个上。网关模式保持了“前端或后端变更通过部署服务器生效”这一性质，本机模式则从打包运行时取前端，这正是 `apps/desktop/README.md` 所陈述的发布规则。

代价是多了一个桌面偏好文件、一个菜单分组，以及每次切换都要重建窗口：应用会回到登录界面或网关自身的登录页，任何打开的会话视图都会被丢弃。由部署设置该变量的安装则完全从操作者手中收回了切换权。

桌面端自有页面仍带着一处本次改动未触及、已确认的对比度失败：主按钮在品牌强调色 `#C96442` 上绘制 `#F4F1ED`，实测 3.46:1，未达到该字号文本所需的 4.5:1。同一组合也出现在网关登录页与 `packages/client/ui-theme` 中，因此需要在那些界面上一并修改，而不是只在壳里修补。

## Testing

`apps/desktop/tests/backend-choice.spec.ts` 覆盖记录往返、未写入的 home、损坏记录、未知模式、本机默认、已保存的网关，以及环境优先于文件。`apps/desktop/tests/gateway.spec.ts` 覆盖三种环境请求。`apps/desktop/tests/main-startup.spec.ts` 用临时 Harness home 驱动壳，覆盖本机默认、把已保存的网关源载入 `persist:gateway`、固定状态及其被拒绝的切换、被拒绝的未知模式、切换到网关并重建窗口，以及返回本机模式。`apps/desktop/tests/startup-renderer.spec.ts` 覆盖两个按钮、被标记的选择、点击时发出的请求、西班牙文标签，以及被隐藏的分组及其说明。
