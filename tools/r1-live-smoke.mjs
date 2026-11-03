#!/usr/bin/env node
// R1/R2 official-connectivity smoke against a RUNNING DSH Host (the same flow DSH-IDE uses).
//
// Usage:
//   node tools/r1-live-smoke.mjs --endpoint http://127.0.0.1:<port> --token <launchToken> [--session <id>] [--stream]
//
// Flow (matches app.asar dsh-client-connection: authorizeIndex + rpc + stream-protocol):
//   1) GET  <endpoint>/?token=<token>          -> 303 + signed session cookie (shared browserPeer)
//   2) POST <endpoint>/api/session/list        (official client-request envelope, with cookie)
//   3) --stream: ws <endpoint>/api/remote.mux  (open session/follow, print first frames)
//
// endpoint+token come from POST /dsh-ide-launch (the dsh-ide plugin) or the DSH Web UI ?token=.

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

function arg(n){ const i=process.argv.indexOf(n); return i>=0?process.argv[i+1]:undefined; }
const has = (n) => process.argv.includes(n);
const endpoint = (arg('--endpoint') || process.env.DSH_IDE_ENDPOINT || '').replace(/\/+$/, '');
const token = arg('--token') || process.env.DSH_IDE_TOKEN || '';
const sessionArg = arg('--session');
if (!endpoint || !token) { console.error('usage: node tools/r1-live-smoke.mjs --endpoint http://127.0.0.1:<port> --token <launchToken> [--session <id>] [--stream]'); process.exit(2); }

async function main() {
	// 1) browser-cookie exchange
	const u = new URL(endpoint + '/'); u.searchParams.set('token', token);
	const cres = await fetch(u.href, { method: 'GET', redirect: 'manual' });
	const sc = typeof cres.headers.getSetCookie === 'function' ? cres.headers.getSetCookie() : (cres.headers.get('set-cookie') ? [cres.headers.get('set-cookie')] : []);
	if (!((cres.status === 303 || cres.status === 302) && sc.length)) { console.error(`FAIL: token exchange did not mint a cookie (HTTP ${cres.status}). Wrong/expired token?`); process.exit(1); }
	const cookie = sc[0].split(';',1)[0].trim();
	console.log('ok - token exchange -> session cookie');

	// 2) unary session/list
	const rpcId = randomUUID();
	const body = JSON.stringify({ type:'client-request', rpcId, method:'session/list', payload:{ args:{} } });
	const ares = await fetch(endpoint + '/api/session/list', { method:'POST', headers:{ 'content-type':'application/json', cookie }, body });
	if (!ares.ok) { console.error(`FAIL: /api/session/list HTTP ${ares.status}`); process.exit(1); }
	const json = await ares.json();
	if (json.rpcId !== rpcId || !json.result) { console.error('FAIL: bad server-response', json); process.exit(1); }
	if (!json.result.ok) { console.error('FAIL: Host error', json.result.error); process.exit(1); }
	const items = json.result.value?.items ?? [];
	console.log(`ok - official /api/session/list -> ${items.length} session(s)`);

	// 3) optional stream
	if (has('--stream')) {
		const sid = sessionArg || (items[0] && items[0].sessionId);
		if (!sid) { console.error('FAIL: --stream needs a session; pass --session <id>'); process.exit(1); }
		await new Promise((resolve) => {
			const ws = new WebSocket(endpoint.replace(/^http/,'ws') + '/api/remote.mux', { headers: { cookie } });
			const streamId = randomUUID(); let seen = 0;
			ws.on('open', () => ws.send(JSON.stringify({ type:'open', streamId, endpoint:'session/follow', payload:{ args:{ address:{ kind:'session', sessionId: sid } } } })));
			ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.streamId!==streamId) return; seen++; if (m.type==='item' && m.value?.type==='snapshot') console.log('ok - follow snapshot received'); if (seen>=2 || m.type==='end') { ws.close(); } });
			ws.on('close', () => resolve());
			ws.on('error', (e) => { console.error('FAIL: ws', e.message); resolve(); });
			setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 5000);
		});
		console.log('ok - /api/remote.mux stream exercised');
	}
	console.log('LIVE SMOKE: PASS — external process reached the same Host over official transport.');
}
main().catch((e) => { console.error('LIVE SMOKE: FAIL', e && e.message || e); process.exit(1); });
