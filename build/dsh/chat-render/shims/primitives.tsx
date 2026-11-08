/**
 * Thin runtime shim for @deepseek-ai/dsh-client-ui-primitives (sidecar only).
 *
 * WHY: the 12 reachable ui-chat leaves import ~14 runtime symbols from
 * dsh-client-ui-primitives, whose barrel pulls 127 files (Markdown/shiki/katex/
 * micromark/icons). docs/DEVELOPMENT.md 第 1 章 §3 forbids copying that
 * barrel. This file provides exactly the 14 symbols with:
 *   - VS Code codicon CSS classes (the workbench already ships the font),
 *   - plain DOM <details>/<pre>,
 *   - a CSS shimmer,
 *   - small path/size helpers.
 *
 * MarkdownText is intentionally NOT a Markdown implementation: the DSH-IDE
 * single seam in `chatListRenderer.ts` owns VS Code's
 * `chatContentMarkdownRenderer`. Call `setMarkdownDomRenderer()` once at mount
 * time (exported from dist/dsh-chat.js as `setMarkdownDomRenderer`) to inject
 * it; until then MarkdownText falls back to plain, escaped, pre-wrapped text so
 * streaming never breaks. See README.md §"Markdown renderer".
 *
 * This file is ORIGINAL sidecar code (not DSH source); see PROVENANCE.md.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { MarkdownLabels } from './types'

type Style = Record<string, string | number>

function cx(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------ *
 * 1. DisclosureRow — plain <details>/<summary>
 * ------------------------------------------------------------------ */

export interface DisclosureRowProps {
  rowClassName?: string
  leadingClassName?: string
  titleClassName?: string
  icon?: ReactNode
  title?: ReactNode
  running?: boolean
  open: boolean
  expandable?: boolean
  expandOnRowClick?: boolean
  onToggle?: () => void
  collapsedContent?: ReactNode
  children?: ReactNode
  className?: string
}

/**
 * The original CSS (ReasoningRow.module.css) targets `[data-open]` and
 * `[data-disclosure-header]`, so those attributes are preserved here.
 */
export function DisclosureRow({
  rowClassName, leadingClassName, titleClassName, icon, title, running,
  open, expandable = true, expandOnRowClick = true, onToggle,
  collapsedContent, children, className,
}: DisclosureRowProps) {
  const ref = useRef<HTMLDetailsElement>(null)
  // Keep the native element in sync with the caller's controlled state.
  useEffect(() => {
    if (ref.current && ref.current.open !== open) ref.current.open = open
  }, [open])
  const toggle = (): void => { if (expandable) onToggle?.() }
  return (
    <details
      ref={ref}
      className={cx('dsh-disclosure', rowClassName, className)}
      open={open}
      data-open={open || undefined}
      data-running={running || undefined}
      data-expandable={expandable || undefined}
      onClick={expandOnRowClick ? (event) => {
        // Let the summary's own handler own the toggle; clicks on the body
        // (links, code blocks, selections) must not collapse the row.
        if (event.target instanceof Element
          && event.target.closest('[data-disclosure-header],[data-disclosure-body]')) return
        toggle()
      } : undefined}
    >
      <summary
        className="dsh-disclosure__header"
        data-disclosure-header
        aria-expanded={expandable ? open : undefined}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={(event) => { event.preventDefault(); toggle() }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggle()
          }
        }}
      >
        {icon !== undefined && <span className={cx('dsh-disclosure__leading', leadingClassName)}>{icon}</span>}
        {title !== undefined && <span className={cx('dsh-disclosure__title', titleClassName)}>{title}</span>}
        {!open && collapsedContent !== undefined && (
          <span className="dsh-disclosure__collapsed">{collapsedContent}</span>
        )}
        {expandable && <IconChevronRightRegular className="dsh-disclosure__chevron" size={14} />}
      </summary>
      {open && <div className="dsh-disclosure__body" data-disclosure-body>{children}</div>}
    </details>
  )
}

/* ------------------------------------------------------------------ *
 * 2. TextShimmer — pure CSS
 * ------------------------------------------------------------------ */

export interface TextShimmerProps {
  children?: ReactNode
  /** Set false to disable the animation (still renders children). */
  active?: boolean
  className?: string
}

export function TextShimmer({ children, active = true, className }: TextShimmerProps) {
  return (
    <span
      className={cx('dsh-shimmer', className)}
      data-shimmer-active={active ? '' : undefined}
      aria-hidden={undefined}
    >{children}</span>
  )
}

/* ------------------------------------------------------------------ *
 * 3. JsonBlock — plain <details>/<pre>
 * ------------------------------------------------------------------ */

const JSON_PREVIEW_LIMIT = 4000

export interface JsonBlockProps {
  label?: ReactNode
  payload: unknown
  truncatedLabel?: (total: number) => string
  className?: string
}

export function JsonBlock({ label, payload, truncatedLabel, className }: JsonBlockProps) {
  let full: string
  try {
    full = JSON.stringify(payload, null, 2) ?? String(payload)
  } catch {
    full = String(payload)
  }
  const truncated = full.length > JSON_PREVIEW_LIMIT
  const shown = truncated ? full.slice(0, JSON_PREVIEW_LIMIT) : full
  return (
    <details className={cx('dsh-json-block', className)}>
      <summary>{label ?? 'JSON'}</summary>
      <pre className="dsh-json-block__pre">{shown}</pre>
      {truncated && <div className="dsh-json-block__more">
        {truncatedLabel ? truncatedLabel(full.length) : `… truncated, ${full.length} characters total`}
      </div>}
    </details>
  )
}

/* ------------------------------------------------------------------ *
 * 4. MarkdownText — injectable VS Code renderer + safe text fallback
 * ------------------------------------------------------------------ */

export interface MarkdownRenderOptions {
  text: string
  streaming: boolean
  labels?: MarkdownLabels
  variant?: string
  fileMentions?: unknown
  pathImages?: { resolve?: (value: string) => string | undefined }
}

/**
 * A renderer returns a DOM Node (or HTML string) for one Markdown fragment.
 * The Lead wires VS Code's `chatContentMarkdownRenderer` into this slot from
 * the single seam; the sidecar never imports VS Code src/.
 */
export type MarkdownDomRenderer = (options: MarkdownRenderOptions) => Node | string | void

let markdownDomRenderer: MarkdownDomRenderer | null = null

export function setMarkdownDomRenderer(renderer: MarkdownDomRenderer | null): void {
  markdownDomRenderer = renderer
}

export function getMarkdownDomRenderer(): MarkdownDomRenderer | null {
  return markdownDomRenderer
}

export interface MarkdownTextProps extends MarkdownRenderOptions {
  className?: string
}

export function MarkdownText({ text, streaming = false, labels, variant, fileMentions, pathImages, className }: MarkdownTextProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const renderer = markdownDomRenderer
  const options: MarkdownRenderOptions = { text, streaming, labels, variant, fileMentions, pathImages }

  useEffect(() => {
    const host = hostRef.current
    if (!host || renderer === null) return
    host.replaceChildren()
    try {
      const result = renderer(options)
      if (result instanceof Node) host.appendChild(result)
      else if (typeof result === 'string') host.innerHTML = result
      // A void return means the renderer owns the host asynchronously.
    } catch {
      host.textContent = text
    }
  }, [text, streaming, labels, variant, fileMentions, pathImages, renderer])

  // NOTE (Lead): VS Code's chatContentMarkdownRenderer is intentionally NOT
  // bundled here. Set it once via `setMarkdownDomRenderer()` before mounting
  // parts. Until then, text is escaped by React and `white-space: pre-wrap`.
  return (
    <div
      ref={renderer === null ? undefined : hostRef}
      className={cx('dsh-markdown-text', className)}
      data-streaming={streaming || undefined}
      data-variant={variant}
    >
      {renderer === null ? text : undefined}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 5. useAnchoredPosition / 6. useDismissOnOutsidePointer
 * ------------------------------------------------------------------ */

export interface AnchoredPositionOptions {
  open: boolean
  anchorRef: { current: HTMLElement | null }
  panelRef: { current: HTMLElement | null }
  side?: 'top' | 'bottom'
  gap?: number
  margin?: number
}

/** Viewport-clamped fixed placement for a portaled panel. `null` = measure pass. */
export function useAnchoredPosition({
  open, anchorRef, panelRef, side = 'top', gap = 8, margin = 12,
}: AnchoredPositionOptions): Style | null {
  const [pos, setPos] = useState<Style | null>(null)
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = (): void => {
      const anchor = anchorRef.current
      const panel = panelRef.current
      if (!anchor || !panel) return // panel mounts in the same commit; next tick measures
      const a = anchor.getBoundingClientRect()
      const p = panel.getBoundingClientRect()
      const clamp = (v: number, lo: number, hi: number): number =>
        Math.max(lo, Math.min(v, Math.max(lo, hi)))
      const left = clamp(a.left + a.width / 2 - p.width / 2, margin, window.innerWidth - p.width - margin)
      let top = side === 'top' ? a.top - gap - p.height : a.bottom + gap
      if (side === 'top' && top < margin) top = a.bottom + gap // flip below
      top = clamp(top, margin, window.innerHeight - p.height - margin)
      setPos({ position: 'fixed', left: `${left}px`, top: `${top}px` })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, side, gap, margin, anchorRef, panelRef])
  return pos
}

/** Close on outside pointerdown / capture-phase click; portaled panel counts as inside. */
export function useDismissOnOutsidePointer(
  rootRef: { current: HTMLElement | null },
  open: boolean,
  setOpen: (open: boolean) => void,
  panelRef?: { current: HTMLElement | null },
): void {
  useEffect(() => {
    if (!open) return
    const outside = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      if (panelRef?.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('click', outside, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('click', outside, true)
    }
  }, [open, setOpen, rootRef, panelRef])
}

/* ------------------------------------------------------------------ *
 * 7–9. path / size helpers
 * ------------------------------------------------------------------ */

/** Lower-case extension without the dot; '' for dotfiles and extensionless paths. */
export function fileExtension(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function fileSizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'css', 'scss', 'less',
  'html', 'vue', 'svelte', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cc', 'cpp',
  'cs', 'rb', 'php', 'sh', 'bash', 'yml', 'yaml', 'toml', 'sql', 'md', 'xml',
])

export interface FileTypeIconProps {
  path: string
  className?: string
  size?: number
}

export function FileTypeIcon({ path, className, size }: FileTypeIconProps) {
  const ext = fileExtension(path)
  return <IconFileOutlineRegular
    className={className}
    size={size}
    glyph={CODE_EXTENSIONS.has(ext) ? 'codicon-file-code' : 'codicon-file'}
  />
}

/* ------------------------------------------------------------------ *
 * 10–14. five Icon* symbols (VS Code codicon CSS classes)
 * ------------------------------------------------------------------ */

export interface IconProps {
  size?: number
  className?: string
  glyph?: string
  title?: string
}

function Codicon({ glyph, size, className, title }: IconProps & { glyph: string }) {
  return <span
    className={cx('codicon', glyph, 'dsh-icon', className)}
    style={size === undefined ? undefined : { fontSize: `${size}px`, width: `${size}px`, height: `${size}px` }}
    aria-hidden={title === undefined ? true : undefined}
    title={title}
  />
}

export function IconThinkOutlineRegular(props: IconProps) {
  return <Codicon glyph="codicon-lightbulb" {...props} />
}
export function IconDatabaseOutlineRegular(props: IconProps) {
  return <Codicon glyph="codicon-database" {...props} />
}
export function IconGaugeOutlineRegular(props: IconProps) {
  return <Codicon glyph="codicon-dashboard" {...props} />
}
export function IconChevronRightRegular(props: IconProps) {
  return <Codicon glyph="codicon-chevron-right" {...props} />
}
export function IconFileOutlineRegular(props: IconProps) {
  return <Codicon glyph={props.glyph ?? 'codicon-file'} {...props} />
}

/* ------------------------------------------------------------------ *
 * 15–16. Added for ui-chat 0.2.2-rc.1 (honest local shims):
 *   - UserMessageBubble : the shared user-message surface (a styled div; upstream body is ~14 lines).
 *   - Tooltip           : the upstream primitive is 273 lines (portal/placement/ShortcutKeys/...);
 *                         we honestly shim it to a native `title` instead of copying that closure.
 * ------------------------------------------------------------------ */

/** Mirror of @deepseek-ai/dsh-client-ui-primitives UserMessageBubble (a theme-aware div). */
export function UserMessageBubble({ className, children, ...props }: any) {
  return <div {...props} className={cx('dsh-user-bubble', className)}>{children}</div>
}

export interface TooltipProps {
  /** Plain-text label; rendered as the native title (rich-node labels degrade to a description). */
  label?: unknown
  shortcutKeys?: readonly string[]
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'center' | 'end'
  delayMs?: number
  focusDelayMs?: number
  gap?: number
  disabled?: boolean
  portal?: boolean
  maxWidth?: number
  openOnClick?: boolean
  onlyWhenClipped?: boolean
  children?: any
}

/** Honest shim: native title tooltip, preserving child semantics; no portal/placement machinery. */
export function Tooltip({ label, children, disabled, shortcutKeys, ...rest }: TooltipProps) {
  const title = disabled || label === undefined || label === null
    ? undefined
    : typeof label === 'string' || typeof label === 'number'
      ? String(label)
      : Array.isArray(shortcutKeys) && shortcutKeys.length > 0
        ? shortcutKeys.join(' / ')
        : undefined
  // Drop DSH-only props so they never leak onto the DOM node.
  void rest
  if (!children || typeof children !== 'object') return children ?? null
  return <span className="dsh-tooltip-anchor" title={title}>{children}</span>
}

export default {
  DisclosureRow, TextShimmer, JsonBlock, MarkdownText,
  useAnchoredPosition, useDismissOnOutsidePointer,
  fileExtension, FileTypeIcon, fileSizeText,
  IconThinkOutlineRegular, IconDatabaseOutlineRegular, IconGaugeOutlineRegular,
  IconChevronRightRegular, IconFileOutlineRegular,
  UserMessageBubble, Tooltip,
}
