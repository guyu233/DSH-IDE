/**
 * Sidecar entry point for the DSH-IDE chat renderer.
 *
 * This is the ONLY module compiled into dist/dsh-chat.js. It exports:
 *   - `mountDshChatPart(domNode, props)` — imperative, React-free API used by
 *     VS Code's `chatListRenderer.ts` single seam; one createRoot per part.
 *   - `DshChatHandle`, `DshPartProps`, `DshChatPart` (React component),
 *     `setMarkdownDomRenderer`, `setLocale`, `injectDshChatStyles`, `t`,
 *     plus the pure logic helpers from ui-chat/src/client/**.
 *
 * IMPORTANT: React is bundled HERE, from exactly ONE copy
 * (vscode-1.143.1/node_modules/{react,react-dom} 18.3.1). VS Code src/ never
 * imports React or JSX; it only dynamic-imports this ESM file. See README.md.
 *
 * CSS is self-injected at mount time through `virtual:dsh-chat-css` (provided
 * by build-render.mjs as a JS string), because VS Code src cannot import .css.
 * The three real CSS imports below ONLY make esbuild also emit the standalone
 * dist/dsh-chat.css artifact for audit/debugging; they produce no runtime code.
 *
 * ORIGINAL sidecar code (not DSH source); see PROVENANCE.md.
 */

import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { css as DSH_CHAT_CSS, hash as DSH_CHAT_CSS_HASH } from 'virtual:dsh-chat-css'
import './shims/tokens.css'
import './shims/primitives.css'
import './dsh-chat.css'

/* ---- copied DSH leaf components (unchanged business logic) ---- */
import { AssistantMarkdown, localPathMediaUrl } from './src/chat/AssistantMarkdown.tsx'
import { ReasoningRow } from './src/chat/ReasoningRow.tsx'
import { ReasoningContent, DefaultReasoningBody } from './src/chat/ReasoningContent.tsx'
import { UserContent } from './src/chat/UserContent.tsx'
import { TurnUsagePanel } from './src/chat/TurnUsagePanel.tsx'
import { RunningStatus } from './src/chat/RunningStatus.tsx'
import { RunningWhaleTail } from './src/chat/RunningWhaleTail.tsx'
import {
  ActivityPill, UsagePill, deriveStats, formatDuration, cacheHitPercent, billedInputTokens,
} from './src/chat/StatsPills.tsx'

/* ---- copied DSH pure logic (unchanged) ---- */
export { reasoningText } from './src/reasoning-text.ts'
export { markdownLabels } from './src/markdown-labels.ts'
export { NS as CHAT_LOCALE_NS, zh as chatZhDictionary, en as chatEnDictionary } from './src/locale.ts'
export { formatRunDuration, formatTokensPerSecond, formatMessageClock, startOfLocalDay, msUntilNextLocalMidnight, LIVE_RUN_CLOCK_INTERVAL_MS } from './src/chat/message-chrome.ts'
export { formatTokens, formatExactTokens, formatCacheHitPercent } from './src/chat/token-format.ts'
export { assistantText } from './src/chat/turn-assistant.ts'
export { processTitle } from './src/chat/step-process.ts'
export { useStatDialog, MEASURE_STYLE } from './src/chat/stat-dialog.ts'
export { useDisclosure, bindDisclosure } from './src/chat/use-disclosure.ts'
export { hasAssistantReplyContent } from './src/contract/assistant-content.ts'
export { assistantStepReading } from './src/contract/turn-metrics.ts'
export { sameTurnProcessSpec, isSubagentDelegationTool, turnProcessAlwaysOpen } from './src/contract/turn-process.ts'
export {
  AssistantMarkdown, localPathMediaUrl, ReasoningRow, ReasoningContent, DefaultReasoningBody,
  UserContent, TurnUsagePanel, RunningStatus, RunningWhaleTail,
  ActivityPill, UsagePill, deriveStats, formatDuration, cacheHitPercent, billedInputTokens,
}

/* ---- shims ---- */
export { t, setLocale, getLocale, normalizeLocale, createTranslate, enDictionary, zhDictionary } from './shims/translate.ts'
export { setMarkdownDomRenderer, getMarkdownDomRenderer } from './shims/primitives.tsx'
export { fileMediaUrl } from './shims/workspace-path.ts'
export {
  DisclosureRow, TextShimmer, JsonBlock, MarkdownText,
  useAnchoredPosition, useDismissOnOutsidePointer,
  fileExtension, FileTypeIcon, fileSizeText,
} from './shims/primitives.tsx'
import { t as defaultT, setLocale } from './shims/translate.ts'
import { MarkdownText, setMarkdownDomRenderer } from './shims/primitives.tsx'
import { useDisclosure } from './src/chat/use-disclosure.ts'
import type {
  AssistantBlock, UseDisclosure as UseDisclosureType, UsePresentation, UseGroupAction,
  PropsRenderSlots, TurnTokenUsage, MarkdownFileMentions,
} from './shims/types'

/* ---- CSS injected at runtime (VS Code src cannot import .css) ---- */
const STYLE_ELEMENT_ID = 'dsh-chat-styles'

/**
 * Append the merged stylesheet once per document. Idempotent: a second call
 * with the same CSS hash does nothing. Called automatically by
 * mountDshChatPart().
 */
export function injectDshChatStyles(doc: Document | undefined = undefined): void {
  const target: Document | undefined = doc ?? (typeof document === 'undefined' ? undefined : document)
  if (!target) return
  const existing = target.getElementById(STYLE_ELEMENT_ID)
  if (existing && existing.getAttribute('data-dsh-chat-hash') === DSH_CHAT_CSS_HASH) return
  const style = existing ?? target.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.setAttribute('data-dsh-chat', '')
  style.setAttribute('data-dsh-chat-hash', DSH_CHAT_CSS_HASH)
  style.textContent = DSH_CHAT_CSS
  if (!existing) (target.head ?? target.documentElement).appendChild(style)
}

/** Expose the CSS text too, for gulp-side `<style>` injection if preferred. */
export const dshChatCss: string = DSH_CHAT_CSS
export const dshChatCssHash: string = DSH_CHAT_CSS_HASH

/* ---- exported props contract for the single seam ---- */

export type DshTranslate = (key: string, params?: Record<string, string | number>) => string

/** User attachment shape accepted by UserContent. */
export interface DshUserAttachment {
  type: 'file' | 'image'
  file?: { name: string; bytes: number }
  image?: any
}

/** Props for one `IChatContentPart`. `t`/`useDisclosure` are owned by sidecar. */
export type DshPartProps =
  | {
      /** One reasoning disclosure (collapsed by default). */
      kind: 'reasoning'
      text: string
      running?: boolean
      t?: DshTranslate
    }
  | {
      /** Assistant prose + reasoning + images (tool-call blocks are skipped). */
      kind: 'markdown'
      blocks: readonly AssistantBlock[]
      streaming?: boolean
      interrupted?: boolean
      reasoningHidden?: boolean
      groupPart?: string
      mentions?: MarkdownFileMentions
      t?: DshTranslate
    }
  | {
      /** User message bubble + attachments. */
      kind: 'user'
      content: {
        text: string
        attachments?: readonly DshUserAttachment[]
        extraBlocks?: readonly unknown[]
        referenceLabels?: readonly string[]
      }
      t?: DshTranslate
    }
  | {
      /** A completed turn's token-usage pill + details dialog. */
      kind: 'stats'
      usage: TurnTokenUsage
      t?: DshTranslate
    }
  | {
      /** Live "deep diving" clock with the real DSH whale APNG mask. */
      kind: 'running'
      startTime?: number
      label?: string
      /** Freeze the shown duration (0.2.2-rc.1 RunningStatus requires this). Defaults to false. */
      paused?: boolean
      /** Keep the slot hidden (0.2.2-rc.1: turn closed without an actions row). Defaults to false. */
      holding?: boolean
      t?: DshTranslate
    }

export interface DshChatHandle {
  /** Re-render the SAME root with new props (streaming deltas). */
  update(props: DshPartProps): void
  /** Unmount the root. Never call update() after this. */
  dispose(): void
  /** The domNode passed to mount, for IChatContentPart.domNode. */
  readonly domNode: HTMLElement
}

/** Stable hooks/policies — created once, shared by every part. */
const noop = (): void => {}
const useBoundDisclosure: UseDisclosureType = () => useDisclosure(0)
const usePresentation: UsePresentation = selector => selector({ settledReasoningPreview: true })
const useGroupAction: UseGroupAction = () => ({ current: null })

function resolveT(props: DshPartProps): DshTranslate {
  return props.t ?? defaultT
}

/** Reasoning content factory: MarkdownText with DSH's own labels. */
const reasoningFactory = (_id: string, props: any): ReactNode => createElement(MarkdownText, {
  text: String(props.text ?? ''),
  streaming: Boolean(props.running),
  variant: 'compact',
  labels: props.labels,
})

/** User text factory: escaped, pre-wrapped plain text. */
const userTextFactory = (_id: string, props: any): ReactNode => createElement('span', {
  className: 'dsh-user-text',
}, String(props.text ?? ''))

/** Minimal `renderSlot` adapter: images via <img>, reasoning body via Markdown. */
function makeRenderSlot(t: DshTranslate): PropsRenderSlots['renderSlot'] {
  return (id: string, slotProps: any): ReactNode => {
    if (id === 'conversation.chat.reasoning.body') {
      return createElement(ReasoningContent, {
        text: slotProps.text,
        running: slotProps.running,
        t,
      } as any)
    }
    if (id === 'conversation.chat.message.images' || id === 'conversation.chat.user.images') {
      const images: any[] = slotProps.images ?? []
      return createElement('div', { className: 'dsh-images' },
        ...images.map((img: any, i: number) => createElement('img', {
          key: i,
          src: typeof img === 'string' ? img : (img?.src ?? img?.url ?? ''),
          alt: img?.alt ?? '',
          loading: 'lazy',
        })))
    }
    return null
  }
}

/**
 * Normalize the single seam's structural props into the shapes the copied DSH
 * components actually expect. The seam (`dshChatSeam.ts`) deliberately uses a
 * dependency-free structural type, so it may send VS Code-flavoured shapes:
 *   - markdown blocks: `{ type: 'text', text }` instead of
 *     DSH's `{ kind: 'text', text }` (`type:'thinking'` → `kind:'reasoning'`);
 *   - stats usage: `{ promptTokens, completionTokens, totalTokens }` instead
 *     of DSH's `{ uncachedInputTokens, outputTokens, totalTokens, ... }`.
 * This is an ADAPTER ONLY: no DSH source file is modified. Idempotent.
 */
export function normalizeProps(raw: DshPartProps): DshPartProps {
  const props = raw as any
  if (props?.kind === 'markdown' && Array.isArray(props.blocks)) {
    const blocks = props.blocks.map((block: any) => {
      if (!block || block.kind !== undefined) return block
      const text = String(block.text ?? block.value ?? '')
      if (block.type === 'text') return { kind: 'text', text }
      if (block.type === 'thinking' || block.type === 'reasoning') return { kind: 'reasoning', text }
      if (block.type === 'tool-call' || block.type === 'tool_call') return { kind: 'tool-call', ...block }
      if (block.type === 'image') return { kind: 'image', attachment: block.attachment ?? block, ...block }
      return { kind: block.type ?? 'text', text, ...block }
    })
    return { ...props, blocks }
  }
  if (props?.kind === 'stats' && props.usage) {
    const u = props.usage
    const outputTokens = Number(u.outputTokens ?? u.completionTokens ?? 0)
    const uncachedInputTokens = Number(u.uncachedInputTokens ?? u.promptTokens
      ?? Math.max(0, Number(u.totalTokens ?? 0) - outputTokens))
    const totalTokens = Number(u.totalTokens ?? (uncachedInputTokens + outputTokens + Number(u.cacheReadTokens ?? 0) + Number(u.cacheWriteTokens ?? 0)))
    const usage: TurnTokenUsage = {
      ...u,
      totalTokens,
      outputTokens,
      uncachedInputTokens,
    }
    return { ...props, usage }
  }
  return raw
}

/** Build the React element for one part. Exported for tests / advanced seams. */
export function DshChatPart({ props: rawProps }: { props: DshPartProps }): ReactNode {
  const props = normalizeProps(rawProps) as DshPartProps
  const t = resolveT(props)
  const renderSlot = makeRenderSlot(t)
  const renderFactorySlot = (id: string, p: any): ReactNode =>
    id === 'conversation.chat.reasoning.content' ? reasoningFactory(id, p) : userTextFactory(id, p)

  switch (props.kind) {
    case 'reasoning':
      return createElement(ReasoningRow, {
        text: props.text,
        running: props.running ?? false,
        useDisclosure: useBoundDisclosure,
        usePresentation,
        renderSlot,
        t,
      })
    case 'markdown':
      return createElement(AssistantMarkdown, {
        blocks: props.blocks,
        streaming: props.streaming ?? false,
        interrupted: props.interrupted,
        reasoningHidden: props.reasoningHidden,
        groupPart: props.groupPart,
        mentions: props.mentions,
        useDisclosure: useBoundDisclosure,
        usePresentation,
        revealProcess: noop,
        useGroupAction,
        renderSlot,
        loadImage: undefined,
        t,
      } as any)
    case 'user':
      return createElement(UserContent, {
        content: {
          text: props.content.text,
          attachments: props.content.attachments ?? [],
          extraBlocks: props.content.extraBlocks ?? [],
          referenceLabels: props.content.referenceLabels ?? [],
        },
        renderSlot,
        renderFactorySlot,
        t,
      } as any)
    case 'stats':
      return createElement(TurnUsagePanel, { usage: props.usage, t })
    case 'running':
      return createElement(RunningStatus, {
        startTime: props.startTime,
        // 0.2.2-rc.1: `paused` is required and `holding` is optional; default to the
        // live-running behaviour unless the caller explicitly asks to freeze/hold.
        paused: props.paused ?? false,
        holding: props.holding ?? false,
        t: props.label === undefined ? t : ((key: string, params?: Record<string, string | number>) =>
          key === 'chat.deepDivingFor' || key === 'chat.deepDiving' ? props.label! : t(key, params)),
      })
    default:
      return null
  }
}

/**
 * Mount one DSH chat part into a VS Code `IChatContentPart.domNode`.
 * Creates exactly ONE React root; use update() for streaming deltas and
 * dispose() from the part's dispose(). React lives entirely inside this module.
 */
export function mountDshChatPart(domNode: HTMLElement, props: DshPartProps): DshChatHandle {
  injectDshChatStyles(domNode.ownerDocument)
  const root: Root = createRoot(domNode)
  let disposed = false
  const render = (rawNext: DshPartProps): void => {
    if (disposed) return
    root.render(createElement(DshChatPart as any, { props: normalizeProps(rawNext) }))
  }
  render(props)
  return {
    domNode,
    update(next: DshPartProps): void { render(next) },
    dispose(): void {
      if (disposed) return
      disposed = true
      root.unmount()
    },
  }
}

/** Default export for `await import('.../dsh-chat.js')`. */
export default {
  mountDshChatPart,
  DshChatPart,
  injectDshChatStyles,
  setMarkdownDomRenderer,
  setLocale,
  t: defaultT,
  dshChatCss,
  dshChatCssHash,
}
