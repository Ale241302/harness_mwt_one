/**
 * F1 iteration-window state: open flag, floating geometry, fullscreen mode and
 * the local draft.
 *
 * The reducer is pure, so moving, resizing, closing and reopening are testable
 * without layout. Geometry is plain numbers because jsdom has none: the window
 * writes them as `left/top/width/height`, and a browser draws them.
 */

/** Floating geometry in pixels. */
export interface WindowGeometry {
  /** Distance from the viewport's left edge. */
  readonly x: number
  /** Distance from the viewport's top edge. */
  readonly y: number
  /** Outer width. */
  readonly width: number
  /** Outer height. */
  readonly height: number
}

/** Smallest floating window the controls allow. */
export const WINDOW_MIN_WIDTH = 320

/** Smallest floating height the controls allow. */
export const WINDOW_MIN_HEIGHT = 240

/** Default size when the window opens for the first time. */
export const WINDOW_DEFAULT_GEOMETRY: WindowGeometry = { x: 48, y: 72, width: 420, height: 360 }

/** How much one arrow key moves or resizes. */
export const KEYBOARD_STEP = 16

/** Floating, or covering the surface. */
export type WindowMode = 'floating' | 'fullscreen'

/** Whole window state. */
export interface TaskChatState {
  /** Whether the window is on screen. */
  readonly open: boolean
  /** Floating or fullscreen. */
  readonly mode: WindowMode
  /** Geometry while floating; kept when going fullscreen so restore returns it. */
  readonly geometry: WindowGeometry
  /** Instruction being written. */
  readonly text: string
  /** Text as of the last save, so clearing back to it is not a change. */
  readonly savedText: string
  /** Whether the text differs from the last save. */
  readonly dirty: boolean
  /** Whether a save is in flight. */
  readonly saving: boolean
  /** How many times the draft was saved, useful to prove a save happened. */
  readonly saves: number
}

/** Actions the window dispatches. */
export type TaskChatAction =
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | { readonly type: 'move'; readonly dx: number; readonly dy: number }
  | { readonly type: 'resize'; readonly dw: number; readonly dh: number }
  | { readonly type: 'mode'; readonly value: WindowMode }
  | { readonly type: 'edit'; readonly text: string }
  | { readonly type: 'save' }
  | { readonly type: 'saved' }

/** Keep a geometry inside the minimums and off negative coordinates. */
export function clampGeometry(geometry: WindowGeometry): WindowGeometry {
  return {
    x: Math.max(0, geometry.x),
    y: Math.max(0, geometry.y),
    width: Math.max(WINDOW_MIN_WIDTH, geometry.width),
    height: Math.max(WINDOW_MIN_HEIGHT, geometry.height),
  }
}

/** Initial state: closed, floating at the default size, empty draft. */
export function createTaskChatState(): TaskChatState {
  return {
    open: false,
    mode: 'floating',
    geometry: WINDOW_DEFAULT_GEOMETRY,
    text: '',
    savedText: '',
    dirty: false,
    saving: false,
    saves: 0,
  }
}

/** Apply one action. */
export function taskChatReducer(state: TaskChatState, action: TaskChatAction): TaskChatState {
  switch (action.type) {
    case 'open':
      return { ...state, open: true }
    case 'close':
      return { ...state, open: false, saving: false }
    case 'move':
      return { ...state, geometry: clampGeometry({ ...state.geometry, x: state.geometry.x + action.dx, y: state.geometry.y + action.dy }) }
    case 'resize':
      return {
        ...state,
        geometry: clampGeometry({
          ...state.geometry,
          width: state.geometry.width + action.dw,
          height: state.geometry.height + action.dh,
        }),
      }
    case 'mode':
      return { ...state, mode: action.value }
    case 'edit':
      return { ...state, text: action.text, dirty: action.text !== state.savedText }
    case 'save':
      return state.dirty ? { ...state, saving: true } : state
    case 'saved':
      return { ...state, saving: false, dirty: false, savedText: state.text, saves: state.saves + 1 }
    default:
      return state
  }
}
