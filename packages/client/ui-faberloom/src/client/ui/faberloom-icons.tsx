/**
 * FaberLoom icon families on the shared 24x24 / 1.75 grid: the ten brand
 * glyphs transcribed from the iconography source, plus the standard UI library
 * redrawn on the same grid. Every glyph rides currentColor, keeps fill="none"
 * except at most one deliberately filled anchor node, and takes {size,
 * className}. Each component carries its source slug so the mapping stays
 * auditable.
 */
import type { IconProps } from './props.ts'

/** slug: brand-loom */
export const FlIconBrandLoom = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M7 3.5V9.5M7 14.5V20.5M12 3.5V4.5M12 9.5V14.5M12 19.5V20.5M17 3.5V9.5M17 14.5V20.5" />
    <path d="M3.5 7H4.5M9.5 7H14.5M19.5 7H20.5M3.5 12H9.5M14.5 12H20.5M3.5 17H4.5M9.5 17H14.5M19.5 17H20.5" />
  </svg>
)

/** slug: criterio */
export const FlIconCriterio = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.5 12c1.8-2.8 4-4.2 6-4.2s4.2 1.4 6 4.2" />
    <path d="M2.5 12c1.8 2.8 4 4.2 6 4.2s4.2-1.4 6-4.2" />
    <circle cx="8.5" cy="12" r="1.9" fill="currentColor" stroke="none" />
    <path d="m15.4 13 2.2 2.3 4-4.6" />
  </svg>
)

/** slug: workloom */
export const FlIconWorkloom = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
    <path d="M9.5 3.5v17M14.5 3.5v17" />
    <path d="M3.5 9.5h17M3.5 14.5h17" />
    <circle cx="14.5" cy="9.5" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)

/** slug: spaceloom */
export const FlIconSpaceloom = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H6a2 2 0 0 1-2-2z" />
    <path d="M7.5 9h9" strokeDasharray="2.2 1.6" />
  </svg>
)

/** slug: stackloom */
export const FlIconStackloom = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2 22 7 12 12 2 7z" />
    <path d="M2 12 12 17 22 12" />
    <path d="M2 17 12 22 22 17" />
    <circle cx="12" cy="7" r="1.3" fill="currentColor" stroke="none" />
  </svg>
)

/** slug: voice */
export const FlIconVoice = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M16.5 8c1.3 1.2 1.3 4.3 0 5.5" />
    <path d="M19 5.5c2.3 2 2.3 8.5 0 10.5" />
  </svg>
)

/** slug: learning-clock */
export const FlIconLearningClock = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 4 12 12 19.6 9.5A8 8 0 0 0 12 4z" fill="currentColor" stroke="none" />
    <path d="M12 12 19.6 9.5A8 8 0 0 1 16.7 18.5z" fill="currentColor" stroke="none" />
    <path d="M12 12 16.7 18.5A8 8 0 0 1 7.3 18.5z" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4v8M12 12 19.6 9.5M12 12 16.7 18.5M12 12 7.3 18.5M12 12 4.4 9.5" />
  </svg>
)

/** slug: knowledge-index */
export const FlIconKnowledgeIndex = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 14v4.5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V14" />
    <path d="M3 14h5l1.5 2h5l1.5-2h5" />
    <path d="M12 3v8" />
    <path d="m8.5 8 3.5 3.5L15.5 8" />
  </svg>
)

/** slug: curation */
export const FlIconCuration = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 2v6M12 2v6M15 2v6" />
    <circle cx="7.5" cy="11.5" r="3.5" />
    <circle cx="16.5" cy="11.5" r="3.5" />
    <circle cx="7.5" cy="11.5" r="0.85" fill="currentColor" stroke="none" />
    <circle cx="16.5" cy="11.5" r="0.85" fill="currentColor" stroke="none" />
    <path d="M12 15v7" />
  </svg>
)

/** slug: workspace */
export const FlIconWorkspace = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9.2 8 15 8.2" strokeWidth="0.85" />
    <path d="M8.2 9.5 11.7 16" strokeWidth="0.85" />
    <path d="M15.6 9.7 12.7 16" strokeWidth="0.85" />
    <rect x="6" y="6.5" width="3" height="3" rx="0.3" />
    <circle cx="16.5" cy="8" r="1.7" />
    <path d="M12 14.4 9.3 18.4 14.7 18.4z" />
  </svg>
)

/** slug: search */
export const FlIconSearch = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.6-4.6" />
  </svg>
)

/** slug: plus */
export const FlIconPlus = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/** slug: x */
export const FlIconClose = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 6 18 18M18 6 6 18" />
  </svg>
)

/** slug: chevron */
export const FlIconChevron = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

/** slug: arrow */
export const FlIconArrow = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

/** slug: arrow-up */
export const FlIconArrowUp = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
)

/** slug: panel-l */
export const FlIconPanelLeft = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
)

/** slug: panel-r */
export const FlIconPanelRight = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </svg>
)

/** slug: hourglass */
export const FlIconHourglass = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 4h12M6 20h12M7 4c0 5 5 6 5 8s-5 3-5 8M17 4c0 5-5 6-5 8s5 3 5 8" />
  </svg>
)

/** slug: clock */
export const FlIconClock = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l2.5 2" />
  </svg>
)

/** slug: refresh */
export const FlIconRefresh = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 6v5h-5" />
    <path d="M4 18v-5h5" />
    <path d="M5.5 11A7 7 0 0 1 18 8.5L20 11M4 13l2 2.5A7 7 0 0 0 18.5 13" />
  </svg>
)

/** slug: layers */
export const FlIconLayers = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="m12 3 9 5-9 5-9-5 9-5z" />
    <path d="m3 13 9 5 9-5" />
    <path d="m3 18 9 5 9-5" />
  </svg>
)

/** slug: library */
export const FlIconLibrary = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 4v16M9 4v16" />
    <rect x="13" y="4" width="3" height="16" rx="0.5" />
    <path d="m17 6 4 14" />
  </svg>
)

/** slug: bookmark */
export const FlIconBookmark = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 4h12v17l-6-4-6 4z" />
  </svg>
)

/** slug: file-text */
export const FlIconFileText = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
)

/** slug: mail */
export const FlIconMail = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
)

/** slug: message */
export const FlIconMessage = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
  </svg>
)

/** slug: inbox */
export const FlIconInbox = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
  </svg>
)

/** slug: paperclip */
export const FlIconPaperclip = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="m21 11-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3l8-8" />
  </svg>
)

/** slug: check */
export const FlIconCheck = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 12.5 10 17.5 19.5 8" />
  </svg>
)

/** slug: alert */
export const FlIconAlert = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4M12 16v.01" />
  </svg>
)

/** slug: warning */
export const FlIconWarning = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="m12 4 9.5 16.5h-19z" />
    <path d="M12 11v4M12 18v.01" />
  </svg>
)

/** slug: sparkles */
export const FlIconSparkles = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 4 13.5 9 18 10.5 13.5 12 12 17 10.5 12 6 10.5 10.5 9z" />
    <path d="M19 4v3M21 5.5h-3M5 17v3M6.5 18.5h-3" />
  </svg>
)

/** slug: pin */
export const FlIconPin = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M16.5 3 21 7.5l-4 2-4 5 2 4-1.5 1.5-9-9L6 9.5l4 2 5-4z" />
    <path d="m9 15-5 5" />
  </svg>
)

/** slug: circle */
export const FlIconCircle = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="8" />
  </svg>
)

/** slug: circle-fill */
export const FlIconCircleFill = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="6.5" fill="currentColor" />
  </svg>
)

/** slug: user */
export const FlIconUser = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
)

/** slug: users */
export const FlIconUsers = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.65" />
  </svg>
)

/** slug: tools */
export const FlIconAdmin = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
)

/** slug: user-circle */
export const FlIconUserCircle = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="10" r="3" />
    <path d="M6 18.5A6 6 0 0 1 18 18.5" />
  </svg>
)

/** slug: settings */
export const FlIconSettings = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="2.8" />
    <path d="M19.4 14.5a7.5 7.5 0 0 0 0-5l1.7-1.3-1.6-2.7-2 .8a7.5 7.5 0 0 0-4.3-2.5l-.3-2.1H10l-.3 2.1a7.5 7.5 0 0 0-4.3 2.5l-2-.8L1.8 8.2l1.7 1.3a7.5 7.5 0 0 0 0 5l-1.7 1.3 1.6 2.7 2-.8a7.5 7.5 0 0 0 4.3 2.5l.3 2.1H14l.3-2.1a7.5 7.5 0 0 0 4.3-2.5l2 .8 1.6-2.7z" />
  </svg>
)

/** slug: sliders */
export const FlIconSliders = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 6h13M3 12h7M3 18h11" />
    <circle cx="18" cy="6" r="2" />
    <circle cx="13" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </svg>
)

/** slug: edit */
export const FlIconEdit = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6" />
    <path d="m17 3 4 4-9.5 9.5H8v-3.5z" />
  </svg>
)

/** slug: log-out */
export const FlIconLogOut = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H10" />
  </svg>
)

/** slug: external */
export const FlIconExternal = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 4h6v6" />
    <path d="M11 13 20 4M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
  </svg>
)

/** slug: trash */
export const FlIconTrash = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v7M14 11v7" />
  </svg>
)
