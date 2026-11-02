// dsh-ide/host/services.js
// 通道 A 服务封装：把 rc.5 的 DSH Cordis 服务收敛到一套与传输无关的方法后面。
// 业务层（pipe.js）只跟本模块对话。所有调用都在 Host 进程内完成（无 /api）。
//
// 全部方法签名均已对照已装 DSH 0.2.1-rc.5 的 lib/types 与实时 cordis_inspect 核验，
// 详见 .build/rc5-contract.md。关键更正（相对早期草稿）：
//   - sessionController 无 events/state/wait；page/follow 的 request 用 address。
//   - agentPresets.read -> 实际方法 readDocument(id)。
//   - 目标服务名为 goals；每个方法首参为 live Agent（不是 payload）。
//   - follow 首帧 {type:'snapshot',records:[{type:'event',event}]}, 之后 {type:'event',event}。
//
// 事件喂给子应用：SessionEventLikeEntry = {type:'event',event:SessionEvent}
//                                    | {type:'transient',event:AssistantLiveChunkEvent}

/** 取一个服务；缺失返回 null（调用方决定 fail-closed 还是降级）。 */
function peekService(ctx, name) {
  if (!ctx || typeof ctx.get !== 'function') return null;
  try { return ctx.get(name) || null; } catch { return null; }
}
function requireService(ctx, name) {
  const s = peekService(ctx, name);
  if (!s) throw Object.assign(new Error(`${name} unavailable`), { code: 'dsh/service-unavailable' });
  return s;
}

/**
 * 创建通道 A 服务集。
 * @param {object} ctx DSH Cordis 上下文（提供 ctx.get(name)）。
 * @returns {object} 方法字典；每个方法返回 { ok, result?|error? }，流方法通过 ctx2.onEvent 回推。
 */
export function createHostServices(ctx) {
  const sessionController = () => requireService(ctx, 'sessionController');
  const agentPresets = () => requireService(ctx, 'agentPresets');
  const permissionPresets = () => requireService(ctx, 'permissionPresets');
  const approval = () => requireService(ctx, 'approval');
  const goals = () => requireService(ctx, 'goals');
  const workspaceController = () => requireService(ctx, 'workspaceController');
  const agents = () => peekService(ctx, 'agents');

  /** 解析一个 live Agent（审批/预设/目标均需 Agent 实例）。 */
  const resolveAgent = (sessionId) => {
    const a = agents();
    if (!a || !sessionId) return undefined;
    try { return a.get(sessionId); } catch { return undefined; }
  };
  /** 拿当前发起者 Agent（模型工具执行链）。 */
  const currentAgent = () => {
    const a = agents();
    if (!a) return undefined;
    try { return typeof a.currentInitiator === 'function' ? a.currentInitiator() : undefined; } catch { return undefined; }
  };
  const requireAgent = (sessionId) => {
    const agent = resolveAgent(sessionId) ?? currentAgent();
    if (!agent) throw Object.assign(new Error('no live agent for request'), { code: 'dsh/agent-unavailable' });
    return agent;
  };

  /**
   * 把官方 follow 流逐帧归一为 SessionEventLikeEntry 回推。
   * 首帧 snapshot -> records 里的 {type:'event',event}；后续 {type:'event',event} 直传；
   * assistant-stream 帧转 {type:'assistant/live-chunk' 语义的 transient}（子应用可选消费）。
   */
  async function streamFollow(request, signal, onEvent) {
    const controller = sessionController();
    const iterable = controller.follow(request, signal);
    for await (const frame of iterable) {
      if (signal?.aborted) break;
      for (const entry of normalizeFollowFrame(frame)) onEvent(entry);
    }
  }

  return {
    // ---- 会话 ----
    async 'session.list'(payload, c2) { return ok(await sessionController().list(payload ?? {}, c2?.signal)); },
    async 'session.search'(payload, c2) { return ok(await sessionController().search(payload ?? {}, c2?.signal)); },
    async 'session.create'(payload) { return ok(await sessionController().create(payload ?? {})); },
    async 'session.prompt'(payload, c2) { return ok(await sessionController().prompt(payload, c2?.signal)); },
    async 'session.cancel'(payload) { return ok(await sessionController().cancel(payload)); },
    async 'session.selectModel'(payload) { return ok(await sessionController().selectModel(payload)); },
    async 'session.rename'(payload) { return ok(await sessionController().rename(payload)); },
    async 'session.fork'(payload) { return ok(await sessionController().fork(payload)); },
    async 'session.projections'(payload, c2) { return ok(await sessionController().projections(payload, c2?.signal)); },
    async 'session.page'(payload, c2) { return ok(await sessionController().page(payload, c2?.signal)); },
    async 'session.follow'(payload, c2) { await streamFollow(payload, c2?.signal, c2?.onEvent); return ok({ streamed: true }); },
    async 'session.archive'(payload) { return ok(await workspaceController().archiveSession(payload)); },
    async 'session.unarchive'(payload) { return ok(await workspaceController().unarchiveSession(payload)); },
    async 'session.pin'(payload) { return ok(await workspaceController().pinSession(payload)); },
    async 'session.unpin'(payload) { return ok(await workspaceController().unpinSession(payload)); },

    // ---- 模型目录 ----
    async 'modelCatalog'(_payload, c2) { return ok(await sessionController().modelCatalog(c2?.signal)); },

    // ---- agent 预设（四模式）----
    async 'agentPresets.list'() { return ok(await agentPresets().list()); },
    async 'agentPresets.read'(payload) { return ok(await agentPresets().readDocument(payload?.preset ?? payload?.id ?? payload)); },
    async 'agentPresets.select'(payload) {
      const agent = requireAgent(payload?.sessionId);
      return ok(await agentPresets().select(agent, payload?.preset));
    },

    // ---- 权限预设 ----
    async 'permissionPresets.catalog'() { return ok(await permissionPresets().catalog()); },
    /** 把某个权限预设应用到会话（内部组合 approval.setPolicy）。 */
    async 'permissionPresets.set'(payload) {
      const agent = requireAgent(payload?.sessionId);
      permissionPresets().set(agent.session, payload?.preset);
      return ok({ preset: payload?.preset });
    },

    // ---- 审批策略（ask|never）----
    async 'approval.setPolicy'(payload) {
      const agent = requireAgent(payload?.sessionId);
      approval().setPolicy(agent, payload?.policy === 'never' ? 'never' : 'ask');
      return ok({ policy: payload?.policy === 'never' ? 'never' : 'ask' });
    },
    async 'approval.request'(payload, c2) {
      const agent = requireAgent(payload?.sessionId);
      const outcome = await approval().request({
        agent,
        toolName: payload?.toolName ?? 'ide',
        reason: payload?.reason,
        signal: c2?.signal,
      });
      return ok({ outcome });
    },

    // ---- 目标（计划/目标 二阶段）----
    async 'goal.get'(payload) { return ok(await goals().get(requireAgent(payload?.sessionId))); },
    async 'goal.create'(payload) {
      const agent = requireAgent(payload?.sessionId);
      return ok(await goals().create(agent, { objective: payload?.objective, maxGoalRounds: payload?.maxGoalRounds }));
    },
    async 'goal.edit'(payload) { return ok(await goals().edit(requireAgent(payload?.sessionId), payload?.ref, payload?.request ?? payload?.patch)); },
    async 'goal.pause'(payload) { return ok(await goals().pause(requireAgent(payload?.sessionId), payload?.ref)); },
    async 'goal.resume'(payload) { return ok(await goals().resume(requireAgent(payload?.sessionId), payload?.ref)); },
    async 'goal.complete'(payload) { return ok(await goals().complete(requireAgent(payload?.sessionId), payload?.ref)); },
    async 'goal.clear'(payload) { return ok(await goals().clear(requireAgent(payload?.sessionId), payload?.ref)); },
  };
}

function ok(result) { return { ok: true, result }; }

/**
 * 归一化官方 follow 帧 → SessionEventLikeEntry 列表（严格按 rc.5 真实帧形状）。
 *  - snapshot：{ type:'snapshot', records:[{type:'event',event}], ... } -> records 直出
 *  - event：{ type:'event', event } -> 直出
 *  - assistant-stream：{ type:'assistant-stream', frame } -> 一句 transient（子应用可忽略）
 */
function normalizeFollowFrame(frame) {
  if (!frame || typeof frame !== 'object') return [];
  if (frame.type === 'snapshot') {
    const records = Array.isArray(frame.records) ? frame.records : [];
    return records.map((r) => (r && r.type === 'event' && r.event) ? { type: 'event', event: r.event } : r);
  }
  if (frame.type === 'event' && frame.event) return [{ type: 'event', event: frame.event }];
  if (frame.type === 'assistant-stream' && frame.frame) {
    // 仅在 assistantStream:true 时出现；交给子应用作为 transient 处理（保持信封合法）。
    return [{ type: 'transient', event: { type: 'assistant/live-chunk', data: frame.frame } }];
  }
  return [];
}
