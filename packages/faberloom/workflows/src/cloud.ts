/**
 * Execution-environment profile for a Work Flow. A flow is a graph that the
 * service compiles to a routine, so its cloud verdict is the same classifier
 * the routine tools use, with each action node mapped to the handler it
 * compiles to. Trigger nodes are not steps and never block a cloud run.
 * @module @deepseek-ai/dsh-faberloom-workflows/cloud
 */

import type { CloudExecutionProfile, CloudStepInput } from '@deepseek-ai/dsh-faberloom-routines'
import { classifyCloudSteps } from '@deepseek-ai/dsh-faberloom-routines'
import type { WorkFlowDefinition, WorkFlowNode } from './types.ts'

/** The handler a node kind compiles to, for classification only. */
function handlerFor(node: WorkFlowNode): string {
  switch (node.kind) {
    case 'skill': return 'agent'
    case 'imap.action': return 'imap'
    case 'smtp.send': return 'smtp'
    case 'space.reference': return 'reference'
    case 'routine.invoke': return 'subroutine'
    case 'wait': return 'delay'
    default: return node.kind
  }
}

/**
 * Classify one stored Work Flow.
 * @param definition - the graph as stored.
 * @returns the cloud/local profile the UI and the chat report.
 */
export function classifyWorkflow(definition: WorkFlowDefinition): CloudExecutionProfile {
  const steps: CloudStepInput[] = []
  // Stored graphs can be legacy or partially written; one malformed node must
  // not break every list/get call that reports the cloud verdict. Skip rows
  // without a usable kind instead of throwing.
  for (const node of (definition.nodes ?? []) as readonly Partial<WorkFlowNode>[]) {
    const kind = typeof node.kind === 'string' ? node.kind : ''
    if (kind.length === 0 || kind.startsWith('trigger.')) continue
    const title = typeof node.title === 'string' ? node.title : ''
    const handler = handlerFor({ ...node, kind } as WorkFlowNode)
    steps.push({
      id: typeof node.id === 'string' ? node.id : kind,
      label: title.trim().length === 0 ? kind : title,
      handler,
      text: `${title}\n${JSON.stringify(node.config ?? {})}`,
    })
  }
  return classifyCloudSteps(steps)
}
