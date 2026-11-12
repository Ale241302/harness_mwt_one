# Agent Note: A pending item asks the question its defect names

Status: implemented

## Problem

A severity is not a criterion. The board classifies an item on the way in — rules first, the model when a deployment mounts it — and records `RULE` or `LLM` as its source. What it does not record is what the account should do about it. On a real queue of 458 migrated alerts, every item carried a severity with its provenance (313 `RULE`, 136 `LLM`, 9 `HUMAN`) and not one carried a doubt: the panel showed a colour and a title, and the person had to reconstruct the decision from the text before approving anything.

That gap blocks the learning side too. A correction with its scope is what creates a candidate, and a correction needs an answer. An item with no question cannot be answered; it can only be approved or discarded, and neither teaches anything about why.

## Decision

`criteria.ts` holds the table the alerts imply: each pattern over the item title names the action the defect asks for and the question whose answer settles it — attach the purchase order, advance the phase or reschedule it, retry the dead-lettered effect, attach the SAP document, discard the duplicate. A defect the generator writes in several ways is one entry with several patterns, so "Falta avanzar la fase", "Falta avanzar el estado", "Estado desfasado" and "Fase ... vencida" ask the same question. `reviewQuestion(title)` returns that pair or `undefined`.

`reviewPending(writer, { limit? })` reads the pending items that carry no doubt and whose severity no human set, takes the question for each recognized title, and records it as the item's doubt through `setSeverity`, keeping the severity and its source. An item that already asks something, one whose title no rule recognizes, and one a human already judged are left untouched. The pass never approves, discards, or changes a state.

`faberloom_board_review_pending` exposes the pass to the agent, so the queue can be made answerable in one call instead of item by item.

The table is deliberately small and literal. An unrecognized title stays untouched: inventing a question for an item the product does not understand is worse than leaving it for a person to read.

## Alternatives considered

**Having the agent approve or discard each item** was rejected. Approval binds evidence to an exact version and hash and records a human decision; a machine approving 458 items on its own would forge exactly the evidence `APPROVAL_UNVERIFIED` exists to catch.

**Asking the model for a free-text question per item** was rejected for this pass. It costs one call per item on a queue that already had 458 entries, and the answer would drift between runs, so the same defect would ask two different things. The defects are named by the generator's own vocabulary; a table over that vocabulary is deterministic and testable.

**Leaving the queue as it was** was rejected: the severity was already there, and the person still had nothing to answer.

## Consequences

- A classified item with a recognized defect now carries the question that settles it, and answering it is the correction the learning side reads.
- The pass costs no model call. It writes one audit event per item it asks, through the same `setSeverity` path the panel uses.
- A new alert vocabulary needs a table entry; until one exists, its items keep waiting without a question instead of asking a wrong one.
- The queue can be made answerable from the agent, without a person opening every item.

## Testing

`packages/faberloom/board/tests/board-classification.spec.ts` covers the pass: one recognized alert receives the question once and a second pass changes nothing; the families the generator writes in other words — the phase that passed, the missing phase end, the correction that retires a finding, the data the connector cannot see — each receive their own question; an unrecognized title and an item a human already classified receive nothing. Package suite: 12 tests in that spec; `tsc` on the board at zero.
