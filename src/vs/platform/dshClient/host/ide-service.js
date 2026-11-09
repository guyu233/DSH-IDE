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
import { dirname, join } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';
import { materializeElectronHome } from './electron-home.js';
import { IdeLaunchQueue } from './ide-launch-queue.js';

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

export class IdeRemoteService extends Service {
  constructor(ctx, config = {}) {
    super(ctx, 'ide');
    this.root = config.root || process.cwd();
    // 端点文件在插件目录下；回退到 root 是为了兼容旧布局，但正常永远走 pluginRoot。
    this.pluginRoot = config.pluginRoot || this.root;
    /** IDE 客户端登记表（报到 / 暂存开窗请求 / 轮询取走）。 */
    this.launchQueue = new IdeLaunchQueue();
    /** 最近一次拉起 IDE 进程的时间（防重复拉起）。 */
    this.spawnedAt = undefined;
    /** Electron 主页的物化进行中/已完成 Promise（并发首点只建一次）。 */
    this.electronHomeBuild = undefined;
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
  async launch(workspace) {
    // 1) 参数校验（会话/工作区由调用方给，Host 不猜）。
    if (workspace !== undefined && typeof workspace !== 'string') {
      return { ok: false, message: 'launch(workspace) must be a string when provided' };
    }

    // 2) 已经有一个 IDE 进程报到了：它在自己的进程里开窗（R1：IDE 是插件载荷，不是外部应用）。
    const spec = { ...(workspace === undefined ? {} : { workspace }) };
    if (this.launchQueue.dispatch(spec)) {
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
    const spawned = await this.spawnIdeProcess(endpoint, workspace);
    if (spawned.ok !== true) {
      return { ok: false, message: spawned.message };
    }
    // 记住这个工作区请求：IDE 报到后会经 pollLaunch 取走它并开窗。
    this.launchQueue.enqueue(spec);
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
  async spawnIdeProcess(endpoint, workspace) {
    const appPath = join(this.pluginRoot, 'runtime', 'app');
    const entry = join(appPath, 'out', 'main.js');
    if (!existsSync(entry)) {
      return { ok: false, message: `IDE payload is missing: ${entry}` };
    }
    // 防抖：刚拉起过就不再重复拉起（IDE 启动需要几秒）。
    const now = Date.now();
    if (this.spawnedAt !== undefined && now - this.spawnedAt < 60000) {
      return { ok: true };
    }
    const home = await this.ensureElectronHome(appPath);
    if (home.ok !== true) {
      return { ok: false, message: home.message };
    }
    try {
      // `process.execPath` 所属目录就是 DSH 自带的 Electron 发行版；`home.exe` 是它的硬链接副本，
      // **位于我们自己的 `resources/app` 旁边**，因此它会加载我们的载荷（实测窗口标题 = DSH IDE）。
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      env.DSH_IDE_ENDPOINT = endpoint.origin;
      env.DSH_IDE_LAUNCH_URL = endpoint.launchUrl;
      // 不传载荷目录作为位置参数：主页的 `resources/app` 已经指向插件载荷。
      // 位置参数只承载「要打开的工作区」，与 VS Code CLI 语义一致（首次点击即打开当前工作区）。
      const args = typeof workspace === 'string' && workspace !== '' ? [workspace] : [];
      const child = spawn(home.exe, args, { detached: true, stdio: 'ignore', env, cwd: appPath });
      child.unref();
      this.spawnedAt = now;
      return { ok: true };
    } catch (error) {
      return { ok: false, message: `failed to spawn IDE process: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * 物化/复用「Electron 主页」（实现与纪律见 host/electron-home.js）。
   *
   * 并发首点只建一次：整个构建 memo 成 Promise，失败后清空以便下次重试。
   * @param {string} appPath 插件载荷 `runtime/app`
   * @returns {Promise<{ ok: boolean, exe?: string, message?: string }>}
   */
  ensureElectronHome(appPath) {
    if (this.electronHomeBuild !== undefined) {
      return this.electronHomeBuild;
    }
    this.electronHomeBuild = Promise.resolve(materializeElectronHome({
      pluginRoot: this.pluginRoot,
      installRoot: dirname(process.execPath),
      exePath: process.execPath,
      appPath,
      electronVersion: process.versions.electron ?? 'unknown',
    })).catch(error => ({
      ok: false,
      message: `failed to materialize Electron home: ${error instanceof Error ? error.message : String(error)}`,
    })).then(result => {
      if (result.ok !== true) {
        // 失败不缓存：DSH 升级或卷变更后下一次点击可重试。
        this.electronHomeBuild = undefined;
      }
      return result;
    });
    return this.electronHomeBuild;
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
    return this.launchQueue.register(clientId);
  }

  /** IDE 侧轮询待开窗请求（由 `registerIdeClient` 建立的登记项）。 */
  pollLaunch(clientId) {
    return this.launchQueue.poll(clientId);
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
    ],
  },
});

export default IdeRemoteService;
