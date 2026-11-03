// dsh-ide/host/ide-service.js
// DSH-IDE 官方 @Remote IDE 扩展服务（命名空间 `ide`，走官方 Typert Gateway / @Remote）。
//
// v2 D4：agent 的读写/终端/LSP 已由官方 tool-fs/tool-lsp/tool-bash 提供（在本 Host 内执行）；
// 本服务只补「IDE 专属」能力，供 VS Code 渲染器经官方连接调用（ctx.remote.ide.*）：
//   - ping()                                     连通自检
//   - readFile(path) / listDir(path)             读取（受 root 约束，见 ide-fs.js）
//   - inlineComplete(prefix, suffix, languageId, path)  行内补全（后端 DSH；失败返回空）
//   - diagnostics(path)                          诊断占位（VS Code LSP 直接在 VS Code 内提供）
//
// 注册方式（纯 JS，避免 TS 装饰器）：Service + bindTypertRemote + 原型 marker 描述符
// （与 @deepseek-ai/dsh-typert-protocol 的 @Remote 生成物同构：REMOTE_METHOD_DESCRIPTOR 版本 1）。
// 说明：SRC/strict 派发语义需在真实 Host 复核；本服务失败不影响其它功能（客户端优雅降级）。

import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';
import { makeResolve, readFileAt, listDirAt } from './ide-fs.js';

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

export class IdeRemoteService extends Service {
  constructor(ctx, config = {}) {
    super(ctx, 'ide');
    this.root = config.root || process.cwd();
    this.resolve = makeResolve(this.root);
    // 绑定到 Typert Gateway 的 `ide` 命名空间（供 ctx.remote.ide.* 发现）。
    this.typertRemote = bindTypertRemote(this, 'ide', { namespace: 'ide' });
  }

  ping() {
    return { ok: true, root: this.root, hostPid: process.pid };
  }

  async readFile(filePath) {
    return readFileAt(this.resolve, filePath);
  }

  async listDir(dirPath) {
    return listDirAt(this.resolve, dirPath);
  }

  /**
   * 行内补全（后端 DSH）。R5 骨架：若 Host 暴露 ctx.llm 且可生成，则用之；否则返回空（客户端降级）。
   */
  async inlineComplete(prefix, suffix, languageId, filePath) {
    try {
      const llm = this.ctx.get && this.ctx.get('llm');
      if (!llm || typeof llm.complete !== 'function') { return { text: '' }; }
      const prompt = `Complete the code after the cursor. Return ONLY the completion text.\nLanguage: ${languageId || 'text'}\nFile: ${filePath || ''}\n<prefix>\n${String(prefix || '')}\n</prefix>\n<suffix>\n${String(suffix || '')}\n</suffix>`;
      const out = await llm.complete({ prompt, maxTokens: 128 });
      return { text: typeof out === 'string' ? out : (out && out.text) || '' };
    } catch { return { text: '' }; }
  }

  diagnostics(_filePath) {
    // Host 侧拿不到 VS Code 的语言服务器诊断；返回空（诊断由 VS Code 内建 LSP 直接提供）。
    return { diagnostics: [] };
  }
}

// 原型 marker 描述符（等价 @Remote('ping'|'readFile'|...) 的生成物，SRC 源模式发现用）。
Object.defineProperty(IdeRemoteService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: {
    version: 1,
    methods: [
      { method: 'ping', invocation: { kind: 'direct' } },
      { method: 'readFile', invocation: { kind: 'direct' } },
      { method: 'listDir', invocation: { kind: 'direct' } },
      { method: 'inlineComplete', invocation: { kind: 'direct' } },
      { method: 'diagnostics', invocation: { kind: 'direct' } },
    ],
  },
});

export default IdeRemoteService;
