# Agent Note: A Space session reads its whole subtree, and only its subtree

Status: implemented

English | [中文](2026-10-23-space-subtree-scope-and-read-grants.zh.md)

## Problem

A session in a Space only knew the Space whose folder was its working directory. `faberloom-session-agent` injected that Space's agent persona and directive, and `agent-instructions` loaded `AGENTS.md` from the working directory upward. Nothing exposed the sub-Spaces below it: their memory, curated context, agents, skills, `AGENTS.md`, `.agents/`, `.claude/`, or files. A session in Costa Rica therefore could not use Sondel or Muitowork Limitada, even though both were sub-Spaces of Costa Rica, while a session in the parent Marluvas could not aggregate its children either. A session in a leaf also had no way to ask the user for read access to a sibling Space; the only cross-Space tools returned context and file metadata, never the folder or its files.

The inverse also failed: `faberloom-session-agent` returned early for a Space without a responsible agent, so such a Space had no session composition or scope at all.

## Decision

**The readable scope is the Space subtree.** `faberloom-session-agent` reads the session's Space, every readable descendant, and any granted subtree, and installs one `faberloom:space-scope` system-prompt section ordered after the memory and cross-Space rules. Each node carries its absolute folder, memory, curated context entries, responsible agent, skill names, harness artifacts (`AGENTS.md`, `.agents/`, `.claude/`, `.claude/skills/`), the top-level folder entries, and the `AGENTS.md` text. The section is recomputed at the first step of each turn and is byte-identical when nothing changed, so the prompt prefix survives an unchanged turn.

**A Space without a responsible agent still gets its scope.** Space resolution is separate from agent composition. A Space with no `agentId` installs the scope section and keeps the deployment persona; a Space with an agent installs both.

**Outside the subtree is named, not readable.** The section lists the other readable Spaces by title and id under “Otros Spaces”, without their folders. `faberloom_spaces_open_read` asks the user through `ctx.approval` once, records one `faberloom/space-read-grant` log-only event, and adds the granted subtree to the scope. A session already running under `danger-full-access` records the grant without a prompt: that standing mode already authorizes the user's own file operations, and the grant is narrower (read-only). A confined preset asks and fails closed on rejection or an unavailable channel. The grant survives resume by replay and is bounded to the session. The spaces service still refuses a Space the acting identity cannot read before any approval is shown, so a grant can never widen product access.

**The guard matches the scope.** `read`, `read_image`, `write`, `edit`, `glob`, `grep`, `bash`, and `pwsh` are checked before execution: a path under a Space folder outside the scope is denied with the `faberloom_spaces_open_read` instruction, and shell commands are scanned token by token for absolute or relative foreign folder spellings. A path outside every Space stays readable exactly as before. Writes outside the session's sandbox root remain the sandbox's decision; the grant does not change that root.

**The parent→child direction is authorized by the hierarchy, not by sharing.** A descendant is readable because it is a descendant the actor can read in the spaces domain. It is not shared, published, or copied; a member who cannot read a sub-Space does not receive it through its parent.

## Alternatives considered

**Only inherit upward, as `inheritContext` already does.** Rejected: it is the opposite of the requested behavior. A parent must aggregate its children, and a child must not see its siblings.

**Resolve descendants from the filesystem instead of `parentId`.** Rejected: a folder nested inside another folder is not necessarily a product sub-Space, and the product already owns the hierarchy. The Spaces panel repairs legacy physical nesting into `parentId` on load, so the record is authoritative.

**Render every descendant's `AGENTS.md`, `.agents/*.md`, and skill bodies in full.** Rejected for the default prompt: a deep tree would consume the context window before the user's question. The scope carries the bounded digest and the artifact paths; the model reads a specific file when the task needs it.

**Add a second, Space-aware filesystem backend.** Rejected: the read guard belongs to the product scope, not to the generic `ctx.fs` seam, and a second backend would duplicate the sandbox. The product tools and the shell command are the surfaces the model uses; the sandbox continues to own writes.

**Make the grant permanent or identity-wide.** Rejected: the user asked for a permission activated in the conversation. A session event is the narrowest durable record that still survives resume.

## Consequences

A session in Marluvas reads Costa Rica, Colombia, and their descendants automatically. A session in Costa Rica reads Sondel and Muitowork Limitada, but not Colombia. A session in Muitowork Limitada sees Sondel only after the user approves `faberloom_spaces_open_read`; the grant covers Sondel and its descendants for the rest of that session. A Space with no responsible agent keeps the deployment persona and still reads its subtree.

The scope text has a character and Space ceiling (`maxScopeChars`, `maxScopeSpaces`), so a very large tree truncates with an explicit note rather than failing the turn. Reading a foreign Space through the file tools is denied until granted; an obfuscated shell command can still reach the same user-owned file because the shell is not a sandbox boundary, which the package README records as a known limitation. Creating or renaming a Space during a turn appears in the scope on the next turn.

## Testing

`packages/faberloom/session-agent/tests/session-agent.spec.ts` covers the parent subtree, the sub-Space subtree without its siblings, the grant widening the scope, the harness files of a descendant, the scope without a responsible agent, and the file-tool guard for absolute and relative foreign paths. `packages/faberloom/tool-faberloom/tests/spaces-scope.spec.ts` covers `faberloom_spaces_scope`, opening an in-scope Space without approval, the approval path for an outside Space, rejection, a missing approval channel, and the product access denial.
