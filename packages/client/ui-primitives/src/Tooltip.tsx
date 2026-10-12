// Cloning the anchor preserves its layout context. Fixed positioning lets the
// bubble escape ancestor overflow clipping without a portal.

import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEventHandler, MouseEventHandler, MutableRefObject, ReactElement, Ref } from 'react'
import css from './Tooltip.module.css'

/** Bubble placement relative to the anchor. */
export type TooltipSide = 'right' | 'bottom' | 'top'

/** Props Tooltip injects into its anchor child; the child's own handlers are chained ahead of the tooltip's. */
interface AnchorProps {
  ref?: Ref<HTMLElement> | undefined
  onMouseEnter?: MouseEventHandler | undefined
  onMouseLeave?: MouseEventHandler | undefined
  onFocus?: FocusEventHandler | undefined
  onBlur?: FocusEventHandler | undefined
}

type TooltipLabel = string | (() => string)

/**
 * Attach a hover/focus tooltip to an anchor element.
 * @param props.label - bubble text, or a resolver evaluated only while the bubble is visible.
 * @param props.side - placement relative to the anchor (default 'right'). A horizontal row of controls passes
 * 'top' so the bubble sits above the anchor and clears the neighbour the default right side would cover.
 * @param props.delayMs - hover delay in milliseconds; keyboard focus remains immediate.
 * @param props.disabled - suppress the bubble while true; the anchor renders identically so
 * toggling never remounts it (which would cut its CSS transitions).
 * @param props.maxWidth - bubble width cap in pixels, for labels long enough that the default
 * half-viewport cap would render a slab wider than the surface the anchor sits on.
 * @param props.children - a single anchor element; its own ref (callback or object) is forwarded alongside the tooltip's.
 * @returns the cloned anchor plus a fixed-position bubble while hovered/focused.
 */
export function Tooltip({ label, side = 'right', delayMs = 0, disabled = false, maxWidth, children }: { label: TooltipLabel; side?: TooltipSide; delayMs?: number; disabled?: boolean; maxWidth?: number; children: ReactElement<AnchorProps> }) {
  const anchor = useRef<HTMLElement | null>(null)
  // React 18 keeps the element's ref outside props; forward it so wrapping an
  // anchor in Tooltip never silently severs the owner's ref.
  const childRef = (children as ReactElement<AnchorProps> & { ref?: Ref<HTMLElement> }).ref
  const mergedRef = useCallback((el: HTMLElement | null) => {
    anchor.current = el
    if (typeof childRef === 'function') childRef(el)
    else if (childRef != null) (childRef as MutableRefObject<HTMLElement | null>).current = el
  }, [childRef])
  // The anchor's viewport edges rather than final bubble coordinates: a vertical
  // flip re-derives the bubble's top from the opposite edge, and a requested-side
  // change re-derives its left from the same rect.
  const [rect, setRect] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null)
  // Placement and the requested side it was chosen for. A changed requested
  // side invalidates a previous viewport flip by derivation, so a horizontal
  // row that asks for 'top' re-places an open bubble at once, without an effect
  // or an extra render.
  const [placementState, setPlacementState] = useState({ side, value: side })
  const placement = placementState.side === side ? placementState.value : side
  const bubble = useRef<HTMLSpanElement | null>(null)
  const resolvedLabel = rect === null
    ? null
    : typeof label === 'function' ? label() : label
  // Base coordinates for the placement, before the viewport fit pass: right sits
  // past the anchor's right edge, top and bottom center over it. The per-side
  // transform in the stylesheet turns these into the rendered box.
  const baseX = rect === null
    ? 0
    : placement === 'right' ? rect.right + 10 : (rect.left + rect.right) / 2
  const y = rect === null
    ? 0
    : placement === 'right'
      ? (rect.top + rect.bottom) / 2
      : placement === 'top' ? rect.top - 8 : rect.bottom + 8
  const EDGE_MARGIN = 12
  // Viewport fit: fixed positioning knows nothing about edges, so a centered
  // bubble near the right edge would clip and a long label under an anchor low
  // on the page would run off the bottom. Horizontally the bubble slides back
  // inside; vertically it flips to the opposite side, which is the only move
  // that does not cover the anchor being read. Each measurement resets the base
  // position first, so a shorter label or a larger viewport releases a previous
  // adjustment without another render.
  useLayoutEffect(() => {
    if (rect === null) return
    const fit = () => {
      const el = bubble.current
      /* v8 ignore next -- rect is set only while the bubble is mounted. */
      if (el === null) return
      el.style.left = `${baseX}px`
      const r = el.getBoundingClientRect()
      let dx = 0
      if (r.right > window.innerWidth - EDGE_MARGIN) dx = window.innerWidth - EDGE_MARGIN - r.right
      if (r.left + dx < EDGE_MARGIN) dx = EDGE_MARGIN - r.left
      el.style.left = `${baseX + dx}px`
      if (side === 'right') return
      // Flip only into a side that genuinely fits, so an anchor with room on
      // neither side keeps the requested placement instead of oscillating.
      const fitsBelow = rect.bottom + 8 + r.height <= window.innerHeight - EDGE_MARGIN
      const fitsAbove = rect.top - 8 - r.height >= EDGE_MARGIN
      if (placement === 'bottom' && !fitsBelow && fitsAbove) setPlacementState({ side, value: 'top' })
      if (placement === 'top' && !fitsAbove && fitsBelow) setPlacementState({ side, value: 'bottom' })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit) }
  }, [baseX, placement, rect, resolvedLabel, side])
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hover and focus are independent triggers: the bubble hides only after
  // BOTH clear (hovering away from a focused anchor must not drop it).
  const triggers = useRef({ hover: false, focus: false })

  // Disabling mid-hover (e.g. clicking a rail control expands the sidebar)
  // must drop an already-visible bubble: no mouseleave fires.
  const cancelShow = useCallback(() => {
    if (showTimer.current === null) return
    clearTimeout(showTimer.current)
    showTimer.current = null
  }, [])
  useEffect(() => {
    if (disabled) {
      cancelShow()
      triggers.current = { hover: false, focus: false }
      setRect(null)
    }
    return cancelShow
  }, [cancelShow, disabled])

  const show = () => {
    if (disabled) return
    const el = anchor.current
    /* v8 ignore next -- the ref is attached by event time: events fire on the cloned anchor. */
    if (el === null) return
    const r = el.getBoundingClientRect()
    // Every show starts from the requested side; the fit pass flips it only
    // where this anchor's position demands it.
    setPlacementState({ side, value: side })
    setRect({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }
  const showAfterHoverDelay = () => {
    cancelShow()
    if (delayMs <= 0) {
      show()
      return
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      show()
    }, delayMs)
  }
  const hide = () => {
    cancelShow()
    if (!triggers.current.hover && !triggers.current.focus) setRect(null)
  }

  return (
    <>
      {cloneElement(children, {
        ref: mergedRef,
        onMouseEnter: (e) => { children.props.onMouseEnter?.(e); triggers.current.hover = true; showAfterHoverDelay() },
        onMouseLeave: (e) => { children.props.onMouseLeave?.(e); triggers.current.hover = false; cancelShow(); setRect(null) },
        onFocus: (e) => { children.props.onFocus?.(e); triggers.current.focus = true; cancelShow(); show() },
        onBlur: (e) => { children.props.onBlur?.(e); triggers.current.focus = false; hide() },
      })}
      {rect !== null && (
        <span
          ref={bubble}
          className={css.bubble}
          data-side={placement}
          style={{ left: baseX, top: y, ...maxWidth === undefined ? {} : { maxWidth } }}
          role="tooltip"
        >
          {resolvedLabel}
        </span>
      )}
    </>
  )
}
