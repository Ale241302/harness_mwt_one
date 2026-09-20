---
description: "The native product-module bundle: mounts the FaberLoom service rows and their model tools as the last patch layer of the faberloom profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-faberloom-app

English | [中文](README.zh.md)

## Summary

This bundle carries `cordis.patch.yml`, the patch layer that mounts the native product service rows and `@deepseek-ai/dsh-tool-faberloom`. The `faberloom` profile composes it after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`, so the served harness carries the product modules as first-class rows.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

### Mounted rows

#### What the model sees

Nothing directly: the bundle mounts the product service rows and `@deepseek-ai/dsh-tool-faberloom`, and that tool package owns the model-visible schema.

#### Token effect

Zero direct tokens; the mounted tool package contributes its schemas.

#### KV Cache effect

Independent: the patch layer itself never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Mounts the skeleton rows** — the product services carry their surface only until the domain slices land.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
