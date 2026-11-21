// src/vs/platform/dshClient/host/ide-service.js
// DSH-IDE 官方 @Remote IDE 扩展服务（命名空间 `ide`，经官方 Typert Gateway 派发）。
//
// v2 / Q5：agent 的读写/终端/LSP 已由官方 tool-fs/tool-bash/tool-lsp 在 Host 内提供；
// 本服务只补「Host 侧能算、VS Code 需要」的极薄能力：
//   - ping()            连通自检
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
import { publishHostEndpoint, resolveHostEndpoint } from './ide-view-host.js';
import { safeErrorText } from '../common/dshIdeAuthRedaction.js';
import { DSH_IDE_HOST_PTY_PATH, DSH_IDE_HOST_RG_PATH, resolveHostNodePty, resolveHostRipgrep } from './host-ripgrep.js';
import { IdeLaunchQueue, ideWorkspaceArgs } from './ide-launch-queue.js';
import { projectDshIdeComposer } from '../common/dshIdeComposer.js';
// Host 与 IDE 共用同一份契约真源：字段白名单、方法校验与修订号只有一处定义。
import {
	DSH_IDE_WIRE_REVISION,
	requireDshIdeWireRevision,
	validateDshIdeInput,
	validateDshIdeViewBinding,
} from '../common/dshIdeProtocol.js';

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
    /** 最近一次拉起的 IDE 子进程句柄；防抖据此判断进程是否仍存活。 */
    this.ideChild = undefined;
    /**
     * 进行中的拉起。防抖只看 `ideChild`，而 `spawn` 之前有一段 await（物化主页、
     * 解析 ripgrep/node-pty、取 composerState）；这期间 `ideChild` 仍是 undefined，
     * 两个并发点击会各自通过防抖、各拉起一个窗口（真机可复现的双开）。
     * 这里把首个请求的 Promise 存下来，后到的请求直接复用同一结果。
     */
    this.launchInFlight = undefined;
    /** Electron 主页的物化进行中/已完成 Promise（并发首点只建一次）。 */
    this.electronHomeBuild = undefined;
    this.typertRemote = bindTypertRemote(this, 'ide', { namespace: 'ide' });
    // DSH-IDE 是 DSH 的插件：插件上下文销毁（DSH 退出 / 插件卸载）时必须关掉
    // 由本服务拉起的 IDE 窗口。子进程已不再 detached，这里再显式 kill 一次，
    // 覆盖「用户没关窗口就直接退出 DSH」的情况。
    ctx.effect(() => () => this.killIdeChild(), 'dsh-ide.ide-child-cleanup');
  }

  /** 关掉由本服务拉起的 IDE 子进程；没拉起过或已退出时是空操作。 */
  killIdeChild() {
    const child = this.ideChild;
    this.ideChild = undefined;
    this.spawnedAt = undefined;
    this.launchInFlight = undefined;
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    try {
      child.kill();
    } catch {
      // 进程可能已经消失：退出过程不抛错。
    }
  }

  ping() {
    // 声明本半身实现的线协议修订号：IDE 在建立任何业务调用之前先核这一项。
    return { ok: true, root: this.root, hostPid: process.pid, wireRevision: DSH_IDE_WIRE_REVISION };
  }

  /**
   * 本次调用是否来自可信的本地所有者。
   *
   * 依据官方 Gateway 在调用上下文提供的 `this.ctx.invocation.peer.principal`：它由 Host 在
   * 建立连接时固定，请求 DTO 里的任何字段都无法设置。没有调用上下文（进程内直接调用）时
   * 不做主体判断——那不是远程入口。
   * @returns {boolean}
   */
  _trustedCaller() {
    const invocation = this.ctx && typeof this.ctx === 'object' ? this.ctx.invocation : undefined;
    if (invocation === undefined) {
      return true;
    }
    const peer = invocation && typeof invocation === 'object' ? invocation.peer : undefined;
    const principal = peer && typeof peer === 'object' ? peer.principal : undefined;
    return principal !== null && typeof principal === 'object' && principal.kind === 'owner';
  }

  /** 远程入口的主体检查：不通过就明确拒绝，不降级成匿名调用。 */
  _requireTrustedCaller(entry) {
    if (!this._trustedCaller()) {
      throw Object.assign(new Error(`${entry} is only available to the local owner of this Host`), { code: 'dsh-ide/forbidden' });
    }
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
  async launch(workspace, sessionId) {
    // 与其余六个远程方法同一口径：launch 也能拉起本机进程，必须是可信本地主体。
    this._requireTrustedCaller('launch');
    // 1) 参数校验（会话/工作区由调用方给，Host 不猜）。
    if (workspace !== undefined && typeof workspace !== 'string') {
      return { ok: false, message: 'launch(workspace) must be a string when provided' };
    }
    if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.trim() === '')) {
      return { ok: false, message: 'launch(sessionId) must be a non-empty string when provided' };
    }

    // 2) 已经有一个 IDE 进程报到了：它在自己的进程里开窗（R1：IDE 是插件载荷，不是外部应用）。
    const spec = {
      ...(workspace === undefined ? {} : { workspace }),
      ...(sessionId === undefined ? {} : { sessionId }),
    };
    if (this.launchQueue.dispatch(spec)) {
      // 已报到的 IDE 若正挂在长轮询上，这条请求会立刻唤醒它；否则等它下一次 poll。
      // 这一刻只是「已交给在线的 IDE 进程」，还不能说窗口已经打开——如实标注，不抢跑。
      return { ok: true, via: 'registered-ide', opened: false, queued: true };
    }

    // 3) 还没有 IDE 报到：这是**首次点击**，由 Host 拉起 IDE 进程（插件载荷，不是独立应用）。
    // 端口以当前 webServer 为准，并回写端点文件。不能只读上次落盘的文件：
    // DSH 重启后端口会变，旧文件会让新窗口连到一个已经不存在的端口。
    const endpoint = await this.currentEndpoint();
    if (endpoint === undefined) {
      return {
        ok: false,
        message: `DSH host endpoint is not ready (webServer has no port, and no endpoint file at ${this.endpointCandidates().join(' , ')})`,
      };
    }
    const spawned = await this.spawnIdeProcess(endpoint, workspace, sessionId);
    if (spawned.ok !== true) {
      return { ok: false, message: spawned.message };
    }
    // 记住这个工作区请求：IDE 报到后会经 pollLaunch 取走它并开窗。
    this.launchQueue.enqueue(spec);
    // 进程起来了，但窗口还没开：`opened` 必须是 false。
    // 把「已排队」说成「已开窗」会让界面显示成功而用户看不到任何窗口。
    return { ok: true, via: 'spawned-ide', opened: false, queued: true };
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
  async spawnIdeProcess(endpoint, workspace, sessionId) {
    const appPath = join(this.pluginRoot, 'runtime', 'app');
    const entry = join(appPath, 'out', 'main.js');
    if (!existsSync(entry)) {
      return { ok: false, message: `IDE payload is missing: ${entry}` };
    }
    // 防抖：刚拉起过且该进程仍在运行就不再重复拉起（IDE 启动需要几秒）。
    // 进程已退出时不能沿用防抖——否则「IDE 被关掉后再点按钮」会静默返回成功却什么都不做。
    const now = Date.now();
    const lastChild = this.ideChild;
    const lastAlive = lastChild !== undefined && lastChild.exitCode === null && lastChild.signalCode === null;
    if (lastAlive && this.spawnedAt !== undefined && now - this.spawnedAt < 60000) {
      return { ok: true };
    }
    // 同一次拉起只跑一份：并发点击必须合流，否则会开出两个窗口。
    if (this.launchInFlight !== undefined) {
      return this.launchInFlight;
    }
    const inFlight = this._spawnIdeProcessOnce(appPath, workspace, sessionId, endpoint);
    this.launchInFlight = inFlight;
    try {
      return await inFlight;
    } finally {
      if (this.launchInFlight === inFlight) {
        this.launchInFlight = undefined;
      }
    }
  }

  /**
   * 真正执行一次拉起（由 `spawnIdeProcess` 做并发合流后调用）。
   *
   * 拆出来的原因：合流需要「先登记 Promise、再执行」，而执行体本身很长；
   * 混在一起会让 finally 清理和后续逻辑互相穿插，难读也易错。
   * @param {string} appPath IDE 载荷目录
   * @param {string | undefined} workspace 要打开的工作区
   * @param {string | undefined} sessionId 要订阅的会话
   * @param {{ origin: string, launchUrl: string }} endpoint 当前 Host 端点（含端口与 launch token）
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  async _spawnIdeProcessOnce(appPath, workspace, sessionId, endpoint) {
    const home = await this.ensureElectronHome(appPath);
    if (home.ok !== true) {
      return { ok: false, message: home.message };
    }
    if (typeof endpoint?.origin !== 'string' || endpoint.origin === '' || typeof endpoint?.launchUrl !== 'string' || endpoint.launchUrl === '') {
      return { ok: false, message: 'DSH host endpoint is missing origin or launchUrl' };
    }
    try {
      // 只把宿主搜索工具路径交给 IDE；不创建链接、不复制文件，避免任何清理动作影响宿主安装。
      const hostRipgrep = await resolveHostRipgrep();
      const hostNodePty = await resolveHostNodePty();
      // `process.execPath` 所属目录就是 DSH 自带的 Electron 发行版；`home.exe` 是它的硬链接副本，
      // **位于我们自己的 `resources/app` 旁边**，因此它会加载我们的载荷（实测窗口标题 = DSH IDE）。
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      env[DSH_IDE_HOST_RG_PATH] = hostRipgrep;
      env[DSH_IDE_HOST_PTY_PATH] = hostNodePty;
      env.DSH_IDE_ENDPOINT = endpoint.origin;
      env.DSH_IDE_LAUNCH_URL = endpoint.launchUrl;
      // 端点文件路径（本插件的 runtime 目录）：IDE 失联后据此重新发现新的 origin。
      // 不传的话，IDE 只能把启动时那一个端口当成永久地址，DSH 一重启换端口就再也连不上。
      env.DSH_IDE_ENDPOINT_FILE = join(this.pluginRoot, 'runtime', 'host-endpoint.json');
      // 会话由 DSH 决定（不变量 I4）：把开窗方给的 sessionId 交给子进程，IDE 侧据此
      // `openView({ view:'chat', params:{ sessionId } })`；缺它时后端只订阅 `$events`，
      // Chat 面板拿不到任何会话内容（K5 的缺口）。
      if (sessionId !== undefined) {
        env.DSH_IDE_SESSION = sessionId;
      }
      // 预取 composerState 并随环境变量交给子进程：IDE 第一帧就能直接画出
      // 模型 / 推理档 / 权限 / 预设，不再「先空着、等一次往返再变出来」。
      // 取不到时留空，IDE 侧回落到正常读取（不影响开窗）。
      if (sessionId !== undefined) {
        const preset = await this.readComposerSnapshot(sessionId);
        if (preset !== undefined) {
          env.DSH_IDE_COMPOSER = preset;
        }
      }
      // 不传载荷目录作为位置参数：主页的 `resources/app` 已经指向插件载荷。
      // 位置参数只承载「要打开的工作区」，与 VS Code CLI 语义一致（首次点击即打开当前工作区）。
      const args = ideWorkspaceArgs(workspace);
      // DSH-IDE 是 DSH 拉起的子进程，不是独立应用。
      // `detached: false` 且不 `unref()`：Windows 上 `detached: true` 会带 CREATE_BREAKAWAY_FROM_JOB，
      // 子进程会离开父进程的 Job，DSH 退出后窗口还在。保持默认子进程，它留在 DSH 的进程树里。
      // 插件上下文销毁（DSH 正常退出 / 卸载）时由已有的 `ctx.effect` 调用 `killIdeChild()`。
      // 不另写轮询去探测 DSH 是否还活着。
      const child = spawn(home.exe, args, { stdio: 'ignore', env, cwd: dirname(home.exe), detached: false, windowsHide: false });
      // `spawn` 只代表「请求已提交」：真正的失败（找不到可执行文件、权限不足）
      // 会以异步 `error` 事件到达，try/catch 覆盖不到。因此这里必须等一次判定，
      // 否则会把「根本没起来」报成「已开窗」。
      const failure = await new Promise(resolve => {
        let settled = false;
        const finish = value => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(value);
        };
        child.once('error', error => finish(safeErrorText(error)));
        child.once('spawn', () => finish(undefined));
        // 已经同步失败的情况：`pid` 缺失说明进程没建起来。
        if (child.pid === undefined) {
          finish('the IDE process did not start (no pid)');
        }
      });
      if (failure !== undefined) {
        this.ideChild = undefined;
        this.spawnedAt = undefined;
        return { ok: false, message: `failed to spawn IDE process: ${failure}` };
      }
      this.ideChild = child;
      this.spawnedAt = Date.now();
      // 子进程自己退出（用户关窗口）时释放句柄，避免防抖误判仍在运行。
      child.once('exit', () => {
        if (this.ideChild === child) {
          this.ideChild = undefined;
          this.spawnedAt = undefined;
        }
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: `failed to spawn IDE process: ${safeErrorText(error)}` };
    }
  }

  /**
   * 开窗前预取一次输入框目录，交给 IDE 首帧使用。
   *
   * 与 `composerState` 同一个取数路径（projections + modelCatalog + 权限 / 预设目录），
   * 只是提前到拉起窗口之前执行。任何失败都返回 undefined：宁可让 IDE 走正常读取，
   * 也不要因为预取失败而打不开窗口。
   * @param {string} sessionId
   * @returns {Promise<string | undefined>}
   */
  async readComposerSnapshot(sessionId) {
    try {
      const composer = this.ctx.get && this.ctx.get('sessionController');
      if (!composer || typeof composer.projections !== 'function') {
        return undefined;
      }
      const projected = await composer.projections({ sessionId }, new AbortController().signal);
      const values = projected && typeof projected === 'object' ? projected.values : undefined;
      const catalog = typeof composer.modelCatalog === 'function' ? await composer.modelCatalog() : undefined;
      const permissionPresets = this.ctx.get && this.ctx.get('permissionPresets');
      const agentPresets = this.ctx.get && this.ctx.get('agentPresets');
      const permission = permissionPresets && typeof permissionPresets.catalog === 'function'
        ? permissionPresets.catalog()
        : undefined;
      const presets = agentPresets && typeof agentPresets.list === 'function'
        ? await agentPresets.list()
        : undefined;
      // 必须经 `projectDshIdeComposer`：IDE 端 `normalizeDshComposerState` 读的是
      // `{ model:{groups,current}, permission:{options}, preset:{options}, team }`。
      // 直接把 `{ values, catalog, permission, presets }` 塞进环境变量时字段名对不上，
      // IDE 会整份解析成 EMPTY——预取看起来生效、实际第一帧仍是空的（真机前的静态核对发现）。
      // 与 `composerState` 用同一个投影函数，保证两条读取路径形状一致。
      return JSON.stringify(projectDshIdeComposer({ values, catalog, permission, presets }));
    } catch {
      return undefined;
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
      message: `failed to materialize Electron home: ${safeErrorText(error)}`,
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
  registerIdeClient(clientId, wireRevision) {
    requireDshIdeWireRevision(wireRevision);
    this._requireTrustedCaller('registerIdeClient');
    return this.launchQueue.register(clientId);
  }

  /**
   * IDE 进程退出时注销登记项。
   *
   * 为什么必须显式注销：IDE 进程被关闭时旧实现依赖 15s 心跳超时才清理，
   * 期间用户再点入口，`dispatch` 会把请求投给一个已死的回调并返回 ok:true，
   * 表现为「点了没反应，要等很久再点一次才打开」。IDE 侧退出前调用本方法即可立刻清掉。
   * @param clientId - 报到时使用的标识
   */
  unregisterIdeClient(clientId, wireRevision) {
    requireDshIdeWireRevision(wireRevision);
    this._requireTrustedCaller('unregisterIdeClient');
    return this.launchQueue.unregister(clientId);
  }

  /**
   * IDE 侧轮询待开窗请求（由 `registerIdeClient` 建立的登记项）。
   *
   * `waitMs` 可选：缺省立刻返回。IDE 传入正数时长轮询，队列会把它夹到心跳超时以内。
   * 方法是 async：Typert 会等待返回的 Promise，长轮询期间这条 RPC 一直挂着。
   * @param {string} clientId
   * @param {number} wireRevision
   * @param {number} [waitMs]
   */
  async pollLaunch(clientId, wireRevision, waitMs) {
    requireDshIdeWireRevision(wireRevision);
    this._requireTrustedCaller('pollLaunch');
    return this.launchQueue.poll(clientId, waitMs);
  }

  /** 插件入口在会话服务就绪后把 Host 桥接交过来。窗口只调这里，不再自己开 session/follow。 */
  attachBridge(bridge) {
    this.bridge = bridge;
  }

  /**
   * 跟随一个会话。帧来自桥接里那一次 `sessionController.follow`，原样送出。
   * @param {object} binding 发起视图的绑定（viewId / generation / sessionId）
   * @param {number} wireRevision 两半共用的线协议修订号
   * @param {AbortSignal} signal 调用方取消信号
   */
  async *followSession(binding, wireRevision, signal) {
    requireDshIdeWireRevision(wireRevision);
    this._requireTrustedCaller('followSession');
    const bridge = this.bridge;
    if (bridge === undefined || typeof bridge.followSession !== 'function') {
      throw Object.assign(new Error('DSH-IDE host bridge is not attached'), { code: 'dsh-ide/feature-unavailable' });
    }
    yield* bridge.followSession(validateDshIdeViewBinding(binding), signal);
  }

  /**
   * 窗口上的操作交给桥接已有的调用。`payload` 是该方法的参数对象。
   * @param {string} method
   * @param {unknown} payload
   */
  dispatch(method, payload, binding, wireRevision) {
    const bridge = this.bridge;
    if (bridge === undefined || typeof bridge.invoke !== 'function') {
      return Promise.reject(Object.assign(new Error('DSH-IDE host bridge is not attached'), { code: 'dsh-ide/feature-unavailable' }));
    }
    return Promise.resolve().then(() => {
      requireDshIdeWireRevision(wireRevision);
      this._requireTrustedCaller('dispatch');
      // 与 IDE 侧通道同一个共享校验器：字段白名单与方法名只在这里判定一次。
      const args = validateDshIdeInput(method, payload);
      return bridge.invoke(method, args, validateDshIdeViewBinding(binding));
    });
  }

  /**
   * 当前这次点击该连的 Host 端点。
   *
   * 先读正在监听的 `webServer.port` 和 `connection.authenticatedUrl`，并把它写回端点文件。
   * 文件只是 IDE 重启后重新发现端口用的；点击当下不以旧文件为准。
   * 服务还没报出端口时才退回文件，避免在 Host 刚起来的空窗里完全打不开。
   * @returns {Promise<{ origin: string, launchUrl: string, port?: number } | undefined>}
   */
  async currentEndpoint() {
    const live = resolveHostEndpoint(this.ctx);
    if (live !== undefined && typeof live.origin === 'string' && live.origin !== '' && typeof live.launchUrl === 'string' && live.launchUrl !== '') {
      const written = await publishHostEndpoint(this.ctx, join(this.pluginRoot, 'runtime', 'host-endpoint.json'));
      if (written !== undefined && typeof written.launchUrl === 'string' && written.launchUrl !== '') {
        return written;
      }
      return live;
    }
    const saved = this.ideEndpoint();
    if (saved !== undefined && typeof saved.origin === 'string' && saved.origin !== '' && typeof saved.launchUrl === 'string' && saved.launchUrl !== '') {
      return saved;
    }
    return undefined;
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


}

// 原型 @Remote marker 描述符（等价 @Remote('ping') 的生成物，SRC 源模式发现用）。
Object.defineProperty(IdeRemoteService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: {
    version: 1,
    methods: [
      { method: 'ping', invocation: { kind: 'direct' } },
      { method: 'launch', invocation: { kind: 'direct' } },
      { method: 'registerIdeClient', invocation: { kind: 'direct' } },
      { method: 'unregisterIdeClient', invocation: { kind: 'direct' } },
      { method: 'pollLaunch', invocation: { kind: 'direct' } },
      { method: 'followSession', mode: 'stream', invocation: { kind: 'direct' } },
      { method: 'dispatch', invocation: { kind: 'direct' } },
    ],
  },
});

export default IdeRemoteService;
