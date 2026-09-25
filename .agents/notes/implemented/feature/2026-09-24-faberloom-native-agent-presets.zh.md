# Agent Note：ECC 智能体作为 dsh 原生 preset 发布

Status: implemented

[English](2026-09-24-faberloom-native-agent-presets.md) | 中文

## 问题

ECC 目录此前是作为技能导入的，因此其中的智能体变成了“把指令注入某一步”的用户可调用技能，而不是可选择的 agent 组合。团队希望把 ECC 智能体变成真正的 dsh 智能体：一个在会话开始前选定、以该智能体自身的人设与工具集组合出来的会话。

## 决定

为每个 ECC 智能体生成一个 dsh agent preset，并把它们播种进每个用户的名册。

- `agents-shared/<id>/` 存放 `agent.cordis.yml`——随发行版交付的 `standard` 组合的副本，只把 persona 的 `prefix` 换成 ECC 智能体正文——以及带显示名、描述与顺序的 `preset.yml`。
- `writeUserPresets(home)` 在实例启动时把 `agentsSharedRoot`（`/opt/agents-shared`）复制到用户的 `<DSH_HOME>/.agent-presets`，由 `dsh-agent-presets` 的 `includeUserRoot` 发现；已存在的用户 preset 不会被覆盖。
- Dockerfile 把 `/opt/agents-shared` 打进镜像，`push-to-vps.ps1` 上传 `agents-shared/`。

## 考虑过的替代方案

**从零编写每个 preset。** 复用已知可用的 `standard` 组合、只替换 persona，能让每个生成的 preset 都可加载，无需重新推导工具、技能、压缩与委派等行。

**配置一条部署级 `roots`。** 它需要在每用户补丁里覆盖基础的 `agent-presets` 行；用户根是受支持的扩展点，且无需合并行。

**按 ECC 的 `tools:` 字段裁剪每个 preset 的工具。** 映射（`Read`→`read`/`read_image`，`Grep`/`Glob`→`grep`/`glob`，`Bash`→`bash`，`Web*`→`web`）已经就绪，但错误的行会把整个 preset 标记为损坏；本版本保留标准工具集，把裁剪留作后续。

## 后果

- 每个 ECC 智能体都是可选择的 preset，区别在于 persona 而不是工具集。
- 选择器中会与 `standard`、`ptc`、`cordis`、`minimal` 一起出现这 68 个 preset 行。
- 播种的 preset 是用户根副本；编辑它们是本地的，并会保留到被删除为止。

## 测试

校验器确认全部 68 个生成的组合都能解析，并带有 persona 前缀与 preset 元数据。网关播种在实例启动时运行，并由部署冒烟覆盖；实机会话确认某个 ECC preset 可被选中并以它的 persona 启动。
