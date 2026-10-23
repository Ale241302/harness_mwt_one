# Agent Note：空间操作从操作者选中的空间开始

Status: implemented

[English](2026-10-22-space-actions-and-add-workspace-start.md) | 中文

## 问题

Workspace 行菜单可以移动、重命名、共享或删除 Space，但不能创建子 Space。Espacios 面板已有该操作，而操作者实际处理文件夹树的侧边栏行没有。要创建子 Space，只能离开行菜单、打开 Espacios 面板，再重新选择父空间。

添加工作区流程还有独立的导航缺陷。原生目录选择器打开在操作系统记住的位置，而不是操作者选中的 Workspace。当父目录内的新文件夹被采纳、新 Workspace 成为当前项后，下次添加会打开在该子目录内；要回到父空间，必须在系统选择器里逐级返回。

## 决定

**Workspace 行菜单通过与 Espacios 面板相同的宿主操作创建子 Space。** `ui-faberloom` 注册一个行菜单项和一个浮层对话框。对话框只收集名称；宿主根据该行的 `workspaceId` 解析其镜像 Space，然后调用 `createSpace(title, undefined, parent.id, true)`。新 Space 继承父上下文，并通过现有创建路径获得自己的 Workspace，因此无需额外刷新协议即可出现在父空间下。没有镜像 Space 的 Workspace 在对话框中报告该情况，而不是猜测父空间。

**添加工作区流程携带选中 Workspace 的起始目录。** `DirectoryFlowOwnerProps` 增加可选的 `startPath`；`WorkspacePickFlow` 从当前会话所属的 Workspace 填入该值。原生流程通过 `uiWorkspace.pickDirectory(startPath)` 和 `directoryPicker/pick` 线协议传递。原生能力在取消信号旁接受起始路径，三种后端都遵守：Windows 在 `Show` 前调用 `IFileDialog::SetFolder`；macOS 给 `choose folder` 添加 `default location (POSIX file ...)`；Zenity/KDialog 以该目录为起点。应用内浏览流程也在同一路径打开。省略路径时保留后端原有默认行为，其他调用方不受影响。

**在侧边栏中创建后保留当前 Space 选中状态。** 添加流程采纳后关闭选择器；仅当此前没有当前 Workspace 时才打开新 Workspace。自动打开子项会让下一次选择器从子项内部开始，正是本变更要消除的循环。子行已经显示在父行下方。

起始目录不存在不是致命错误：Windows 忽略失败的 `SetFolder`，让 shell 使用其记住的位置；浏览对话框报告自己的不可读目录错误。起始路径是便利功能，不是添加 Workspace 的前提。

## 考虑过的替代方案

**在原生文件夹选择器里询问子空间名称。** 选择器可以创建物理文件夹，但 Space 标题和继承上下文选项属于产品；选择器无法以区分取消与冲突的形式报告创建结果。小型产品对话框把校验和失败消息集中在一处。

**从侧边栏复用 Espacios 面板对话框。** 面板对话框还编辑代理、权限、成员和上下文；从行菜单打开会为单字段操作展示无关字段。行菜单保持操作范围狭窄。

**在客户端状态中记住上一个父空间。** 它能修复当前序列，但不符合通用规则：为选中的子 Space 打开选择器时仍应从那开始。从选中 Workspace 推导起始路径是确定性的，并且跨重载有效。

**只改 Windows 后端。** 线协议和浏览后端仍会打开旧位置，同一个界面在不同部署中行为不同。可选起始路径应放在流程契约层，让所有组合一致。

## 后果

`directoryPicker/pick` Remote 方法现在在取消信号前接受 `startPath`。没有目标的内部调用传 `undefined`；生成的 Client 签名对省略可选信号的调用方保持兼容。原生能力的 `pick(signal, startPath?)` 将起始路径记录为可选。

Windows 现在导入 `SHCreateItemFromParsingName` 并使用 IFileDialog 槽 12（`SetFolder`）。解析或 `SetFolder` 失败时回退到对话框默认位置。macOS 和 Linux 仅在有路径时构造起始参数。

空间层级仍由宿主强制：没有父空间 `create-subspace` 权限的受邀者会在对话框中收到宿主失败。侧边栏操作不会扩大授权。

## 测试

`ui-faberloom/tests/workspace-subspace.client.spec.tsx` 覆盖 store 转换、菜单请求、空名称保护、成功创建、失败不关闭和取消。`ui-workspace/tests/workspace-picker.client.spec.tsx` 断言选中的 Workspace 路径进入目录流程所有者，`workspaces-service.client.spec.ts` 断言它进入 Remote 调用。`ui-directory-picker-native/tests/client-flow.client.spec.tsx` 断言原生占用者转发它。`directory-browser.client.spec.tsx` 断言浏览对话框打开时列出请求目录。宿主侧 `native-picker.spec.ts` 覆盖三个平台参数形式，`win32-dialog.spec.ts` 覆盖 worker 负载，`win32-dialog-logic.spec.ts` 覆盖 `SetFolder` 顺序，`win32-dialog-bindings.spec.ts` 覆盖 worker 环境与 COM 调用。`directory-picker.host.spec.ts` 覆盖线协议转发和失败分类。
