// dsh-ide/host/ide-service.js
// DSH-IDE 官方 @Remote IDE 扩展服务（命名空间 `ide`，经官方 Typert Gateway 派发）。
//
// v2 / Q5：agent 的读写/终端/LSP 已由官方 tool-fs/tool-bash/tool-lsp 在 Host 内提供；
// 本服务只补「Host 侧能算、VS Code 需要」的极薄能力：
//   - ping()            连通自检
//   - inlineComplete(prefix, suffix, languageId, filePath)  行内补全（后端 ctx.llm.stream 真实现）
//
// 说明（已核验 app.asar 源码）：
//   - Typert Gateway 的 SRC 模式会从 Service 的 `typertRemote` 绑定 + 原型上的 @Remote marker 描述符
//     自动派发（gateway.resolveSrcDescriptor）。约束：方法参数名即线上字段名（无解构/默认值/rest），
//     结果须 JSON 安全；`signal` 若出现必须是最后一个参数。本服务满足。
//   - ctx.llm 无 complete()，只有 stream(options{provider,model,messages,maxTokens?,...}) 返回 chunk 流；
//     文本增量 chunk 形如 {type:'text-delta', text}（见 dsh-llm types）。此处按此实现，失败返回空串。

import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

export class IdeRemoteService extends Service {
  constructor(ctx, config = {}) {
    super(ctx, 'ide');
    this.root = config.root || process.cwd();
    this.typertRemote = bindTypertRemote(this, 'ide', { namespace: 'ide' });
  }

  ping() {
    return { ok: true, root: this.root, hostPid: process.pid };
  }

  /**
   * 行内补全：用官方 llm.stream 生成一段补全文本（后端 DSH）。
   * @returns {{ text: string }}；任何失败都返回空串（客户端优雅降级，不抛）。
   */
  async inlineComplete(prefix, suffix, languageId, filePath) {
    try {
      const llm = this.ctx.get && this.ctx.get('llm');
      if (!llm || typeof llm.stream !== 'function') { return { text: '' }; }
      const dm = this.ctx.get && this.ctx.get('agentDefaultModel');
      const sel = (dm && typeof dm.currentSelection === 'function') ? dm.currentSelection() : undefined;
      if (!sel || !sel.provider || !sel.model) { return { text: '' }; }
      const prompt = [
        'You are an inline code completion engine. Continue the code at the cursor.',
        'Return ONLY the exact text to insert at the cursor. No prose, no backticks, no explanation.',
        `Language: ${languageId || 'text'}`,
        filePath ? `File: ${filePath}` : '',
        '<prefix>',
        String(prefix || ''),
        '</prefix>',
        '<suffix>',
        String(suffix || ''),
        '</suffix>',
      ].filter(Boolean).join('\n');
      const request = {
        provider: sel.provider,
        model: sel.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        maxTokens: 192,
        ...(sel.reasoningEffort === undefined ? {} : { reasoningEffort: sel.reasoningEffort }),
      };
      const stream = llm.stream(request);
      let text = '';
      for await (const chunk of stream) {
        if (!chunk || typeof chunk !== 'object') { continue; }
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') { text += chunk.text; }
        else if (chunk.type === 'finish') { break; }
      }
      return { text: text.trim() };
    } catch {
      return { text: '' };
    }
  }
}

// 原型 @Remote marker 描述符（等价 @Remote('ping'|'inlineComplete') 的生成物，SRC 源模式发现用）。
Object.defineProperty(IdeRemoteService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: {
    version: 1,
    methods: [
      { method: 'ping', invocation: { kind: 'direct' } },
      { method: 'inlineComplete', invocation: { kind: 'direct' } },
    ],
  },
});

export default IdeRemoteService;
