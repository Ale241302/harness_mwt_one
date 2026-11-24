# Agent Note：网关按部署或试点账号打开 Code Mode

Status: implemented

[English](2026-11-24-harness-tools-presentation-switch.md) | 中文

## 问题

基础 bundle 挂载 `tools` 时没有 `config`，所以每个租户都运行 `native` 呈现方式，旁边挂载的 PTC runtime 一直闲置。Code Mode 是部署级选择——一个试点账号可能需要它，而其他账号必须保留现有工具目录——但镜像里没有任何办法在不重新构建、不换 profile 的情况下选择它。`renderPatch()` 在每次 `dsh` 启动前已经写出的每用户 `harness.patch.yml`，是唯一能让一个随部署变化的值只到达某个账号而不影响其他账号的地方。

## 决策

`HARNESS_TOOLS_MODE`（`native`、`both`、`ptc`，默认 `native`）和 `HARNESS_TOOLS_MODE_USERS`（逗号分隔的邮箱；空表示所有人）加入网关的环境配置。`parseToolsMode` 在启动时校验模式，遇到未知值以 FATAL 行 `process.exit(1)`，因为把 `both` 拼错的部署不应该事后才发现试点一直静默运行 `native`。同一个代码块在解析出的模式不是 `native` 且 `PTC_JAIL` 为空时也中止启动：没有隔离笼的 Code Mode 会让模型写的程序面对所有租户的 home，因此绝不能写出这样的补丁。

`toolsModeFor(email, mode, pilots)` 解析单个用户：没有试点列表时返回部署模式，邮箱在列表中时返回部署模式，其余返回 `native`。两侧的邮箱都会去空格并转小写，所以控制台报出 `Ana@MWT.one` 仍能匹配用小写写的列表。

`renderToolsEntry(mode)` 对 `native` 返回空串；否则返回 `- id: tools` / `config:` / `mode: <值>`，随后是 `- id: ptc-runtime` / `config:` / `nodeExecutable: <PTC_JAIL>`。`renderPatch` 把它们插入顶层列表，位于 `- insert:` 块之后、`- id: tool-faberloom` 之前。它重新配置基础 bundle 已经挂载的条目，而不是插入新条目——后者会重复注册表和 runtime。在 `native` 下展开不贡献任何元素，所以试点之外的账号收到的补丁与今天逐字节相同；测试同时固定空串和条件插入。

模式用 `yamlScalar` 加引号，这是该文件对部署提供值的既有约定。

## 备选方案

**修改 `packages/bundle/base/cordis.patch.yml`。** 拒绝：模式会成为镜像的一部分并对每个租户相同，为一个试点改动就需要新构建。

**无效值回退到 `native`。** 拒绝：操作员什么也看不到，试点会在不知情的情况下测量旧目录。

**给每个用户都写这一行，让插件默认值生效。** 拒绝：它给必须与今天保持一致的补丁增加了一行，并掩盖部署是否真的选了模式。

## 后果

操作员在部署 `.env` 中设置两个变量、指定一个可用的 `PTC_JAIL` 包装器，然后重启网关容器，无需重建镜像。这些行会在每个用户下一次 `dsh` 启动时进入其补丁，所以已经在运行的实例会保留原模式直到重启。这里没有任何东西会自行对租户打开 `ptc`：没有 `HARNESS_TOOLS_MODE` 时补丁不含 `tools` 行，没有隔离笼时启动会被拒绝。当前部署还没有可用的隔离笼——bubblewrap 路线需要网关上的 `CAP_SYS_ADMIN`，[隔离笼笔记](2026-11-24-ptc-jail-per-run.zh.md) 已拒绝——所以该变量保持 `native`。

## 测试

`node --test gateway/tools-mode.test.mjs` 通过七项测试：未设置或空的模式解析为 `native` 且不贡献任何行；`both` 和 `ptc` 产生精确的 `tools` 与 `ptc-runtime` 块；列表内的试点获得部署模式，列表外的邮箱保持 `native`；空试点列表把模式应用到所有人；试点邮箱匹配忽略大小写和两侧空格；未知模式抛出；并且随镜像发布的源码读取两个变量、通过条件插入这些行、在 runtime 行写出 `PTC_JAIL`、在其为空时中止启动，并把未知模式导向 FATAL 退出。完整网关无法在单元测试中启动（它需要部署密钥、控制台和 supervisor），因此纯函数从 `gateway/server.mjs` 中切出并直接执行。
