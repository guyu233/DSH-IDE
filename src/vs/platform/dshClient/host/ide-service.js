// src/vs/platform/dshClient/host/ide-service.js
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

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

export class IdeRemoteService extends Service {
  constructor(ctx, config = {}) {
    super(ctx, 'ide');
    this.root = config.root || process.cwd();
    // 端点文件在插件目录下；回退到 root 是为了兼容旧布局，但正常永远走 pluginRoot。
    this.pluginRoot = config.pluginRoot || this.root;
    /** 已报到的 IDE 进程（clientId → 开窗入口）。 */
    this.ideClients = new Map();
    /** IDE 尚未报到时暂存的开窗请求（报到后经 pollLaunch 取走）。 */
    this.launchQueue = [];
    /** 最近一次拉起 IDE 进程的时间（防重复拉起）。 */
    this.spawnedAt = undefined;
    /** IDE 页面服务（server 模式）的 URL 与子进程。 */
    this.idePage = undefined;
    this.idePageStarting = undefined;
    this.idePageError = undefined;
    this.ideServerChild = undefined;
    this.typertRemote = bindTypertRemote(this, 'ide', { namespace: 'ide' });
  }

  ping() {
    return { ok: true, root: this.root, hostPid: process.pid };
  }

  /**
   * 开窗（P5）：DSH 主窗口点「DSH-IDE」时调用。
   *
   * 为什么走这里：`client.js` 跑在 DSH Web 渲染进程，碰不到 IDE 主进程的 `dshIde` 通道；
   * 它只能经官方 Typert Gateway 调 Host 服务。Host 侧再把请求转给已发布的 IDE 端点。
   *
   * 不做「假装成功」：没有可用端点时返回明确失败，由按钮显示错误。
   * @returns {{ ok: boolean, message?: string }}
   */
  launch(workspace) {
    // 1) 参数校验（会话/工作区由调用方给，Host 不猜）。
    if (workspace !== undefined && typeof workspace !== 'string') {
      return { ok: false, message: 'launch(workspace) must be a string when provided' };
    }

    // 2) 已经有一个 IDE 进程报到了：它在自己的进程里开窗（R1：IDE 是插件载荷，不是外部应用）。
    const ready = [...this.ideClients].find(client => client.alive);
    if (ready !== undefined) {
      ready.launch({ ...(workspace === undefined ? {} : { workspace }) });
      return { ok: true, via: 'registered-ide' };
    }

    // 3) 还没有 IDE 报到：这是**首次点击**，由 Host 拉起 IDE 进程（插件载荷，不是独立应用）。
    const endpoint = this.ideEndpoint();
    if (endpoint === undefined) {
      return {
        ok: false,
        message: `no IDE process has registered yet; endpoint file not found (looked in ${this.endpointCandidates().join(' , ')})`,
      };
    }
    const spawned = this.spawnIdeProcess(endpoint);
    if (spawned.ok !== true) {
      return { ok: false, message: spawned.message };
    }
    // 记住这个工作区请求：IDE 报到后会经 pollLaunch 取走它并开窗。
    this.launchQueue.push({ ...(workspace === undefined ? {} : { workspace }) });
    return { ok: true, via: 'spawned-ide' };
  }

  /**
   * 拉起 IDE 进程（首次点击）。
   *
   * 为什么由 Host 拉起：`client.js` 在 DSH Web 渲染进程，只能调 Host 服务；而 IDE 窗口是
   * 插件载荷 `runtime/app`（不是独立安装包），由插件自己的 Host 半身启动最直接，
   * 也不需要任何私有握手——启动参数只带官方端点三件套，数据仍走官方客户端传输。
   *
   * @returns {{ ok: boolean, message?: string }}
   */
  spawnIdeProcess(endpoint) {
    const appPath = join(this.pluginRoot, 'runtime', 'app');
    const entry = join(appPath, 'out', 'main.js');
    if (!existsSync(entry)) {
      return { ok: false, message: `IDE payload is missing: ${entry}` };
    }
    // 载荷是 appOnly（不含 Electron）。用宿主的 Electron 可执行文件去跑它**不会**生效：
    // 打包版 Electron 恒定优先加载 `<install>/resources/app.asar`，位置参数被忽略
    // （2026-11-09 实测：进程起来了但窗口标题仍是 DeepSeek Harness）。
    // 因此没有自带 Electron 时只能如实失败，绝不误拉起第二个 DSH。
    const hasOwnElectron = existsSync(join(appPath, 'DSH-IDE.exe')) || existsSync(join(appPath, 'electron.exe'));
    if (!hasOwnElectron) {
      return {
        ok: false,
        message: 'IDE payload is appOnly (no bundled Electron); a native IDE window cannot be started this way',
      };
    }
    // 防抖：刚拉起过就不再重复拉起（IDE 启动需要几秒）。
    const now = Date.now();
    if (this.spawnedAt !== undefined && now - this.spawnedAt < 60000) {
      return { ok: true };
    }
    try {
      // `process.execPath` 是本 Host 子进程所用的 Electron 可执行文件；去掉 RUN_AS_NODE 才是 GUI 模式。
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      env.DSH_IDE_ENDPOINT = endpoint.origin;
      env.DSH_IDE_LAUNCH_URL = endpoint.launchUrl;
      const child = spawn(process.execPath, [appPath], { detached: true, stdio: 'ignore', env });
      child.unref();
      this.spawnedAt = now;
      return { ok: true };
    } catch (error) {
      return { ok: false, message: `failed to spawn IDE process: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * 启动 IDE 页面服务（S2）。
   *
   * 复用上游 VS Code **官方 server 模式**（`out/server-main.js`）：它既提供 web workbench 页面，
   * 又跑真实扩展宿主，正是「给 DSH 应用加一个 IDE 页面」的官方承载方式（2026-11-09 实测：
   * `Web UI available at http://…` + `Extension host agent started`，首页 200）。
   *
   * 数据目录固定在插件自有路径，不污染用户的 `~/.vscode-server`。
   * 幂等：重复调用返回同一个 URL；启动失败返回 undefined 并记录原因。
   *
   * @returns {Promise<string|undefined>} workbench 的 origin（失败为 undefined）
   */
  async ensureIdePage() {
    if (this.idePage !== undefined) {
      return this.idePage.url;
    }
    if (this.idePageStarting !== undefined) {
      return this.idePageStarting;
    }
    this.idePageStarting = this.startIdePageServer().finally(() => {
      this.idePageStarting = undefined;
    });
    return this.idePageStarting;
  }

  /** 真正拉起 server，并从 stdout 解析出 URL。 */
  startIdePageServer() {
    const entry = process.env.DSH_IDE_SERVER_ENTRY || join(this.pluginRoot, 'runtime', 'app', 'out', 'server-main.js');
    if (!existsSync(entry)) {
      this.idePageError = `IDE page entry is missing: ${entry}`;
      return Promise.resolve(undefined);
    }
    const dataDir = join(this.pluginRoot, 'runtime', 'ide-data');
    const args = [
      entry,
      '--without-connection-token',
      '--host', '127.0.0.1',
      '--port', '0',
      '--extensions-dir', join(dataDir, 'extensions'),
      '--user-data-dir', join(dataDir, 'user-data'),
    ];
    return new Promise(resolve => {
      let settled = false;
      const finish = url => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(url);
      };
      const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
      const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      this.ideServerChild = child;
      let buffer = '';
      let stderrBuffer = '';
      const onData = chunk => {
        buffer += String(chunk);
        const match = /Web UI available at (https?:\/\/[^\s]+)/.exec(buffer);
        if (match !== null && this.idePage === undefined) {
          this.idePage = { url: match[1].replace(/\/$/, ''), pid: child.pid };
          console.log(`[dsh-ide] IDE page available: ${this.idePage.url}`);
          finish(this.idePage.url);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', chunk => {
        stderrBuffer += String(chunk);
        onData(chunk);
      });
      child.on('exit', code => {
        this.idePage = undefined;
        this.ideServerChild = undefined;
        if (!settled) {
          this.idePageError = `IDE page server exited with code ${code}: ${stderrBuffer.slice(-400)}`;
          console.warn(`[dsh-ide] ${this.idePageError}`);
          finish(undefined);
        }
      });
      // 上限：server 首次启动要装默认扩展，给足 90s。
      setTimeout(() => {
        if (!settled) {
          this.idePageError = 'IDE page server did not report a URL within 90s';
          console.warn(`[dsh-ide] ${this.idePageError}`);
          finish(undefined);
        }
      }, 90000).unref?.();
      // 空跑兜底：child 已退出时 Promise 已由 exit 处理。
      void child;
    });
  }

  /**
   * IDE 页面地址（供 client 半身拿来实现页面入口）。
   *
   * 不做「假装成功」：拿不到就返回明确原因，由按钮/入口显示错误。
   * @returns {Promise<{ ok: boolean, url?: string, message?: string }>}
   */
  async idePageUrl() {
    const url = await this.ensureIdePage();
    if (url === undefined) {
      return { ok: false, message: this.idePageError ?? 'IDE page server is not available' };
    }
    return { ok: true, url };
  }

  /**
   * IDE 进程报到：登记一个可开窗的客户端。
   *
   * 为什么需要它：`dshIde` 是 **IDE 自己的** IPC 通道，Host 在另一个进程，无法跨进程直接调用它。
   * 因此由 IDE 启动时主动向 Host 报到（官方 Typert Gateway），Host 只保存一个回调；
   * 按钮触发时经该回调让 IDE 自己开窗。这是唯一不引入私有管道的做法（第 7 章 §3.1 裁定）。
   *
   * @param clientId - IDE 侧生成的标识（用于注销）
   * @returns 注销函数（进程退出时调用）
   */
  registerIdeClient(clientId) {
    if (typeof clientId !== 'string' || clientId === '') {
      return { ok: false, message: 'clientId must be a non-empty string' };
    }
    const existing = this.ideClients.get(clientId);
    if (existing !== undefined) {
      existing.alive = true;
      return { ok: true, alreadyRegistered: true };
    }
    /** @type {((spec: { workspace?: string }) => void) | undefined} */
    let onLaunch;
    const pending = [];
    const client = {
      alive: true,
      launch(spec) {
        if (onLaunch === undefined) {
          pending.push(spec);
          return;
        }
        onLaunch(spec);
      },
      /** IDE 侧每次轮询取走待处理的开窗请求（长轮询式，不建第二条通道）。 */
      poll() {
        const requests = pending.splice(0, pending.length);
        return { requests };
      },
      /** IDE 侧提供实际开窗入口（在它的渲染进程里执行）。 */
      setLaunchHandler(handler) {
        onLaunch = handler;
        while (pending.length > 0) {
          const spec = pending.shift();
          if (spec !== undefined) {
            handler(spec);
          }
        }
        return { ok: true };
      },
      dispose() {
        this.alive = false;
      },
    };
    this.ideClients.set(clientId, client);
    return {
      ok: true,
      dispose: () => {
        client.dispose();
        this.ideClients.delete(clientId);
      },
    };
  }

  /** IDE 侧轮询待开窗请求（由 `registerIdeClient` 建立的登记项）。 */
  pollLaunch(clientId) {
    const client = this.ideClients.get(clientId);
    if (client === undefined) {
      return { ok: false, requests: [] };
    }
    // 先取该客户端自己的待办，再补上「报到前排队」的首次开窗请求。
    const own = client.poll();
    const outOfBand = this.launchQueue.splice(0, this.launchQueue.length);
    return { ok: true, requests: [...outOfBand, ...own.requests] };
  }

  /** 读取已发布的 IDE 端点（由 host/ide-view-host.js 的 publishHostEndpoint 写入）。 */
  /** 端点文件的候选路径（第一个是正确位置，第二个仅为旧布局兼容）。 */
  endpointCandidates() {
    return [
      join(this.pluginRoot, 'runtime', 'host-endpoint.json'),
      join(this.root, 'runtime', 'host-endpoint.json'),
    ];
  }

  ideEndpoint() {
    for (const file of this.endpointCandidates()) {
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // 继续试下一个
      }
    }
    return undefined;
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
      { method: 'launch', invocation: { kind: 'direct' } },
      { method: 'registerIdeClient', invocation: { kind: 'direct' } },
      { method: 'pollLaunch', invocation: { kind: 'direct' } },
      { method: 'idePageUrl', invocation: { kind: 'direct' } },
    ],
  },
});

export default IdeRemoteService;
