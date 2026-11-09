# Agent Note: The Claude adapter packages a signed artifact without a token or an executable

Status: implemented

English | [中文](2026-11-09-claude-adapter-package.zh.md)

## Problem

A signed portable artifact was inspectable but not loadable by Claude Code. A naive adapter would add a global token variable to `.mcp.json`, package a binary that chat and Cowork cannot run, or treat a valid manifest as proof that components had loaded. The package also had to report missing capabilities before a task and leave an unsent draft when the local runtime was absent.

## Decision

**The adapter lives in the portable package.** `planClaudePackage` converts one signed artifact into a Claude Code plugin: `.claude-plugin/plugin.json`, `CLAUDE.md`, the `faberloom-space` and `faberloom-proposals` skills, the artifact's resources under `resources/`, a host-managed connection descriptor, and a load record carrying the exact host and version. `installClaudePackage` writes the files; `validateClaudePackage` checks the manifest and skills without claiming installation; `loadClaudePackage` registers components only for the exact host version; `removeClaudePackage` removes only the package directory.

**The connection is a host-managed reference, not a token.** The package carries `faberloom/connection.json` with an opaque `referenceId`, the host id, and `mcpServer: faberloom`. It carries no bearer token, no `FABERLOOM_TOKEN` variable, and no `bin/` directory. The host resolves the reference to a token and attaches MCP; a token-shaped reference is refused before a package exists.

**Paths resolve against the package.** The plugin manifest points at `./skills`; resource and skill paths are validated and resolved against the package directory on write. No path is resolved against the checkout or the current working directory.

**The runtime decides between a package and a draft.** With the local runtime available, the plan writes a ready plugin and a load record with `sent:false` and `mesa:false`. Without it, the plan writes only `faberloom/draft.md`, has no plugin manifest, and reports `state:'draft'`; no task is sent and no Mesa item is simulated. Capabilities are written into `CLAUDE.md` before a task: Code is supported; chat and Cowork are not certified; MCP is host-managed.

**The installation test runs outside the checkout.** It creates a temporary package directory under the system temp folder, installs the package, validates the manifest, loads the components with the synthetic host loader at exactly `2.1.126`, and rejects another version. It also verifies that excluded N3 content, synthetic secrets, tokens, and `bin/` never appear, and that removing the package leaves the source, proposals, and revisions intact. Where Claude Code is installed, the test also runs the real `claude plugin validate`; the current host passed.

## Alternatives considered

**Put a token in `.mcp.json`.** A global token var is one shared secret for every connection, cannot be revoked per conversation, and leaks into a portable file. The host-managed reference keeps the token out of the package.

**Package an MCP bridge binary.** A native binary is not portable to chat, Cowork, or another host, and it hides executable behavior inside the artifact. The host already owns the MCP connection; the package names it.

**Treat a valid manifest as an installation.** Validation proves the files are well formed, not that a host registered them. The synthetic loader records `loaded:false` after validation and `loaded:true` only after a host load at the exact version.

**Always emit a plugin, even without a runtime.** That would let Code claim a working connection it cannot reach. A draft with no manifest and `sent:false` is the safe state.

## Consequences

Claude Code can load a signed space's skills and resources from a temporary package with a host-managed reference, while chat and Cowork are explicitly unsupported. The package carries no token or executable, so removing it cannot revoke or erase the source; the host connection is a separate lifecycle. The cost is that the host must resolve the reference and attach MCP, and an authenticated model task against the D01 account is outside this package's automated evidence.

## Verification

- `packages/faberloom/portable/tests/distribution.spec.ts`: package outside the checkout; manifest valid but not installed; synthetic load at exact host version; wrong version; skills/resources mapping; no N3, secret, token, or `bin/`; unsent draft; removal preserves source, proposals, and revisions; real `claude plugin validate` when the CLI is present.
- `packages/faberloom/portable/tests/context-authorization.spec.ts` and `projection.spec.ts`: the signed inventory the adapter consumes.
