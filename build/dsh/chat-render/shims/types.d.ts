/**
 * Erasable type stubs for the DSH ui-chat leaf sources copied into ../dsh/.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The upstream `import type` edges of ui-chat reach into the Cordis/plugin
 * graph (453 files / 58 packages). All of those imports are ERASED by esbuild's
 * TypeScript loader, so the sidecar build never resolves them. This file gives
 * the copied sources a truthful, minimal, LOCAL vocabulary instead of pulling
 * in `@deepseek-ai/dsh-client-ui-primitives` (127 files) or any other package.
 *
 * Nothing here emits runtime code. `any` is intentional: these are boundary
 * stubs for a build that does not run `tsc` (upstream src/tsconfig has no jsx,
 * no @types/react, and includes only `*.ts`). See README.md §2.
 */

/* Local stand-in for React's ReactNode (avoids depending on @types/react). */
type ReactNode = any;

/** Locale seat. `params` feeds `{name}` interpolation in ../translate.ts. */
export type Translate<K extends string = string> = (
  key: K,
  params?: Record<string, string | number>,
) => string;

/** The Chat slot props bag; only `t` is read by the copied leaf files. */
export interface ChatViewSlotProps {
  t: Translate;
  [key: string]: any;
}

/** Labels produced by ../src/markdown-labels.ts. */
export interface MarkdownLabels {
  code: {
    copyLabel: string;
    copiedLabel: string;
    toolbarLabels: { codeLabel: string; wrapLabel: string; unwrapLabel: string };
  };
  footnotes: string;
}

/** Assistant content blocks consumed by AssistantMarkdown / turn-assistant. */
export type AssistantBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'image'; attachment: any }
  | { kind: 'tool-call'; [key: string]: any }
  | { kind: string; block: any; [key: string]: any };

/** Ranked work categories for process titles. */
export interface ProcessActivitySummary {
  counts: ReadonlyArray<{ kind: string; [key: string]: any }>;
  [key: string]: any;
}

/** `renderSlot(id, slotProps)` — the only slot member the leaves use. */
export type PropsRenderSlots<I extends string = string> = {
  renderSlot: (id: I, slotProps: any) => ReactNode;
};

/** Factory slot renderer (body/user content adapters). */
export interface PropsRenderFactories {
  renderFactorySlot: (id: string, props: any) => ReactNode;
}

export interface PropsRuntime<I extends string = string> {
  renderFactorySlot: (id: I, props: any) => ReactNode;
}

/**
 * Factory component props. Two ids are actually used by the copied leaves;
 * everything else falls back to a permissive bag.
 */
export type FactoryComponentPropsOf<I extends string = string> =
  I extends 'conversation.chat.reasoning.content'
    ? { text: string; running: boolean; labels?: MarkdownLabels; t: Translate }
    : I extends 'conversation.chat.user.content'
      ? {
          content: {
            text: string;
            attachments: ReadonlyArray<any>;
            extraBlocks: ReadonlyArray<any>;
            referenceLabels?: ReadonlyArray<string>;
          };
          loadImage?: any;
          facts?: any;
          interactive?: boolean;
          ellipsis?: boolean;
          renderSlot: PropsRenderSlots['renderSlot'];
          renderFactorySlot: PropsRenderFactories['renderFactorySlot'];
          t: Translate;
        }
      : { [key: string]: any };

/** Independent disclosure hook (a function, not its return value). */
export type UseDisclosure = () => {
  expanded: boolean;
  setExpanded: (open: boolean) => void;
  toggle: () => void;
};

export type UsePresentation = <R>(
  selector: (policy: { settledReasoningPreview: boolean; [key: string]: any }) => R,
) => R;

/** Returns a ref object for the inline process anchor. */
export type UseGroupAction = (hidden: boolean, reveal: () => void) => any;

export interface ObservableSnapshot<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

export interface ChatNodeOwnerProps {
  loadImage?: (...args: any[]) => any;
}

export interface MarkdownPathImages {
  resolve: (value: string) => string | undefined;
}

export type MarkdownFileMentions = any;

/** Durable session projection read seat. */
export type UseProjection = (key: string) => any;

export interface InjectFace<T> {
  usePerformanceUsage: <R>(selector: (value: T) => R) => R;
}

export type PerformanceUsageInjected = 'compact' | 'detailed';

export type SnapshotSelectorHook<S> = <R>(selector: (snapshot: S) => R) => R;

export interface ChatSnapshot {
  legacy: { nodes: any[]; [key: string]: any };
  [key: string]: any;
}

export interface TokenUsageProjection {
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  [key: string]: any;
}

export interface TurnTokenUsage {
  totalTokens: number;
  outputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  routes?: ReadonlyArray<{ provider: string; model: string }>;
  [key: string]: any;
}

export interface AssistantMessageNode {
  timing?: {
    stepStartTime: number | null;
    firstTokenTime: number | null;
    completedTime: number;
    [key: string]: any;
  };
  usage?: { outputTokens?: number; [key: string]: any };
  [key: string]: any;
}

export interface ChatNode {
  location?: {
    kind?: string;
    turn?: {
      status?: string;
      end?: { data?: { reason?: { kind?: string } } };
    };
  };
  [key: string]: any;
}
