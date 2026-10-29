---
description: "The Mesa severity classifier over ctx.llm: a deployment-mounted faberloomBoardClassifier with a declared provider and model."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-classifier-llm

English | [中文](README.zh.md)

## Summary

The board applies its deterministic severity rules first and asks the `faberloomBoardClassifier` port only for an item the rules did not resolve (A-04, W-37). This package provides that port over the harness LLM seam: one `ctx.llm.stream` call with a declared provider and model, one strict JSON answer, and no throw into the board.

`classifySeverity` never decides the item: it returns a proposal with its confidence, a `timeout`, or an `invalid` answer. The board applies its confidence floor and caches the decision under the full §5.1 key, whose model segment is this row's `modelVersion` (`<provider>/<model>@v1`). A missing key, an unreachable provider, a wrong severity, or an out-of-range confidence all leave the item with `severity: null`; the item still enters the queue.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row where `ctx.llm` is available and the board is mounted.

```yaml
- id: faberloom-classifier-llm
  name: '@deepseek-ai/dsh-faberloom-classifier-llm'
  config:
    provider: deepseek-official
    model: deepseek-chat
    timeoutMs: 3000
    maxTokens: 200
```

`provider` and `model` name a registered route and change the cache identity; `timeoutMs` bounds one classification (the board caps it at 3 s as well); `maxTokens` bounds the answer. The bundle mounts the row by default and reads `FABERLOOM_CLASSIFIER_PROVIDER`, `FABERLOOM_CLASSIFIER_MODEL`, and `FABERLOOM_CLASSIFIER=0` from the environment.

The prompt carries only what the board already permits this provider to read: artifact type, account reference, content hash, and the summary truncated to 4 000 characters. The answer must be one JSON object with `severity` in `LOW|MEDIUM|HIGH|CRITICAL` and `confidence` in `0..1`; anything else is `invalid`.

## Model Experience

### Classification calls

#### What the model sees

One system instruction (the severity vocabulary and the JSON answer contract) and one user message with the item's type, account, hash, and summary. No tool schemas, no session history, and no fields above the item's data class ceiling.

#### Token effect

One auxiliary call per uncached classification: at most 4 000 summary characters in, at most `maxTokens` (200 default) out. A cached answer, a deterministic rule, or an unavailable provider spends no tokens.

#### KV Cache effect

Independent of the conversation: the call carries its own two messages, so it neither reads nor extends a session's prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The classifier reads the summary, not the artifact** — the board hands it the text the data class permits, so a proforma whose meaning lives in its line content is classified from its summary. A model that needs more input would require a data-class decision.
- **No token accounting is published** — the board caches the decision, not the usage; the provider route's own metering remains the source for cost.
- **The answer is not retried** — one call per classification: a malformed answer stays `invalid` and the item is unclassified. A retry policy would multiply provider calls inside the board's 3 s budget.
