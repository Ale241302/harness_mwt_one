/**
 * Curated skills and working partners for each shared agent preset.
 *
 * The shipped presets carry only a name, a description, and the generic
 * `standard` composition: the upstream ECC catalog that holds each agent's body,
 * tools, and team is not vendored in this repository. So the skills an agent
 * starts with and the agents it works with are authored here, keyed by the
 * preset's directory id under `agents-shared/`.
 *
 * A skill name is kept only when the deployment actually ships it (the role
 * catalog or the shared catalog); a partner is connected only when that preset
 * was seeded too. Nothing here changes a user's own agents.
 * @module @deepseek-ai/dsh-faberloom-defaults/src/preset-curation
 */

/** Curated skills and working partners for one shared agent preset. */
export interface PresetCuration {
  /** Skill names the seeded agent starts with; dropped when the deployment does not ship them. */
  readonly skills: readonly string[]
  /** Directory ids of the presets this agent works with, resolved to subagents after seeding. */
  readonly connects: readonly string[]
}

/**
 * The curation, keyed by the preset directory id under `agents-shared/`.
 *
 * `skills` names come from `skills-shared/`; `connects` names are other entries
 * of this same map. Keep both sorted so the generated agent reads deterministically.
 */
export const PRESET_CURATION: Readonly<Record<string, PresetCuration>> = {
  'a11y-architect': { skills: ['accessibility', 'design-system', 'frontend-a11y', 'make-interfaces-feel-better'], connects: ['code-reviewer'] },
  'agent-evaluator': { skills: ['agent-self-evaluation', 'eval-harness', 'skill-comply', 'verification-loop'], connects: ['harness-optimizer'] },
  'architect': { skills: ['api-design', 'architecture-decision-records', 'backend-patterns', 'contract-first', 'hexagonal-architecture'], connects: ['code-architect', 'database-reviewer', 'planner', 'security-reviewer'] },
  'build-error-resolver': { skills: ['cmd-build-fix', 'error-handling', 'verification-loop'], connects: ['code-reviewer', 'tdd-guide'] },
  'chief-of-staff': { skills: ['email-ops', 'intent-driven-development', 'messages-ops', 'unified-notifications-ops'], connects: ['doc-updater', 'planner', 'code-reviewer', 'security-reviewer'] },
  'code-architect': { skills: ['architecture-decision-records', 'codebase-onboarding', 'hexagonal-architecture'], connects: ['architect', 'code-reviewer', 'tdd-guide'] },
  'code-explorer': { skills: ['code-tour', 'codebase-onboarding', 'iterative-retrieval', 'search-first'], connects: ['code-architect', 'spec-miner'] },
  'code-reviewer': { skills: ['click-path-audit', 'codehealth-mcp', 'coding-standards', 'security-review'], connects: ['code-simplifier', 'pr-test-analyzer', 'security-reviewer', 'silent-failure-hunter'] },
  'code-simplifier': { skills: ['coding-standards', 'contract-first', 'plankton-code-quality'], connects: ['code-reviewer', 'refactor-cleaner'] },
  'comment-analyzer': { skills: ['coding-standards', 'documentation-lookup', 'living-docs-governance'], connects: ['code-reviewer', 'doc-updater'] },
  'conversation-analyzer': { skills: ['agent-self-evaluation', 'cmd-learn', 'continuous-learning-v2', 'growth-log'], connects: ['agent-evaluator'] },
  'database-reviewer': { skills: ['backend-patterns', 'content-hash-cache-pattern', 'data-throughput-accelerator', 'database-migrations'], connects: ['architect', 'code-reviewer', 'performance-optimizer'] },
  'doc-updater': { skills: ['cmd-update-codemaps', 'cmd-update-docs', 'documentation-lookup', 'living-docs-governance'], connects: ['code-reviewer', 'comment-analyzer'] },
  'docs-lookup': { skills: ['documentation-lookup', 'search-first'], connects: [] },
  'e2e-runner': { skills: ['browser-qa', 'canary-watch', 'e2e-testing', 'ui-demo'], connects: ['pr-test-analyzer', 'tdd-guide'] },
  'gan-evaluator': { skills: ['browser-qa', 'eval-harness', 'gan-style-harness'], connects: ['gan-planner'] },
  'gan-generator': { skills: ['frontend-patterns', 'gan-style-harness', 'tdd-workflow'], connects: ['gan-evaluator'] },
  'gan-planner': { skills: ['blueprint', 'gan-style-harness', 'product-capability'], connects: ['gan-generator'] },
  'harness-optimizer': { skills: ['agent-architecture-audit', 'agent-harness-construction', 'context-budget', 'cost-tracking'], connects: ['agent-evaluator'] },
  'loop-operator': { skills: ['autonomous-loops', 'cmd-loop-start', 'cmd-loop-status', 'continuous-agent-loop', 'loop-design-check'], connects: ['harness-optimizer'] },
  'marketing-agent': { skills: ['brand-voice', 'content-engine', 'lead-intelligence', 'marketing-campaign'], connects: ['seo-specialist'] },
  'opensource-forker': { skills: ['cmd-projects', 'opensource-pipeline', 'security-scan'], connects: ['opensource-sanitizer'] },
  'opensource-packager': { skills: ['cmd-update-docs', 'github-ops', 'opensource-pipeline'], connects: ['doc-updater'] },
  'opensource-sanitizer': { skills: ['cmd-security-scan', 'opensource-pipeline', 'security-scan'], connects: ['opensource-packager'] },
  'performance-optimizer': { skills: ['benchmark', 'benchmark-optimization-loop', 'data-throughput-accelerator', 'latency-critical-systems'], connects: ['architect', 'database-reviewer'] },
  'planner': { skills: ['architecture-decision-records', 'blueprint', 'cmd-plan', 'product-capability'], connects: ['architect', 'spec-miner', 'tdd-guide'] },
  'pr-test-analyzer': { skills: ['ai-regression-testing', 'e2e-testing', 'tdd-workflow', 'verification-loop'], connects: ['e2e-runner', 'tdd-guide'] },
  'rag-pipeline-reviewer': { skills: ['iterative-retrieval', 'knowledge-ops', 'security-review'], connects: ['performance-optimizer', 'security-reviewer'] },
  'refactor-cleaner': { skills: ['cmd-refactor-clean', 'coding-standards', 'hexagonal-architecture', 'verification-loop'], connects: ['code-reviewer', 'code-simplifier'] },
  'security-reviewer': { skills: ['cmd-security-scan', 'safety-guard', 'security-review', 'security-scan'], connects: ['code-reviewer', 'silent-failure-hunter'] },
  'seo-specialist': { skills: ['content-engine', 'market-research', 'seo'], connects: ['marketing-agent'] },
  'silent-failure-hunter': { skills: ['codehealth-mcp', 'error-handling', 'verification-loop'], connects: ['code-reviewer', 'security-reviewer'] },
  'spec-miner': { skills: ['codebase-onboarding', 'contract-first', 'intent-driven-development'], connects: ['code-explorer', 'planner'] },
  'tdd-guide': { skills: ['e2e-testing', 'tdd-workflow', 'verification-loop'], connects: ['code-reviewer', 'e2e-runner', 'pr-test-analyzer'] },
  'type-design-analyzer': { skills: ['coding-standards', 'contract-first', 'error-handling'], connects: ['architect', 'code-architect'] },
}
