# Agent Note: A Google model that cannot disable thinking gets its lowest accepted level

Status: implemented

[English](2026-10-23-gemini-thinking-level-floor.md) | 中文

## 问题

会话切到 `google/gemini-3.8-flash` 后，第一条消息就失败：`400 INVALID_ARGUMENT: Thinking level MINIMAL is not supported for this model`。桌面应用与 web 应用表现一致。该提供方账户有余额，同一 harness 上的 Kimi 与 OpenAI 都能正常回答，所以问题不在额度或凭据。

请求没有携带推理档位：用户把选择器留在默认值。`dsh-llm-pi-ai` 在这种情况下省略 `reasoning` 选项，pi-ai 的 Google 适配器把“无推理”解释为“关闭思考”。Gemini 3 Flash 无法完全关闭思考，于是 pi-ai 请求它最低的档位——Flash 系列硬编码为 `MINIMAL`。Gemini 3.7 与 3.8 Flash 已取消 `MINIMAL` 并直接拒绝，因此每个默认档位请求都在模型运行前失败。已安装的 pi-ai 目录仍为这些模型宣称 `minimal`，因为它的条目只把 `off` 映射为 null。

直接调用提供方确认了边界：`gemini-3.7-flash` 与 `gemini-3.8-flash` 对 `MINIMAL` 返回 400，`gemini-3.8-flash` 对 `LOW` 返回 200；`gemini-3.5-flash`、`gemini-3.6-flash`、`gemini-3-flash-preview`、`gemini-3.1-flash-lite` 仍接受 `MINIMAL`。

## 决策

**对于无法关闭思考的 Google 模型，适配器显式发送它接受的最低档位。** `googleThinkingFallback` 只作用于 `google-generative-ai` 与 `google-vertex` 协议。当解析出的模型不支持 `off`，且调用与 profile 都没有指定档位时，适配器发送 `getSupportedThinkingLevels` 报告的第一个档位，而不是省略选项。支持 `off` 的模型继续走 pi-ai 的禁用路径，非 Google 协议不受影响。

**产品声明 Gemini 3.7 与 3.8 Flash 接受什么。** `faberloom-app` 为 `gemini-3.7-flash` 与 `gemini-3.8-flash` 覆盖 `reasoningEfforts: { low, medium, high }`。未声明的档位被固定为不支持，因此选择器里不再出现 `Minimal`，默认请求经适配器回退解析为 `low`，而显式保存的 `minimal` 会在发起网络请求前以 `UNSUPPORTED_REASONING_EFFORT` 被拒。

**提供方的拒绝会让适配器学习。** 当 Google 的 finish 分块在输出任何内容前指出某个 thinking 档位不受支持时，适配器识别该信息，丢弃已暂存的前缀，在本进程中按路由/模型记住该档位，并用下一个受支持的档位重试同一请求。后续请求从被拒档位之上开始，`resolveModelInfo` 也不再提供它。因此，在此版本之后发布的模型即使已安装目录仍宣称厂商已取消的档位，也能在首轮工作；代价是每个进程与模型多一次往返。

## 考虑过的替代方案

**在整个 Google 路由上强制 `reasoning: low`。** 否决：这会改变 Gemini Pro 以及该路由上其他所有模型的默认值，包括那些 pi-ai 自身禁用路径本来就正确的模型。

**修改已安装的 pi-ai 目录。** 否决：`node_modules` 不属于我们，条目会随依赖重新生成，而正确档位正是 profile 已经表达的部署/模型决策。

**只依赖错误重试，而不声明静态下限。** 否决其作为唯一机制：每个进程与模型都要先浪费一次失败请求，选择器仍会提供 Google 拒绝的档位，显式选择也会先把提供方错误暴露出来再重试。静态修正为两个已知边界的模型省去这笔成本；重试覆盖之后发布的模型。

**让用户手动选择 Low。** 否决：默认选择就是失败路径，新会话会在用户得知规则前失败；选择器也仍会提供提供方拒绝的档位。

## 后果

对 Gemini 3.7 或 3.8 Flash 的默认请求会发送 `LOW` 并成功。这两个模型的选择器提供 Low、Medium、High；Gemini 3.0 至 3.6 保留提供方仍接受的 `Minimal`。在此版本之后发布、且目录仍宣称已取消档位的模型，会在一次被拒尝试后成功；该学习只保留在本进程，重启后同样只多一次往返。若厂商更改档位名称且错误文本不再匹配，仍会以提供方消息失败。

## 测试

`packages/llm/llm-pi-ai/tests/adapter.spec.ts` 覆盖两种 Google 协议下的回退、支持 `off` 或非 Google 协议时不回退、`modelOverrides` 暴露的档位，以及一次 400 后成功的端到端重试，后者还证明拒绝对下一次请求被记住。对 `generativelanguage.googleapis.com` 的实时检查固定了上述提供方矩阵。
