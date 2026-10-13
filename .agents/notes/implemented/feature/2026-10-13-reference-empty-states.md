# Agent Note: Show the `@` file section's empty states

Status: implemented

English | [中文](2026-10-13-reference-empty-states.zh.md)

## Problem

The `@` menu's file half lists one workspace directory per query and rendered only the rows it found. A directory with no children, and a listing whose children the typed filter excluded, produced no row at all, so the user typed `@` and read a menu that said nothing about the folder being browsed; with no session row matching either, the menu closed outright. The renderer compounded it: a ready group with zero items renders null, and every row a source publishes is an option the keyboard highlight and a pointer press can reach, so the only available shape for a line of information was a choice that inserted nothing.

## Decision

**An empty result is a row, not silence.** `packages/client/ui-reference` adds two keys to its own dictionary namespace — `Empty folder` / 空文件夹 / «Carpeta vacía» and `No results` / 没有结果 / «Sin resultados» — and `browseCandidates` publishes one of them when it produced no entry row: a listing whose children the menu cannot mention reads as an empty folder, while one whose children the filter left out reads as no results. The fuzzy name search adds the no-results row when the index returns nothing, and the cut-listing and failed-listing lines keep their place. A failed *discovery* still yields no row: a lookup that errored is not an empty result and has no honest copy of its own.

**An informational row is not an option.** The candidate type gains `note?: boolean`, and every informational line in the file section carries it. The reducer skips a note when it picks the first highlight, when `move` and `hover` cycle the highlight, and when it validates a parked highlight, so a note keeps its group non-empty — the menu stays open and the line stays readable — without ever claiming a choice. `MenuView` renders one as plain text in a row's place: no option id, no `aria-selected`, no pick handler, no drill chevron. A group whose only row is a note therefore leaves the keyboard free for the session rows below it instead of parking the highlight on a line that cannot act.

## Alternatives considered

**Rendering a note only when the whole menu would otherwise be empty.** Rejected: the file section is the section being browsed, and a menu that also lists session rows must still say that this folder, or this filter, yielded nothing.

**A `note` field on the ready group instead of on the row.** Rejected: the emptiness is the source's fact, not the renderer's. A source that has nothing to say needs no line, and every row a source publishes keeps one shape.

**Leaving the note as an ordinary row with no pick value.** That is what the failed-listing row did. Rejected: an option that inserts nothing misleads the keyboard user, and the highlight would move onto it; the flag states the fact instead.

## Consequences

The `@` file section is never silent: an empty folder, a filter with no match, a cut listing, and a failed listing each say what happened, in the active language. The first highlight is always a real candidate, and Enter on a menu holding only notes behaves as it does with no menu open. Notes are rows of the same group as the session rows, so a name search that matches no file but matches a session now shows both. `packages/client/ui-input-trigger` owns the flag and the rendering, so any source can publish an informational row on the same terms. The package READMEs state the superseded decision: the quiet empty result is no longer deliberate.

## Testing

`packages/client/ui-reference/tests/browser-plugin.client.spec.ts` covers a bare `@` in an empty folder, an empty drilled level, a filter that excludes every child, a name search with no match, and both states in each of the three registered languages; it also asserts the cut and failed listing rows carry the flag. `packages/client/ui-input-trigger/tests/core-menu.client.spec.ts` covers the reducer's skip rules and the group that holds only a note, and `menu-view.client.spec.tsx` covers the rendered note row and its missing option id.
