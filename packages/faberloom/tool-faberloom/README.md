---
description: "Model-facing product tools (faberloom_spaces_create, faberloom_spaces_list) over the native FaberLoom service modules of this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-faberloom

English | [中文](README.zh.md)

## Summary

This package registers the model-visible product tools that read and write the native product services. This slice exposes the space tools over `ctx.faberloomSpaces`; the set grows with the domain slices.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.tools` and the product services are present. The tools register on the calling plugin's fiber and disappear with it.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`faberloom_spaces_create` and `faberloom_spaces_list` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-faberloom).

#### Token effect

Both tool schemas ride every request while the package is mounted; their results are ordinary text blocks.

#### KV Cache effect

Adding or removing a tool changes the tool block, which can invalidate reuse from the first altered token.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Spaces slice** — the tools cover the spaces service over `ctx.faberloomSpaces`; the other product domains arrive on later slices.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
