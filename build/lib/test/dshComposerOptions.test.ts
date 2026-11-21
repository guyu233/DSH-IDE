/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 权限 / 预设 → 原生聊天输入框选项组的映射单测。
// 这对应手册 §3.4「模型/effort/permission/preset → composer 区 quick pick/dropdown」。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshComposerOptions.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPermissionItems } from '../../../out/vs/workbench/contrib/dsh/browser/dshComposerProjection.js';

/** 读源码文本：用于锁住「注册/接线存在」这类无法从纯函数断言的约束。 */
const readSource = (relative: string): string => readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8');
const vscodeRoot = fileURLToPath(new URL('../../../', import.meta.url));

function state(overrides: Record<string, unknown> = {}): never {
	return {
		models: [],
		current: null,
		permission: null,
		team: null,
		presets: null,
		locked: false,
		...overrides,
	} as never;
}

test('permission options drop the custom entry and keep ids', () => {
	const items = toPermissionItems(state({
		permission: {
			current: 'workspace-write',
			options: [
				{ value: 'workspace-write', name: '工作区写入' },
				{ value: 'read-only', name: '只读' },
				{ value: 'custom', name: '自定义' },
			],
		},
	}));
	assert.deepEqual(items, [
		{ id: 'workspace-write', name: '工作区写入' },
		{ id: 'read-only', name: '只读' },
	]);
});

test('a custom current permission stays visible but is not offered as a switch target otherwise', () => {
	const items = toPermissionItems(state({
		permission: {
			current: 'custom',
			options: [
				{ value: 'workspace-write', name: '工作区写入' },
				{ value: 'custom', name: '自定义' },
			],
		},
	}));
	assert.deepEqual(items, [
		{ id: 'custom', name: '自定义' },
		{ id: 'workspace-write', name: '工作区写入' },
	]);
	const plain = toPermissionItems(state({
		permission: {
			current: 'workspace-write',
			options: [
				{ value: 'workspace-write', name: '工作区写入' },
				{ value: 'custom', name: '自定义' },
			],
		},
	}));
	assert.deepEqual(plain.map(item => item.id), ['workspace-write']);
});

test('no permission projection yields no options instead of inventing defaults', () => {
	assert.deepEqual(toPermissionItems(state()), []);
});

test('the composer source is bound to the session the chat panel shows', () => {
	// 选择器读的是 `getDshComposerSource().state`；数据源不跟着绑定换会话，
	// 切到别的会话后模型/权限/预设仍是旧会话的目录，未绑定过的窗口更是永远读不到。
	const session = readSource('src/vs/workbench/contrib/dsh/browser/dshChatSession.ts');
	assert.match(session, /composer\?\.setSession\(sessionId\);\s*\n\s*await composer\?\.refresh\(\);/, 'binding a session must rebind the composer source');
	assert.ok((session.match(/composer\?\.setSession\(sessionId\)/g) ?? []).length >= 2, 'both bind() and attach() must keep the composer source in sync');
});

test('DSH models are published into the dsh session pool, not the general picker', () => {
	// `requiresCustomModels` 的会话只有在存在「target 指向自己」的模型时才拿到模型池；
	// 不打这个标记，`dsh:` 会话会显示「无可用模型」，模型选择器也没有可选项。
	const projection = readSource('src/vs/workbench/contrib/dsh/browser/dshComposerProjection.ts');
	assert.match(projection, /targetChatSessionType: DSH_CHAT_SESSION_TYPE/, 'DSH models must declare their session type');
	const contribution = readSource('src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts');
	assert.match(contribution, /registerChatSessionContribution\(DshChatSessionContribution\)/, 'the dsh session type must be registered');
	assert.match(contribution, /requiresCustomModels: true/, 'the dsh session must own its model pool');
});

test('the permission picker stays reachable for a locked session that owns permission groups', () => {
	// `dsh:` 会话会被 lockToCodingAgent 锁住（lockedToCodingAgent=true），
	// 原条件在这种情况下无条件隐藏权限选择器，权限预设完全不可达。
	const actions = readSource('src/vs/workbench/contrib/chat/browser/actions/chatExecuteActions.ts');
	const start = actions.indexOf('export class OpenPermissionPickerAction');
	// 源码是 CRLF：只找 `\n}\n` 会永远落空，必须允许 `\r`。
	const end = start === -1 ? -1 : actions.slice(start).search(/\r?\n\}\r?\n/);
	const block = start === -1 || end === -1 ? '' : actions.slice(start, start + end);
	assert.ok(block !== '', 'OpenPermissionPickerAction must exist');
	assert.match(block, /ChatContextKeys\.chatSessionHasPermissionGroup/, 'a locked session with its own permission group must still show the permission picker');
});

test('the header button only uses host theme tokens for its states', () => {
	// 尺寸与圆角的**数值**由下面那条「读宿主 asar 对照官方样式表」的用例负责——
	// 这里只钉住「用令牌而不是写死颜色」这一点：hover/active 必须走官方别名，
	// 否则深色主题下按钮状态会与周围不一致。
	const client = readSource('src/vs/platform/dshClient/client/client.js');
	assert.match(client, /--dsw-alias-interactive-bg-hover/, 'hover must use the host token');
	assert.match(client, /--dsw-alias-interactive-bg-active/, 'active must use the host token');
	// 焦点态的正确断言在下面那条「draws an official focus ring」用例里（按钮类要画 ring，
	// 只有菜单项才 `outline:none`）。这里不重复，避免两处说法打架。
});

test('inline completion is off by default and only registers when enabled', () => {
	// 每次光标停顿都是一次跨进程调用加一次 LLM 生成。装插件即开启等于让用户
	// 在不知情的情况下持续消耗 CPU 与额度，所以默认关闭，且关闭时根本不注册 provider。
	const src = readSource('src/vs/workbench/contrib/dsh/browser/inlineCompletion.ts');
	assert.match(src, /export const DSH_INLINE_COMPLETION_SETTING = 'dsh\.inlineCompletion\.enabled'/);
	assert.match(src, /registerDshInlineCompletionsSetting/);
	assert.match(src, /if \(!enabled && current !== undefined\)/, 'turning it off must unregister, not just no-op');
	const config = readSource('src/vs/workbench/contrib/dsh/browser/dshConfiguration.ts');
	assert.match(config, /default: false/, 'the setting must default to off');
	const contribution = readSource('src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts');
	assert.match(contribution, /registerDshInlineCompletionsSetting\(configurationService/, 'the contribution must go through the gate');
	assert.doesNotMatch(contribution, /registerDshInlineCompletions\(languageFeatures, client\)/, 'the ungated registration must be gone');
});

test('model equality compares the effort schema field-wise, not by serializing it', () => {
	// schema 的形状由 toLanguageModel 固定，会变的只有 enum / enumItemLabels / default。
	// 每次判等都整份 JSON.stringify 两个对象，在模型表刷新时是纯浪费。
	const src = readSource('src/vs/workbench/contrib/dsh/browser/dshLanguageModelProvider.ts');
	const codeLines = src.split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line));
	assert.ok(!codeLines.some(line => line.includes('JSON.stringify')), 'the schema must not be serialized for comparison');
	assert.match(src, /function sameEffortSchema\(/, 'the schema needs its own comparison');
	assert.match(src, /a\.enumItemLabels\?\.\[i\] !== b\.enumItemLabels\?\.\[i\]/, 'effort labels must be compared entry by entry');
	assert.match(src, /a\.default !== b\.default/, 'the default effort must be compared');
});

test('composer state equality is field-wise, not a JSON round trip', () => {
	// 原先用 JSON.stringify(a) === JSON.stringify(b)：每次 refresh 都要对整份状态
	// （可能几十个模型）做两次序列化。改成逐字段比较后，语义必须完全一致。
	const src = readSource('src/vs/workbench/contrib/dsh/browser/dshComposerSource.ts');
	// 注释里会提到旧写法（说明为什么不用它），所以只检查代码行。
	const codeLines = src.split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line));
	assert.ok(!codeLines.some(line => line.includes('JSON.stringify(a)')), 'the serialize-and-compare must be gone');
	assert.match(src, /function sameModels\(/, 'models must compare per entry');
	assert.match(src, /function samePermission\(/, 'permission must compare per option');
	assert.match(src, /function samePresets\(/, 'presets must compare per option');
	assert.match(src, /function sameTeam\(/, 'team must compare per flag');
	assert.match(src, /if \(a === b\) \{\s*\n\s*return true;/, 'identical references must short-circuit');
});

test('DSH slash commands are registered for dsh sessions only', () => {
	// Host 侧 listCommands / runCommand 早已实现，renderer 零调用点 → 用户敲 `/` 看不到 DSH 命令。
	const src = readSource('src/vs/workbench/contrib/dsh/browser/dshSlashCommands.ts');
	assert.match(src, /sessionTypes: \[DSH_CHAT_SESSION_TYPE\]/, 'commands must be limited to the dsh session type');
	assert.match(src, /'listCommands'/, 'the list must come from the official Host endpoint');
	assert.match(src, /'runCommand'/, 'execution must go through the single runCommand channel');
	// 契约：command 不带前导斜杠；args 每项不得含空白或斜杠。
	assert.match(src, /command: item\.name/, 'command must be the bare name, not a slash-prefixed line');
	assert.match(src, /args\.some\(part => part\.includes\('\/'\)\)/, 'slash-containing args must be refused, not silently mangled');
	assert.match(src, /dshSessionIdFromResource\(sessionResource\)/, 'the session id fallback must decode the resource, not strip one slash');
	assert.doesNotMatch(src, /sessionResource\.path\.replace/, 'a raw path strip leaves percent-encoding in the session id');
	assert.match(src, /dsh\.slash\.rejected/, 'a rejected command must be shown in the chat response, not only logged');
	assert.match(src, /dsh\.slash\.ran/, 'a successful command must leave a visible confirmation instead of an empty turn');
	const contribution = readSource('src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts');
	assert.match(contribution, /registerDshSlashCommands\(slashCommandService, client, logService\)/,
		'the contribution must register the bridge');
	assert.match(contribution, /slashCommandsBridge\.setSession\(boundSessionId\)/,
		'commands are agent-scoped: binding a session must refresh the list');
	assert.match(src, /this\.clearRegistered\(\)/, 'unbinding must drop the previous agent commands');
	assert.match(src, /this\._sessionId !== sessionId/, 'a late command list must not overwrite the session that is now bound');
});

test('the client registers exactly the locales the host UI can select', () => {
	// `addLanguage` 会把 ja/es/fr/de/ru/pt 写进 catalog，`lookup` 按当前语言走 fallbackChain。
	// 只注册 zh/en 时，日文界面里按钮会落到英文，而宿主自己的文案是日文。
	const client = readSource('src/vs/platform/dshClient/client/client.js');
	const expected = ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'];
	const dicts: string[] = [];
	for (const match of client.matchAll(/const DICT_([A-Z]{2}) = \{/g)) {
		dicts.push(match[1].toLowerCase());
	}
	assert.deepStrictEqual(dicts.sort(), expected, 'client dictionaries must cover every host language');
	const register = /ctx\.locale\.register\(NS, \{ ([^}]+) \}\)/.exec(client);
	assert.ok(register !== null, 'the dictionaries must be registered in one place');
	const registered = [...register[1].matchAll(/(\w+):\s*DICT_/g)].map(m => m[1]).sort();
	assert.deepStrictEqual(registered, expected, 'registration must match the selectable set');
	const keysOf = (code: string): string[] => {
		const block = new RegExp(`const DICT_${code} = \\{([\\s\\S]*?)\\n\\t\\t\\};`).exec(client);
		assert.ok(block !== null, `${code} dictionary must exist`);
		return [...block[1].matchAll(/"([\w.]+)":/g)].map(m => m[1]).sort();
	};
	const placeholdersOf = (code: string): string[] => {
		const block = new RegExp(`const DICT_${code} = \\{([\\s\\S]*?)\\n\\t\\t\\};`).exec(client);
		assert.ok(block !== null);
		return [...block[1].matchAll(/"([\w.]+)":\s*"([^"]*)"/g)].map(m => `${m[1]}:${[...m[2].matchAll(/\{(\w+)\}/g)].map(hit => hit[1]).join(',')}`);
	};
	for (const code of expected.map(item => item.toUpperCase())) {
		assert.deepStrictEqual(keysOf(code), keysOf('EN'), `${code} must carry the same keys as English`);
		assert.deepStrictEqual(placeholdersOf(code), placeholdersOf('EN'), `${code} placeholders must match English`);
	}
});

test('a queued launch reports back instead of looking dead', () => {
	// Host 的 launch 一律异步排队（opened 恒 false）：再点一次若毫无反馈，用户会以为按钮坏了。
	const client = readSource('src/vs/platform/dshClient/client/client.js');
	assert.match(client, /"button\.queued"/, 'there must be a transient acknowledgement label');
	assert.match(client, /setQueued\(true\)/, 'a successful payload must set the acknowledgement');
	assert.match(client, /setTimeout\(\(\) => setQueued\(false\), 2500\)/, 'the acknowledgement must clear itself');
	// 错误仍然优先显示：queued 不能盖住真正的失败。
	assert.match(client, /: busy \? t\("button\.starting"\) : queued \? t\("button\.queued"\) : t\("button\.open"\)/,
		'priority order must be error > busy > queued > idle');
});

test('the model picker is scoped to sessions that actually have models', () => {
	// `when: ContextKeyExpr.false()` 会让「切换模型/推理档」在任何会话都没有入口；
	// 全面放开又会改变 Copilot 等会话的既有 UI。正确做法是用 `chatSessionHasModels` 限定，
	// 它只在会话确实有可见选项组时为真（`dsh:` 的模型组由 content provider 注入）。
	const actions = readSource('src/vs/workbench/contrib/chat/browser/actions/chatExecuteActions.ts');
	const block = actions.slice(actions.indexOf('class OpenModelPickerAction'), actions.indexOf('class OpenModelPickerAction') + 1600);
	assert.ok(!/when:\s*ContextKeyExpr\.false\(\)/.test(block), 'the model picker must not be hidden unconditionally');
	assert.match(block, /ChatContextKeys\.chatSessionHasModels/, 'the picker must be gated on the session having models');
	assert.match(block, /ChatContextKeys\.inQuickChat\.negate\(\)/, 'quick chat must keep its own treatment');
	// DSH 不注册 chat agent，`chatIsEnabled` 恒假；precondition 不能只依赖它。
	assert.match(block, /precondition:\s*ContextKeyExpr\.or\(/, 'the precondition must not require a default chat agent only');
});

test('the New Session button does not also fire an unregistered command', () => {
	// `chatViewPane.createNewChat` 曾经同时执行 `dsh.newSession` 与上游的
	// `ACTION_ID_NEW_CHAT`（`workbench.action.chat.newChat`）。后者在本仓库里**没有注册**，
	// 调用只会抛错并被 `void ... catch {}` 吞掉；而它一旦被注册，两条路径会抢同一个面板。
	// 现在只走 DSH 的建会话路径，并且错误要上报（`onUnexpectedError`）而不是静默。
	const pane = readSource('src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts');
	const block = pane.slice(pane.indexOf('const createNewChat'), pane.indexOf('const createNewChat') + 400);
	assert.match(block, /dsh\.newSession/, 'the button must create a DSH session');
	assert.ok(!/ACTION_ID_NEW_CHAT/.test(block), 'it must not also fire the upstream new-chat command');
	assert.match(block, /onUnexpectedError/, 'failures must be reported, not swallowed');
});

test('the copied button spec matches the official stylesheets byte for byte', () => {
	// 上面那条用例只比对 client.js 里的字面量；如果官方规格变了，它会继续通过。
	// 这里直接读宿主 asar 里的官方样式，把「抄得对不对」变成可复算的对照。
	// 官方 `_sm_1ulci_28` 在 dsh-web-frontend 的打包 CSS 里，
	// `--dsw-radius-sm` 在 dsh-client-ui-theme 的 base.css 里。
	const asar = process.env.DSH_ASAR ?? 'C:\\Users\\guyu\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';
	if (!existsSync(asar)) {
		// 换机器时 asar 路径不同：跳过而不是假装通过。
		return;
	}
	const read = (inner: string): string => {
		const header = Buffer.alloc(16);
		const fd = openSync(asar, 'r');
		try {
			readSync(fd, header, 0, 16, 0);
			const size = header.readUInt32LE(12);
			const json = Buffer.alloc(size);
			readSync(fd, json, 0, size, 16);
			const root = JSON.parse(json.toString('utf8'));
			let node = root;
			for (const part of inner.split('/')) {
				node = node.files?.[part];
				if (node === undefined) { throw new Error(`not in asar: ${inner}`); }
			}
			// 数据区起点必须加 pickle 的 4 字节对齐填充，否则会读到上一个文件的尾部
			// （少 3 字节时表现为 JSON 开头多出 `};`）。
			const padding = (4 - (size % 4)) % 4;
			const body = Buffer.alloc(node.size);
			readSync(fd, body, 0, node.size, 16 + size + padding + Number(node.offset));
			return body.toString('utf8');
		} finally {
			closeSync(fd);
		}
	};
	// 用目录列举找到打包 CSS（文件名带内容哈希，不能写死）。
	const listCss = (): string[] => {
		const header = Buffer.alloc(16);
		const fd = openSync(asar, 'r');
		try {
			readSync(fd, header, 0, 16, 0);
			const size = header.readUInt32LE(12);
			const json = Buffer.alloc(size);
			readSync(fd, json, 0, size, 16);
			const root = JSON.parse(json.toString('utf8'));
			const assets = root.files['dsh'].files['node_modules'].files['@deepseek-ai'].files['dsh-web-frontend'].files['dist'].files['assets'].files;
			return Object.keys(assets).filter(name => name.endsWith('.css'));
		} finally {
			closeSync(fd);
		}
	};
	const css = listCss().map(name => read(`dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/${name}`)).join('\n');
	const sm = /_sm_1ulci_28\{([^}]*)\}/.exec(css);
	assert.ok(sm !== null, 'the official small-button rule must exist');
	assert.match(sm[1], /height:28px/, 'official height is 28px');
	assert.match(sm[1], /font-size:12px/, 'official font size is 12px');
	assert.match(sm[1], /line-height:18px/, 'official line height is 18px');
	assert.match(sm[1], /padding:0 10px/, 'official padding is 0 10px');
	assert.match(sm[1], /border-radius:var\(--dsw-radius-sm\)/, 'official radius uses the token');

	// 用 JSON 可解析性反证偏移算对了：填充少算 3 字节时，文件开头会多出上一个文件的尾部，
	// 表现为 `JSON.parse` 失败或字段缺失。这条断言让偏移错误无处可藏。
	const cordisPkg = JSON.parse(read('dsh/node_modules/@deepseek-ai/cordis/package.json'));
	assert.equal(cordisPkg.name, '@deepseek-ai/cordis', 'asar offset must account for pickle padding');

	const theme = read('dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/base.css');
	const token = /--dsw-radius-sm:\s*(\d+)px/.exec(theme);
	assert.ok(token !== null, 'the radius token must be defined by the official theme');

	// 关键：把**官方值**与 **client.js 里的 fallback**真正对上。
	// 此前这里只断言 `token[1] === '8'`（官方值是 8），没有比对 client.js，
	// 于是把 client.js 的 fallback 改成 9px 测试仍然通过——那只是「官方是 8」，
	// 不是「我们抄对了」。这条断言必须读客户端源码取值再比。
	const client = readSource('src/vs/platform/dshClient/client/client.js');
	const fallback = /var\(--dsw-radius-sm, (\d+)px\)/.exec(client);
	assert.ok(fallback !== null, 'client.js must declare a radius fallback');
	assert.equal(fallback[1], token[1], `client.js fallback (${fallback[1]}px) must equal the official token (${token[1]}px)`);
});

test('a failed launch shows a short label and keeps the reason in the tooltip', () => {
	// 按钮很窄，原始错误可能是一整句
	// `no IDE process has registered yet; endpoint file not found (looked in C:\\…, C:\\…)`。
	// 直接拼进标签会撑破布局且读不懂，所以：标签给结论，`title` 给完整原因。
	const client = readSource('src/vs/platform/dshClient/client/client.js');
	assert.match(client, /"button\.failed":\s*"[^"]*"/, 'there must be a short failure label');
	assert.match(client, /"button\.failedDetail":\s*"[^"]*\{error\}[^"]*"/, 'the detail string must interpolate the reason');
	// 标签不得再插值 `{error}`，否则等于没改。
	const shortLabel = /"button\.failed":\s*"([^"]*)"/.exec(client);
	assert.ok(shortLabel !== null && !shortLabel[1].includes('{error}'), 'the short label must not embed the raw error');
	// 渲染处必须把两者分开用。
	assert.match(client, /const tooltip = error !== null \? t\("button\.failedDetail", \{ error \}\) : label;/, 'the tooltip must carry the full reason');
	assert.match(client, /title: tooltip,/, 'the button title must use the tooltip');
	// 屏幕阅读器读不到 `title`，所以错误态的 `aria-label` 必须是**完整原因**，
	// 不能沿用「悬停查看原因」——那条路径根本没有悬停动作。
	assert.match(client, /const accessibleName = error !== null \? tooltip : label;/, 'the accessible name must carry the full reason on failure');
	assert.match(client, /"aria-label": accessibleName,/, 'the button must use the accessible name');
});

test('every workbench-facing string in the dsh layer is Chinese source text', () => {
	// 本仓库没有 i18n 层（`build/lib/i18n/` 为空、无 `*.i18n.json`），
	// `localize(key, "source")` 会原样返回 source。因此 source 就是用户看到的文字，
	// 同层文件里必须统一用中文——此前 `dsh.chatSession.description`、`dsh.newSessionFailed`、
	// `dsh.bindFailed` 是英文，与同文件的 `dsh.snapshotFailed` 等中文混排。
	const dir = path.join(vscodeRoot, 'src/vs/workbench/contrib/dsh/browser');
	const offenders: string[] = [];
	let total = 0;
	for (const name of fs.readdirSync(dir)) {
		if (!name.endsWith('.ts')) { continue; }
		const source = fs.readFileSync(path.join(dir, name), 'utf8');
		for (const match of source.matchAll(/localize\(\s*'([^']+)',\s*["']([^"']+)["']/g)) {
			total += 1;
			if (!/[\u4e00-\u9fa5]/.test(match[2])) {
				offenders.push(`${name}: ${match[1]} = ${match[2].slice(0, 40)}`);
			}
		}
	}
	assert.ok(total > 40, `expected the dsh layer to have a substantial number of strings (found ${total})`);
	assert.deepStrictEqual(offenders, [], `these user-facing strings are still English: ${offenders.join(' | ')}`);
});

test('the client locale fallback forwards interpolation params', () => {
	// `ctx.locale.bind(ns)` 返回 `(key, params) => translate(ns, key, params)`。
	// 兜底函数若写成 `key => bound(key)`，`{reason}` / `{error}` 不会被替换，
	// 注入座位缺失时用户会看到字面量 `DSH-IDE 启动失败：{error}`。
	const client = readSource('src/vs/platform/dshClient/client/client.js');
	assert.match(
		client,
		/fallbackT = \(key, params\) => bound\(key, params\);/,
		'the fallback must forward params so placeholders are interpolated',
	);
	// 兜底初始值也要接受两参，保持与真实 `t` 的签名一致（否则类型/调用处会漂）。
	assert.match(client, /let fallbackT = \(key, _params\) => key;/, 'the initial fallback must accept params too');
	// 确实存在需要插值的调用点，否则这条断言没有实际意义。
	assert.match(client, /t\("button\.failedDetail", \{ error \}\)/, 'there must be a call that needs interpolation');
});

test('the header button draws an official focus ring instead of relying on background only', () => {
	// 宿主对**按钮类**控件（`_save_*` / `_helpButton_*` / `_actionButton_*`）用
	// `outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, …)`；
	// 只有**菜单项**（`_item_*` / `_danger_*`）才用 `outline:none` + 背景变化。
	// 本控件是 16px 图标按钮，若照搬菜单项那套，键盘用户几乎看不出焦点在哪。
	const client = readSource('src/vs/platform/dshClient/client/client.js');
	const focusRule = /\.dsh-ide-open:focus-visible\{([^}]*)\}/.exec(client);
	assert.ok(focusRule !== null, 'the button must declare a focus-visible rule');
	assert.match(focusRule[1], /outline:var\(--dsw-focus-ring-width\)/, 'focus must draw the official ring');
	assert.match(focusRule[1], /--dsw-focus-ring-color/, 'focus must use the official ring colour token');
	assert.ok(!/outline:none/.test(focusRule[1]), 'an icon-only button must not suppress its focus ring');
	assert.match(client, /dsh-ide-open-failed/, 'a failed launch must leave a visible mark on the icon button');
	assert.match(client, /dsh-ide-open-queued/, 'a queued launch must leave a visible mark until the confirmation clears');
	assert.match(client, /queued \? "dsh-ide-open dsh-ide-open-queued"/, 'the queued class must be applied only while the confirmation is showing');
	assert.match(client, /error !== null \? "dsh-ide-open dsh-ide-open-failed"/, 'the failed class must be applied only while an error is set');
	assert.match(client, /"aria-invalid": error !== null \? true : undefined/, 'assistive tech must hear that the button failed');
});

test('the button inherits only the font family, not the whole font shorthand', () => {
	// 官方只写全局 `button,input,select,textarea{font-family:inherit}`，
	// `_sm_1ulci_28` 再覆盖 font-size/line-height，字重保持默认。
	// 若用 `font: "inherit"` 简写，会连 font-weight/style/variant 一起重置，
	// 与官方按钮的字重表现不一致。
	const client = readSource('src/vs/platform/dshClient/client/client.js');
	const styleBlock = client.slice(client.indexOf('const BUTTON_STYLE'), client.indexOf('const BUTTON_STYLE') + 1200);
	assert.match(styleBlock, /fontFamily: "inherit"/, 'the button must inherit the font family');
	assert.ok(!/^\s*font: "inherit",/m.test(styleBlock), 'the font shorthand must not be used — it resets weight and style');
	// `_sm_` 的三条尺寸覆盖必须都在。
	assert.match(styleBlock, /fontSize: 12/, 'sm font size must be 12px');
	assert.match(styleBlock, /lineHeight: "18px"/, 'sm line height must be 18px');
	assert.match(styleBlock, /height: 28/, 'sm height must be 28px');
});

test('the model provider stops writing after it is disposed', () => {
	// 插件停用时 provider 会被 dispose，但在途的 composerState 仍可能回来。
	// 没有防护的话会写模型表并 fire 到已经释放的监听方。
	const src = readSource('src/vs/workbench/contrib/dsh/browser/dshLanguageModelProvider.ts');
	assert.match(src, /private _disposed = false/, 'the provider must track disposal');
	assert.match(src, /override dispose\(\): void \{\s*\n\s*this\._disposed = true;/, 'dispose must set the flag');
	// 守卫必须在 await 之后、写表之前。
	const afterAwait = src.slice(src.indexOf("await this.client.call<ComposerState>('composerState'"));
	assert.match(afterAwait.slice(0, 400), /if \(this\._disposed\) \{\s*\n\s*return;/, 'the guard must sit right after the await');
});
