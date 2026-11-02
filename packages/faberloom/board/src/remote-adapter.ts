/**
 * Adapter that lets the board run against the central Mesa API (A-58). It reads
 * the actor from the signed board token the gateway injects into the `dsh`
 * process, so the process never needs the browser cookie.
 *
 * Reads are complete. Writes throw `REMOTE_UNSUPPORTED` until the central API
 * owns the state machine; `on` therefore stays off, while `shadow` compares the
 * reads of both stores.
 * @module @deepseek-ai/dsh-faberloom-board/remote-adapter
 */
import {
  BoardRemote,
  type BoardRemoteItem,
} from './remote.ts'
import type {
  BoardRemoteAdapter,
  BoardRemoteSettings,
} from './remote-port.ts'
import type {
  BoardApproveInput,
  BoardAssignment,
  BoardDiscardInput,
  BoardEditsInput,
  BoardIterateInput,
  BoardIterationResult,
  BoardSeverity,
  BoardWriter,
  FaberLoomBoardItem,
  FaberLoomBoardItemId,
} from './types.ts'

/** Claims the gateway signs into the board token. */
interface BoardTokenClaims {
  readonly email: string
  readonly tenantId: string
  readonly role: string
}

/**
 * Read the claims of the board token without verifying them. The gateway is the
 * verifier; the process only uses them to build the request identity and to
 * reject a response from another tenant.
 * @param token - `body.signature`.
 * @returns the claims.
 * @throws when the token has no readable body.
 */
export function decodeBoardToken(token: string): BoardTokenClaims {
  const body = token.split('.')[0] ?? ''
  try {
    const parsed = JSON.parse(Buffer.from(body.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8'))
    if (parsed === null || typeof parsed !== 'object') throw new Error('empty payload')
    return {
      email: String(parsed.email ?? ''),
      tenantId: String(parsed.tenantId ?? ''),
      role: String(parsed.role ?? ''),
    }
  } catch {
    throw new Error('faberloom: REMOTE_CONFIG_INVALID — the board token has no readable payload')
  }
}

/**
 * Project one central row onto the board item the panel consumes.
 * @param row - row returned by the API.
 * @returns the board item.
 */
function toItem(row: BoardRemoteItem): FaberLoomBoardItem {
  const payload = row.payload as unknown as Partial<FaberLoomBoardItem>
  return {
    ...payload,
    id: row.id as FaberLoomBoardItemId,
    ownerId: row.ownerId,
    spaceId: row.spaceId,
    businessKey: row.businessKey,
    state: row.state,
    rowVersion: row.rowVersion,
    title: row.title ?? payload.title ?? '',
    evidence: row.evidence.length > 0 ? row.evidence : ((payload as { evidence?: readonly string[] }).evidence ?? []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as FaberLoomBoardItem
}

/** Refuse one command the central API does not implement yet. */
function unsupported(command: string): never {
  throw new Error(`faberloom: REMOTE_UNSUPPORTED — the central API does not implement ${command} yet`)
}

/**
 * Build the adapter from the settings the board resolves from config or the
 * environment.
 * @param settings - base URL (without `/board`) and the signed board token.
 * @returns the adapter.
 */
export function createBoardRemoteAdapter(settings: BoardRemoteSettings): BoardRemoteAdapter {
  if (settings.baseUrl === undefined || settings.token === undefined) {
    throw new Error('faberloom: REMOTE_CONFIG_INVALID — baseUrl and token are required')
  }
  const claims = decodeBoardToken(settings.token)
  const client = new BoardRemote({
    baseUrl: `${settings.baseUrl.replace(/\/$/, '')}/board`,
    actor: { ...claims, token: settings.token },
  })
  return {
    async list(_actor, filter = {}) {
      return (await client.list(filter)).map(toItem)
    },
    async get(_actor, id) {
      return toItem(await client.get(id))
    },
    async setSeverity(_writer: BoardWriter, _id: FaberLoomBoardItemId, _severity: BoardSeverity) {
      return unsupported('setSeverity')
    },
    async approve(_writer: BoardWriter, _id: FaberLoomBoardItemId, _input: BoardApproveInput) {
      return unsupported('approve')
    },
    async discard(_writer: BoardWriter, _id: FaberLoomBoardItemId, _input: BoardDiscardInput) {
      return unsupported('discard')
    },
    async saveEdits(_writer: BoardWriter, _id: FaberLoomBoardItemId, _input: BoardEditsInput) {
      return unsupported('saveEdits')
    },
    async assignWorkspace(_writer: BoardWriter, _id: FaberLoomBoardItemId, _workspaceId: string | null): Promise<BoardAssignment> {
      return unsupported('assignWorkspace')
    },
    async iterate(_writer: BoardWriter, _id: FaberLoomBoardItemId, _input: BoardIterateInput): Promise<BoardIterationResult> {
      return unsupported('iterate')
    },
  }
}
