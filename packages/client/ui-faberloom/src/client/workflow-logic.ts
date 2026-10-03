/**
 * Pure geometry and classification helpers for the Work Flow canvas. Kept
 * React-free so the layout math and the status palette are unit-tested without
 * a browser, and so the component stays presentation-only.
 * @module @deepseek-ai/dsh-client-ui-faberloom/client/workflow-logic
 */

/** Node box width the canvas draws and the edge anchors assume. */
export const NODE_WIDTH = 180

/** Node box height the canvas draws and the edge anchors assume. */
export const NODE_HEIGHT = 56

/** One node as the canvas positions it. */
export interface CanvasNode {
  /** Node id. */
  readonly id: string
  /** Node kind. */
  readonly kind: string
  /** Display title. */
  readonly title: string
  /** Canvas x. */
  readonly x: number
  /** Canvas y. */
  readonly y: number
}

/** One edge as the canvas draws it. */
export interface CanvasEdge {
  /** Edge id. */
  readonly id: string
  /** Source node id. */
  readonly from: string
  /** Target node id. */
  readonly to: string
  /** Branch condition, or null. */
  readonly condition: string | null
}

/** The two coordinates one edge anchor occupies. */
export interface CanvasAnchor {
  /** Anchor x. */
  readonly x: number
  /** Anchor y. */
  readonly y: number
}

/**
 * Whether one kind starts a run.
 * @param kind - node kind.
 * @returns true for a trigger kind.
 */
export function kindIsTrigger(kind: string): boolean {
  return kind.startsWith('trigger.')
}

/**
 * The anchor point an edge leaves from or arrives at, at a node's vertical center.
 * @param node - node to anchor.
 * @param side - `left` for an incoming edge, `right` for an outgoing one.
 * @returns the anchor coordinates.
 */
export function nodeAnchor(node: CanvasNode, side: 'left' | 'right'): CanvasAnchor {
  return { x: side === 'left' ? node.x : node.x + NODE_WIDTH, y: node.y + NODE_HEIGHT / 2 }
}

/** The four coordinates a straight canvas edge occupies. */
export interface CanvasLine {
  /** Source x. */
  readonly x1: number
  /** Source y. */
  readonly y1: number
  /** Target x. */
  readonly x2: number
  /** Target y. */
  readonly y2: number
}

/**
 * The three numbers a straight edge line needs: the source's right anchor and
 * the target's left anchor.
 * @param from - source node.
 * @param to - target node.
 * @returns the line coordinates.
 */
export function edgeLine(from: CanvasNode, to: CanvasNode): CanvasLine {
  const start = nodeAnchor(from, 'right')
  const end = nodeAnchor(to, 'left')
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
}

/** The status palette the run history uses, keyed by execution status. */
const STATUS_COLORS: Readonly<Record<string, string>> = {
  running: '#1a73e8',
  waiting: '#f9ab00',
  completed: '#188038',
  failed: '#d93025',
  needs_review: '#e37400',
}

/**
 * The color one execution status paints, defaulting to neutral gray.
 * @param status - execution status.
 * @returns the CSS color.
 */
export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#80868b'
}

/**
 * The default configuration a freshly added node of one kind starts with, so
 * the inspector opens on a valid shape instead of an empty object.
 * @param kind - node kind.
 * @returns the default config.
 */
export function defaultConfigFor(kind: string): Record<string, unknown> {
  switch (kind) {
    case 'agent': return { agentId: '', instruction: '' }
    case 'skill': return { skillName: '' }
    case 'mcp.call': return { server: '', tool: '' }
    case 'imap.action': return { op: 'search' }
    case 'smtp.send': return { to: [], subject: '' }
    case 'memory.remember': return { spaceId: '', text: '' }
    case 'memory.teach': return { scope: 'case', text: '', source: '' }
    case 'board.create': return { title: '' }
    case 'space.reference': return { spaceId: '' }
    case 'routine.invoke': return { routineId: '' }
    case 'condition': return { expression: '' }
    case 'transform': return { expression: '' }
    case 'wait': return { seconds: 0 }
    case 'notify': return { kind: 'board' }
    case 'trigger.schedule': return { recurrence: '1h' }
    case 'trigger.email': return { match: '' }
    default: return {}
  }
}

/**
 * Place nodes on a simple grid when the stored graph carries no positions (or
 * all at the origin), so a graph created from chat still draws.
 * @param nodes - the stored nodes.
 * @returns nodes with a laid-out position.
 */
export function layoutNodes(nodes: readonly CanvasNode[]): readonly CanvasNode[] {
  const untouched = nodes.every(node => node.x === 0 && node.y === 0)
  if (!untouched) return nodes
  return nodes.map((node, index) => ({ ...node, x: 40 + (index % 4) * (NODE_WIDTH + 40), y: 48 + Math.floor(index / 4) * 130 }))
}
