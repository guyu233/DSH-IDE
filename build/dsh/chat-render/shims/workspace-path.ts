/**
 * Sidecar replacement for `@deepseek-ai/dsh-util-workspace-path#fileMediaUrl`.
 *
 * Only one symbol from that package is used by the copied ui-chat leaves
 * (AssistantMarkdown.localPathMediaUrl). The original implementation resolves a
 * Markdown image destination against the document's base URI. VS Code's chat
 * view is served from a `vscode-webview`/workbench origin where arbitrary local
 * paths are NOT addressable, so this shim is deliberately conservative:
 *   - http(s) / data / blob / vscode-resource style URLs pass through;
 *   - absolute or relative file paths are returned as `undefined`, which makes
 *     the Markdown renderer fall back to the authored destination.
 *
 * The Lead may replace this with an `asWebviewUri` bridge at the single seam;
 * no business logic in the copied sources depends on the exact URL shape.
 */

/** Decode one authored Markdown destination and resolve it to a usable URL. */
export function fileMediaUrl(base: string, path: string): string | undefined {
  const value = path.trim()
  if (value === '') return undefined
  // Already a usable absolute URL or an in-document reference.
  if (/^(?:https?:|data:|blob:|vscode-resource:|vscode-webview-resource:|file:)\/\//i.test(value)
    || /^(?:https?:|data:|blob:|vscode-resource:|vscode-webview-resource:|file:)/i.test(value)
    || value.startsWith('#')) {
    return value
  }
  try {
    const resolved = new URL(value, base || 'about:blank')
    // Only allow known-safe schemes; a workbench `http://` base plus a local
    // path would otherwise produce a misleading URL.
    if (resolved.protocol === 'http:' || resolved.protocol === 'https:'
      || resolved.protocol === 'data:' || resolved.protocol === 'blob:') {
      return resolved.href
    }
    return undefined
  } catch {
    return undefined
  }
}

export default { fileMediaUrl }
