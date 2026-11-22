---
kind: upgrade-guide
description: "faberloom_mail_attachment_link returns a storage key instead of a URL containing the console credential."
---

# `faberloom_mail_attachment_link` no longer returns a credentialed URL

English | [中文](guide.zh.md)

## Change

The tool previously returned `{ url, key, name }`, and `url` embedded `CONSOLA_TOKEN` as a query parameter. That placed a live credential in the model-visible tool result and the durable Session log. It now returns `{ key, name }`. The rendered text names the key and tells the owner to download the file from console storage.

The upload itself is unchanged: it still sends the attachment bytes to the configured console storage as the signed-in owner.

## Migration

1. Replace every consumer that reads `result.url` with `result.key` and `result.name`.
2. Build any download navigation inside the console or a server-side authenticated route. Do not reconstruct the old `/storage/download/?key=...&token=...` URL in client code.
3. If an integration needs a direct URL, have the console issue a short-lived download grant; never put `CONSOLA_TOKEN` in model output, a Session log, a browser URL, or documentation.
4. Confirm the tool schema contains only `key` and `name`, and that a canary `CONSOLA_TOKEN` does not appear in the canonical result or rendered tool text.
