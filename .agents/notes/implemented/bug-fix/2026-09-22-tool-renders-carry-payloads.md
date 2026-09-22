# Agent Note: data tools render their payload, not a summary of it

Status: implemented

English | [中文](2026-09-22-tool-renders-carry-payloads.zh.md)

## Problem

`faberloom_mail_search` worked — it logged into the owner's IMAP and returned real envelopes — but its `output.render` produced only `Mailbox matches: N`. The render is the text the model actually reads, so the assistant concluded the tool was a stub that echoed the limit, kept retrying with other queries, and finally abandoned the user's configured mailbox to answer from the MWT console's correo module instead. The same hidden-payload pattern existed in `faberloom_mwt_call` ("answered."), `faberloom_mwt_find` ("Data found in: X."), and `faberloom_board_list` ("Board items: N.").

## Decision

Every data-returning tool's render carries the payload, bounded:

- `faberloom_mail_search` renders one line per envelope (`date · from · subject`), or "Sin coincidencias en el buzón." when empty.
- `faberloom_mwt_call` renders the result JSON truncated at 4.000 characters through a `renderJson(value, max)` helper that appends the omitted character count.
- `faberloom_mwt_find` renders the winning tenant plus one `company: data|sin datos` line per company, each payload truncated at 1.500 characters.
- `faberloom_board_list` renders `id · status · title` per item.

Truncation stays in the render only; the structured value the session log and UI cards read is unchanged.

## Alternatives considered

- **Larger limits or no truncation.** Rejected: renders ride the model context; a 2412-message mailbox or a large MWT payload must be cut somewhere, and the cut belongs at the presentation boundary with an explicit omission marker.
- **A second "details" tool per data tool.** Rejected: the model should not need a ritual second call to see what a tool just returned; the render is the right channel.

## Consequences

- A chat query like "revísame los correos de tal cosa" now shows the assistant the actual envelopes, so it answers from the owner's configured IMAP/SMTP connections instead of concluding the tool is fake and falling back to other data sources.
- The render change is model-visible text: no recorded session fixture used these tools yet, so no snapshot update was required.
- The rule of thumb this bug teaches is recorded here because it generalizes: a count-only render on a data tool is a defect, not a style choice; new tools assert their render carries the payload (see `tool-faberloom/tests/router.spec.ts`).
