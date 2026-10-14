# Agent Note: a local model for the desktop app, phased

Status: proposed

English | [中文](2026-10-13-local-ai-model.zh.md)

## Problem

The desktop app can host a small local model, but shipping "a local AI" naively produces a worse product: a slow install, a promise of knowledge it does not have, and no way to know whether the model is ready. The owner wants a desktop-only local model that (a) the installer only provisions when the hardware can actually run it, (b) is trained on the user's own work — Context, Memory, Routines, Workflows, Workspaces/Spaces, Agents, Skills — *except* anything private, (c) evolves on its own, under an explicit on/off control, and (d) steps aside for the user's third-party providers the moment it cannot answer.

## Decision

The decisions are taken, with the reasons:

**Runtime: Ollama, not LM Studio.** Ollama is a headless daemon with an OpenAI-compatible API, scriptable install and model management, and no GUI the user must operate — exactly what a background provision needs. LM Studio is GUI-first and has no unattended path. The Ollama server is also *already* an OpenAI-compatible model list, so it drops into `packages/faberloom/model-catalog`'s provider discovery (`/v1/models`) as `provider: ollama` with no new protocol.

**The model.** A small, tool-capable, reasoning model. Default: **Phi-4-mini-Instruct (3.8B, Q4_K_M ≈ 2.3 GB)** — the strongest small model on reasoning and tool calls per unit of weight, and it fits a mid laptop. A lighter fallback for the weakest eligible machines: **Qwen2.5-3B-Instruct (Q4_K_M ≈ 2 GB)**. Image input is an **opt-in upgrade**, not a base promise: `Qwen2.5-VL-3B` only on hardware that fits it, and the product is honest that the base model is text + tools. No sub-4B model does tool use, reasoning and vision well in one, and pretending otherwise is the trap this decision avoids.

**Minimum hardware — lowered on purpose, because the trainer fits a 4 GB card.** The default model is a 3.8B LoRA, and Soup's own measured headline is an 8B trained on a 4 GB laptop GPU, so a 3.8B LoRA sits well inside it. Eligible **with a GPU**: ≥ 4 GB VRAM — mini PCs and older laptops included — gets the full path (inference *and* the LoRA evolution). Eligible **without a GPU**: ≥ 8 GB RAM and an AVX2 CPU — an older desktop — gets inference and the retrieval brain, and honestly skips the LoRA evolution because that is GPU work (Soup's own CPU row reads "experimental — very slow"). Below either bar: the app installs *without* the local model and the Settings card says why, naming the hardware and the missing bar — never a silent omission.

**Architecture: retrieval first, adapter second.** A per-user fine-tune is the fragile path; retrieval is the reliable one. So the local model answers with the user's *eligible* corpus injected as its context (a "local brain" that reads the user's work), and an **optional LoRA adapter trained with [Soup](https://github.com/MakazhanAlpamys/Soup)** — one command, QLoRA on a laptop-class GPU — on the user's eligible *style and preference* material runs in the background as a refinement layer. The capabilities (tool use, reasoning, image input) come from the **base model**; the per-user layer contributes the *content* and the *taste*. Stating which side carries what is the difference between a feature that works and one that hallucinates confidence.

**Privacy is a hard filter, not a preference.** Only entities marked shareable are ingested. The Context already carries `visibility: local | pending | shared` (`packages/faberloom/context/src/types.ts`): `local` and `pending` are never ingested, and the same flag must be added to Memory, Routines, Workflows, Agents and Skills where they lack it (the plan's Phase 3). A shared-with-me record is ingestible; a private one never is, and the Settings card says how much was skipped and why.

**The training threshold: 70%, and the user can move it.** Readiness is a percentage of the *eligible corpus ingested and indexed*, plus one probe question the local model must answer from the user's own data. The default is 70%, and the user can raise or lower it in the same General row — the control appears only while the toggle is on. Below the threshold the surface says "still learning" and the route keeps the default; at it, the local model takes the route. 70% is deliberate, not arbitrary: a half-read "local brain" that answers confidently from half the evidence is worse than a clearly-not-ready one, and the progress is shown — but the user who accepts a lower bar sets it explicitly, and the bar is never hidden.

**Routing.** The local model registers as `provider: ollama` with id `local`. A Workspace/Space or chat session with **no agent** uses it once the threshold is met, else the deployment's default; an agent that carries its own provider/model/key **always wins** (the seam the routing work already ships). What the local model cannot answer hands off to the user's third-party providers through the existing routing and failure surfaces, with the cause named — the same `quota`/`invalid-credential` taxonomy the providers already speak.

**Desktop only.** The web/VPS keeps its behaviour; the local model never leaves the user's machine, and nothing it read is uploaded.

**A toggle, not the installer — and the installer never changes.** Nothing is provisioned at install: the app installs and opens exactly as fast as it does today, and the local model is **not** part of it. A «Local AI» toggle in Settings → General, **off by default**, owns the whole lifecycle. When the user turns it on the first time, Ollama and the model download run as a background job and the Settings card shows the real progress — a download percentage, then an installation percentage, then a training percentage that disappears once the threshold is passed. Turning it off and back on later re-downloads nothing: the existing install is **validated**, not re-fetched. When the hardware does not meet the minimum, the toggle is **disabled** and shows as off, naming the hardware and the missing bar — it can never be turned on there.

## Proposal

The work, in phases, each with its owner packages, its deliverable, and the evidence that closes it. Phases are ordered by dependency; later phases build on earlier ones, and none may ship without its evidence.

### Fase 0 — Hardware detection and the eligibility decision
- Owner: `apps/desktop` (+ a `packages/desktop/hardware` probe module if the desktop already splits one).
- Deliverable: the installer probes the machine (CPU cores + AVX2, RAM, GPU vendor + VRAM) and records the eligibility verdict with the reason; the app installs regardless and **its speed does not change** — the local model is never part of the install. The probe is a real, queryable fact (`detectHardware()`), not a one-shot, and it is what decides whether the Settings toggle is enabled.
- Evidence: a test matrix over the three classes (GPU-eligible / CPU-eligible / not eligible) with fixtures per vendor, and the Settings toggle disabled-with-the-reason on a not-eligible machine and enabled on an eligible one.

### Fase 1 — The local runtime, provisioned lazily by the toggle
- Owner: `apps/desktop` + a `packages/desktop/local-model` host plugin that owns the daemon lifecycle.
- Deliverable: the toggle's first enable provisions Ollama and the model as a background job, with the Settings card showing the real progress — the download percentage, then the installation percentage — and no user action beyond the toggle. A later re-enable **validates** the existing install instead of re-downloading. If Ollama is already present, the provisioner detects it and uses it instead of reinstalling.
- Evidence: a mock-HTTP test pinning the download and installation progress reporting, the Settings card rendering each real state, and the re-enable path asserting validation without a second download.

### Fase 2 — The model as a first-class provider
- Owner: `packages/faberloom/model-catalog` (+ the model picker where it lists).
- Deliverable: `provider: ollama` enters the catalog through its own `/v1/models` (no new protocol), so the local model appears in the picker beside the others, grouped and described, and a turn routed to it is proven live.
- Evidence: the live discovery of the local server, and a spec that a turn with provider `ollama` reaches the local server and never the deployment's credential.

### Fase 3 — The eligible corpus and the privacy filter
- Owner: `packages/faberloom/{context,learning,agents,routines,workflows,board}` + `packages/faberloom/knowledge-index`.
- Deliverable: every ingestible entity carries a visibility fact (the Context's exists; the others are added), and the ingest filter admits only the shareable ones, with a durable count of what was skipped and why.
- Evidence: a test where a private Context/Memory/Workflow and a shared one enter the pipeline and only the shared one is indexed; the Settings card reports the skipped count.

### Fase 4 — The local brain (retrieval + the threshold)
- Owner: `packages/faberloom/knowledge-index` + the routing seam.
- Deliverable: the local model answers with the eligible corpus injected as its context; the readiness percentage and the probe gate the route, and the threshold is a **user-adjustable setting in General** (default 70%, visible only while the toggle is on) — below it the surface says "still learning" and routes to the default; at it, the local model takes the route, and the training percentage disappears.
- Evidence: a spec where the local model answers a question whose answer exists only in the user's own indexed data, the threshold flipping the route at exactly the boundary, and the threshold control changing that boundary.

### Fase 5 — Self-evolution, under the user's control
- Owner: `packages/desktop/local-model` + `packages/faberloom/learning`.
- Deliverable: a Settings → General toggle "Local AI" that turns evolution on and off; when on, an idle-time loop refreshes the index and rebuilds the LoRA adapter (Soup) on the eligible corpus, and when off, nothing retrains. The toggle is durable, named, and never runs while the user is active on the machine.
- Evidence: a spec where flipping the toggle stops a scheduled evolution run; the Settings card shows the last evolution and the next scheduled one.

### Fase 6 — The handoff to third-party providers
- Owner: `packages/faberloom/session-agent` + the routing seam.
- Deliverable: what the local model cannot answer goes to the user's configured providers with the cause named (the existing quota/invalid-credential taxonomy); the handoff is visible, never silent.
- Evidence: a spec where a deliberately-out-of-scope prompt routes to a third-party provider and the UI names the handoff.

### Fase 7 — The local model's own harness
- Owner: `packages/desktop/local-model` + `packages/faberloom/learning`.
- Deliverable: the harness the owner asked for — a per-user evaluation loop (a small fixed probe set drawn from the user's *eligible* data), a drift check on evolution runs, and a log of what each evolution changed. This is what makes "it evolves on its own" accountable rather than a black box.
- Evidence: the evaluation set never trains on a private record (asserted), and an evolution run records what it changed and the probe result.

## The trainer: Soup

The training is done with **[Soup](https://github.com/MakazhanAlpamys/Soup)**, the Apache-2.0 fine-tuning CLI. It is chosen for what the plan needs, not for a logo: one YAML config, one `soup train` command, QLoRA on a laptop-class GPU, and — load-bearing here — **layer streaming** keeps the frozen base out of VRAM and feeds it one decoder layer at a time, so an 8B model trains on a 4 GB laptop GPU (their measured record: 119.6 tok/s, 3.32 GB peak, on an RTX 3050 4 GB). The default is a 3.8B LoRA, well inside that.

What it gives this plan: `soup init --template chat` for the config, `soup train` for the run, its recipes and its hardware-fit table, and its own probes and eval gates — which the local model's harness (Fase 7) builds on. The base model is pulled for Ollama as a GGUF, and Soup's `soup export --model … --format gguf` is exactly how the adapted layer meets the runtime. Its known constraint is carried on purpose: Python 3.10–3.12 only, and the `[train]` extra.

What it is NOT for: the retrieval brain (Fase 4) — the index answers new data without any training. Soup enters at evolution (Fase 5), not at answering.

## Alternatives considered

**LM Studio as the runtime.** It is GUI-first with no unattended install or model-management path — a user who never opens it never gets a local model. Ollama is a headless daemon with a scriptable lifecycle and an OpenAI-compatible API; it is the only choice that lets the installer provision and the harness manage it without the user.

**A per-user fine-tune as the primary mechanism.** The original ask is "train it on the user's data", but a per-user fine-tune is fragile (it needs a curated corpus, it is slow and expensive per user, and it can drift silently), and it does not answer *new* data until retrained. Retrieval answers new data immediately and is honest about its evidence; the LoRA adapter then adds the taste layer where fine-tuning genuinely helps. Retrieval first, adapter second.

**One small model that does tools + reasoning + vision.** No sub-4B model does all three well. Promising it would ship a model that fumbles tool calls or misreads images. The base model is text + tools; vision is an opt-in variant for hardware that fits it.

**A lower training threshold (50%).** A local brain that reads half the evidence and answers confidently is worse than a clearly-not-ready one. 70% is a deliberate bar, and the progress toward it is shown.

**Gating the whole feature behind the GPU.** CPU-only laptops are common, and a 3.8B model at Q4 answers on one, slowly. Excluding them would cut off most users; the slow path is honest and usable.

## Acceptance criteria

- The install is unchanged and fast; the «Local AI» toggle is off by default, disabled-with-the-reason on hardware that cannot run the model, and a first enable provisions Ollama and the model in the background with the download / installation / training percentages visible.
- The local model appears as `provider: ollama` in the picker, and a turn routed to it reaches the local server and never the deployment's credential.
- The local model answers from the user's eligible data; a private Context/Memory/Workflow/Routine/Skill/Agent is never indexed or trained on.
- The 70% threshold gates the route, with the progress and the "still learning" state visible.
- The Settings toggle starts and stops evolution; evolution runs are logged and probed.
- A prompt the local model cannot answer hands off to the user's providers with the cause named.
- The web/VPS behaviour is unchanged.

## Risks

- **A per-user fine-tune can drift silently.** Mitigation: the harness (Fase 7) probes each evolution run against a fixed eligible probe set and records what changed; a drifted run is rolled back, not kept.
- **The privacy filter is the load-bearing seam.** A single missed visibility flag leaks a private record into training. Mitigation: the filter is one point, and the ingestion pipeline is asserted to refuse private records with a test, not a convention.
- **A tiny model that overpromises.** Mitigation: the base model's capabilities are stated honestly (text + tools; vision opt-in), and what it cannot answer hands off with the cause named.
- **Windows-first detection.** The hardware probe must cover the GPU vendors' drivers and a headless fallback; the installer never blocks on a probe failure (it degrades to "not eligible" with the reason).
- **The web must not inherit it.** The feature is gated to the desktop composition; a leaked flag into the web bundle would try to run a local model that does not exist.
