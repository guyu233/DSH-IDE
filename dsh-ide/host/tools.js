// dsh-ide/host/tools.js
// ide_* 工具注册（模型可调用）+ 执行分发。
//
// 分工：
//  - 纯读文件系统操作（readFile/listDir/glob/search）在 Host 进程内直接执行，受工作区根强约束。
//  - 需要在编辑器里「可见」或依赖 VS Code LSP/终端/Git 的操作（writeFile/editFile/diagnostics/
//    lsp/terminal/runCommand/git）经通道 B 转发给 VS Code 主进程的 ideExec 执行并回填结果。
//  - 写/编辑/终端/命令一律先经 ctx.approval.request（模型在 turn 内调用工具，turn 处于 open），
//    留下 approval/asked + approval/decided 审计对；审批不可用则 fail-closed 拒绝。
//
// 安全底线（见 docs/dsh-ide-facts.md §4）：
//  - 根包含校验：拒绝绝对路径入参；相对 root 解析后必须仍在 root 内；realpath 防符号链接逃逸。
//  - ide_terminal 不直跑 shell:true（转发 VS Code 受控终端/命令执行）。
//  - 每次工具调用经 DSH tools 层，天然留 tool/call + tool/result 审计。

import * as fs from 'node:fs';
import * as path from 'node:path';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.dsh-ide-data', '.dsh-ide-ext', '__pycache__', '.venv', 'target']);

/** 输出 schema 子集：{ ok, output }。 */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' }, output: { type: 'string' } },
  required: ['ok', 'output'],
};

function makeTool(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: (value && typeof value.output === 'string') ? value.output : String(value && value.output) }],
    },
    async execute(args, exec) {
      const out = await execute(args || {}, exec || {});
      return { ok: true, output: typeof out === 'string' ? out : JSON.stringify(out) };
    },
  };
}

/**
 * 安全根包含校验：拒绝绝对路径入参；相对 root 解析后必须仍在 root 内；realpath 防符号链接逃逸。
 * @returns 受约束的绝对路径。
 */
export function makeResolveRoot(root) {
  const rootAbs = path.resolve(root || '.');
  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  return function resolve(p) {
    if (typeof p !== 'string' || p.length === 0) throw new Error('path is required');
    if (path.isAbsolute(p)) throw new Error('absolute paths are not allowed; pass a path relative to the workspace root');
    const abs = path.resolve(rootAbs, p);
    if (abs !== rootAbs && !abs.startsWith(rootWithSep)) throw new Error('path escapes workspace root');
    // 防符号链接逃逸：若目标已存在，realpath 后仍需位于 root 内。
    try {
      const real = fs.realpathSync(abs);
      const realRoot = fs.realpathSync(rootAbs);
      const realRootSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
      if (real !== realRoot && !real.startsWith(realRootSep)) throw new Error('path escapes workspace root via symlink');
    } catch (e) {
      if (e && /escapes workspace root/.test(e.message)) throw e;
      // 目标不存在（用于 writeFile 新文件）等其它错误：忽略，交由后续操作决定。
    }
    return abs;
  };
}

/**
 * 创建 ide_* 工具集。
 * @param {object} ctx DSH Cordis 上下文
 * @param {string} root 受约束的工作区根
 * @param {object} opts { execB?: (op,args,signal)=>Promise<{ok,result?,error?,auditToken?}> }
 */
export function createIdeTools(ctx, root, opts = {}) {
  const resolve = makeResolveRoot(root);
  const execB = opts.execB || (async () => { throw new Error('no IDE connected: start the DSH-IDE window (channel B unavailable)'); });

  function svc(name) { try { return ctx.get(name); } catch { return undefined; } }

  /** 写/编辑/命令/终端前的审批（模型在 turn 内，approval.request 合法）。 */
  async function requestWriteApproval(toolName, reason, exec) {
    const approval = svc('approval');
    if (!approval || typeof approval.request !== 'function') {
      throw new Error(`${toolName} denied: approval service unavailable (fail-closed)`);
    }
    const agent = (exec && exec.agent) || svc('agents')?.currentInitiator?.();
    const signal = exec && exec.signal;
    if (!agent) throw new Error(`${toolName} denied: no initiating agent for approval (fail-closed)`);
    const outcome = await approval.request({ agent, toolName, reason, signal });
    if (outcome !== 'allowed-once') throw new Error(`${toolName} denied: approval outcome '${outcome}'`);
  }

  // ---- 纯读：Host 内直接执行 ----
  const readFileTool = makeTool(
    'ide_readFile',
    'Read a UTF-8 text file from the workspace (path relative to workspace root).',
    { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: ['path'] },
    async ({ path: p }) => {
      const abs = resolve(p);
      const text = await fs.promises.readFile(abs, 'utf8');
      return text;
    },
  );

  const listDirTool = makeTool(
    'ide_listDir',
    'List entries (name + type) of a directory in the workspace.',
    { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: [] },
    async ({ path: p }) => {
      const abs = resolve(p ?? '.');
      const entries = await fs.promises.readdir(abs, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other' }));
    },
  );

  const globTool = makeTool(
    'ide_glob',
    'Find files below a workspace subdirectory. Returns paths relative to workspace root.',
    { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, limit: { type: 'number' } }, required: [] },
    async ({ path: p, limit }) => {
      const base = resolve(p ?? '.');
      const out = [];
      await walk(base, (file) => { if (out.length < (limit ?? 2000)) out.push(path.relative(root, file).split(path.sep).join('/')); });
      return { matches: out };
    },
  );

  const searchTool = makeTool(
    'ide_search',
    'Search UTF-8 files for a literal string below a workspace subdirectory. Returns path + line.',
    { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    async ({ path: p, query, limit }) => {
      const base = resolve(p ?? '.');
      const out = [];
      await walk(base, (file) => {
        if (out.length >= (limit ?? 200)) return;
        try {
          const text = fs.readFileSync(file, 'utf8');
          const i = text.indexOf(query);
          if (i >= 0) out.push({ path: path.relative(root, file).split(path.sep).join('/'), line: text.slice(0, i).split('\n').length });
        } catch { /* 二进制/不可读跳过 */ }
      });
      return { hits: out };
    },
  );

  // ---- 需 VS Code 侧可见/依赖 LSP 的操作：转发通道 B ----
  const writeFileTool = makeTool(
    'ide_writeFile',
    'Create or fully replace a file via VS Code (the editor updates; the change is visible). Gated by DSH approval.',
    { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    async ({ path: p, content }, exec) => {
      const abs = resolve(p);
      await requestWriteApproval('ide_writeFile', `Write file ${abs}`, exec);
      const res = await execB('writeFile', { path: abs, content: String(content ?? '') }, exec.signal);
      if (!res.ok) throw new Error(res.error || 'ide_writeFile failed');
      return res.result ?? { wrote: abs };
    },
  );

  const editFileTool = makeTool(
    'ide_editFile',
    'Replace an exact block of text in a file via VS Code (visible edit). Gated by DSH approval. Fails if old string is not found or not unique (unless replace_all).',
    { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'] },
    async ({ path: p, old_string, new_string, replace_all }, exec) => {
      const abs = resolve(p);
      await requestWriteApproval('ide_editFile', `Edit file ${abs}`, exec);
      const res = await execB('editFile', { path: abs, oldString: String(old_string ?? ''), newString: String(new_string ?? ''), replaceAll: !!replace_all }, exec.signal);
      if (!res.ok) throw new Error(res.error || 'ide_editFile failed');
      return res.result ?? { edited: abs };
    },
  );

  const diagnosticsTool = makeTool(
    'ide_diagnostics',
    "Get language diagnostics (errors/warnings) for a file or the whole workspace from VS Code's language servers.",
    { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: [] },
    async ({ path: p }, exec) => {
      const abs = p ? resolve(p) : '';
      const res = await execB('diagnostics', { path: abs }, exec.signal);
      if (!res.ok) throw new Error(res.error || 'ide_diagnostics failed');
      return res.result ?? { diagnostics: [] };
    },
  );

  const lspTool = (name, description, op, extraProps, toArgs) => makeTool(
    name, description,
    { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, ...extraProps }, required: ['path'] },
    async (a, exec) => {
      const abs = resolve(a.path);
      const res = await execB('lsp', { op, path: abs, ...(toArgs ? toArgs(a) : {}) }, exec.signal);
      if (!res.ok) throw new Error(res.error || `${name} failed`);
      return res.result ?? {};
    },
  );

  const runCommandTool = makeTool(
    'ide_runCommand',
    'Run a project command/task under DSH-controlled execution in the VS Code workspace (not a bare shell). Gated by DSH approval.',
    { type: 'object', additionalProperties: false, properties: { command: { type: 'string' }, cwd: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['command'] },
    async ({ command, cwd, args }, exec) => {
      await requestWriteApproval('ide_runCommand', `Run command ${command}`, exec);
      const res = await execB('runCommand', { command: String(command), cwd: cwd ? resolve(cwd) : undefined, args: Array.isArray(args) ? args : [] }, exec.signal);
      if (!res.ok) throw new Error(res.error || 'ide_runCommand failed');
      return res.result ?? {};
    },
  );

  const terminalTool = makeTool(
    'ide_terminal',
    'Send input to a controlled integrated terminal in the VS Code workspace (no shell:true host execution). Gated by DSH approval.',
    { type: 'object', additionalProperties: false, properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'] },
    async ({ command, cwd }, exec) => {
      await requestWriteApproval('ide_terminal', `Terminal: ${command}`, exec);
      const res = await execB('terminal', { command: String(command), cwd: cwd ? resolve(cwd) : undefined }, exec.signal);
      if (!res.ok) throw new Error(res.error || 'ide_terminal failed');
      return res.result ?? {};
    },
  );

  const gitTool = makeTool(
    'ide_git',
    'Inspect Git state (status/log/diff) of the workspace via VS Code Git integration.',
    { type: 'object', additionalProperties: false, properties: { op: { type: 'string' }, args: { type: 'object' } }, required: ['op'] },
    async ({ op, args }, exec) => {
      const res = await execB('git', { op, args: args ?? {} }, exec.signal);
      if (!res.ok) throw new Error(res.error || 'ide_git failed');
      return res.result ?? {};
    },
  );

  const lspGenericTool = makeTool(
    'ide_lsp',
    'Query the workspace language servers (op=hover|definition|references|documentSymbols|workspaceSymbols|codeActions|rename) at a path/position.',
    { type: 'object', additionalProperties: false, properties: { op: { type: 'string' }, path: { type: 'string' }, line: { type: 'number' }, column: { type: 'number' }, query: { type: 'string' }, newName: { type: 'string' } }, required: ['op', 'path'] },
    async ({ op, path: p, line, column, query, newName }, exec) => {
      const abs = resolve(p);
      const res = await execB('lsp', { op, path: abs, line, column, query, newName }, exec.signal);
      if (!res.ok) throw new Error(res.error || 'ide_lsp failed');
      return res.result ?? {};
    },
  );

  const inlineCompleteTool = makeTool(
    'ide_inlineComplete',
    'Request a DSH inline code completion at a path/position (backend for the editor Tab completion).',
    { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, line: { type: 'number' }, column: { type: 'number' }, prefix: { type: 'string' }, suffix: { type: 'string' } }, required: ['path'] },
    async ({ path: p, line, column, prefix, suffix }, exec) => {
      const abs = resolve(p);
      const res = await execB('inlineComplete', { path: abs, line, column, prefix, suffix }, exec.signal);
      if (!res.ok) throw new Error(res.error || 'ide_inlineComplete failed');
      return res.result ?? { text: '' };
    },
  );

  const tools = [
    readFileTool, listDirTool, globTool, searchTool,
    writeFileTool, editFileTool, diagnosticsTool,
    lspTool('ide_hover', 'Get hover information (type/docs) at a position from the language server.', 'hover', { line: { type: 'number' }, column: { type: 'number' } }, a => ({ line: a.line, column: a.column })),
    lspTool('ide_definition', 'Find the definition location of the symbol at a position.', 'definition', { line: { type: 'number' }, column: { type: 'number' } }, a => ({ line: a.line, column: a.column })),
    lspTool('ide_references', 'Find all references of the symbol at a position.', 'references', { line: { type: 'number' }, column: { type: 'number' } }, a => ({ line: a.line, column: a.column })),
    lspTool('ide_documentSymbols', 'List symbols (outline) in a file via the language server.', 'documentSymbols', {}, () => ({})),
    lspTool('ide_workspaceSymbols', 'Search workspace symbols by name via the language server.', 'workspaceSymbols', { query: { type: 'string' } }, a => ({ query: a.query })),
    lspTool('ide_codeActions', 'List available code actions (quick fixes/refactors) at a position. Lists only; does not apply.', 'codeActions', { line: { type: 'number' }, column: { type: 'number' } }, a => ({ line: a.line, column: a.column })),
    lspGenericTool, inlineCompleteTool, runCommandTool, terminalTool, gitTool,
  ];

  /** 注册到 DSH tools 层；返回已注册的工具名。 */
  function register() {
    const toolsSvc = svc('tools');
    if (!toolsSvc || typeof toolsSvc.register !== 'function') return [];
    const names = [];
    for (const t of tools) {
      try { const dispose = toolsSvc.register(t); if (typeof ctx.effect === 'function' && typeof dispose === 'function') ctx.effect(() => dispose); names.push(t.name); }
      catch { /* 单个失败不阻断其它 */ }
    }
    return names;
  }

  return { register, names: tools.map((t) => t.name), _tools: tools };
}

async function walk(dir, onFile) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) await walk(full, onFile);
      else if (e.isFile()) onFile(full);
    } catch { /* 不可读跳过 */ }
  }
}
