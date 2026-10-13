# Agent Note: A `!` typed in the composer asks the model to run a shell command

Status: implemented

English | [中文](2026-10-12-shell-command-trigger.zh.md)

## Problem

The composer's trigger characters were `/` for commands and `@` for file and session references, and each resolved through a path the product already had: a command ran through the client's command service, and a reference inserted a token the model reads. A user who wanted the model to run a shell command typed it as ordinary prose and hoped the model would read it as a command; no gesture named a command as a command.

## Decision

**`!` is a third trigger character beside `/` and `@`.** `packages/client/ui-input-trigger` gains it, and typing it under the caret detects the rest of the line as the command — spaces included, since a shell command is not a single word — through the pure grammar in `src/core/shell-command.ts` (`activeShellToken`). The built-in source in `src/client/shell-source.ts` shows one row under the Shell heading (the source name's own `slash.menu` key) labeled with the command and described by the localized "Run this command" hint; a pick replaces the `!` token with the request text the model reads, and a submit sends that same text as the user message.

**The inserted text is the model-facing protocol form.** `formatShellCommandMention` produces one string, `Run this shell command: <command>`, which is both the text the user reads in the draft and the prompt text the model receives; the grammar refuses an empty command and one carrying control characters. It is deliberately not localized, for the same reason a `@path` mention is not — it is protocol the model reads, not product display — while the row's own label and hint stay locale-owned through the `slash.menu` dictionaries.

**The browser gains no execution path.** The inserted text is the user's ordinary message, so the model runs the command with its own shell tool under the sandbox and approval policy that already gate that tool; nothing in the browser runs it, and the composer does not know whether the model complies. A model that declines leaves the request as ordinary message text.

**Widening `TriggerChar` left the published lexicon domain alone.** `TriggerChar` became `'/' | '@' | '!'`, but the composer's decoration scan reads only `/` and `@`, so the lexicon domain stayed `'/' | '@'` — the union the trigger package names `ReferenceTriggerChar` — rather than casting `TriggerChar` down. The conversation contract in `packages/client/ui-conversation/src/client/contract/input.ts` therefore keeps its `readonly trigger: '/' | '@'` and its `ReadonlyMap<'/' | '@', readonly string[]>` lexicon snapshot unchanged.

## Alternatives considered

**A real run-from-composer gesture.** Letting the composer run the typed command itself needed an already-gated path for a user-composed command, and none exists: the only shell execution is the model's tool, an approval request must be turn-enclosed and names a tool, and no Remote runs a one-shot command for a session — the terminal Remote opens a PTY in a sidebar tab outside the transcript, which is that PTY rather than a gated one-shot. A real gesture would therefore mean a new Remote plus a session event plus approval wiring, a second execution path beside the tool, so the gesture asks the model instead.

## Consequences

A user can name a command as a command: the composer shows one Shell row, and a pick turns the typed line into a request the model reads and runs with its own shell tool, so the sandbox and approval policy that gate that tool are unchanged and the browser still has no execution path. The inserted text is not localized, and its protocol lead is the same string in the draft and in the prompt.

Two limits come with the choice. The gesture asks the model, so a model that declines leaves the request as ordinary message text and the command never runs. And the published lexicon domain stays `/` and `@`: a `!` token is not decorated as a reference, because the composer's decoration scan reads only the two reference triggers.

Verification: the package's client tests cover the `!` grammar (the command is the rest of the line, an `!` inside another token and the `!=` and `!==` operators are not triggers, and the grammar refuses an empty or control-bearing command), the single Shell row with its localized copy, the model-facing form a pick inserts, and the detection order that lets an `@` inside a shell command still reach file and session references.
