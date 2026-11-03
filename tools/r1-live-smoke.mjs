#!/usr/bin/env node
// R1 official-connectivity smoke — verifies a RUNNING DSH Host accepts the official
// dsh-client-connection flow from an external process (the same flow DSH-IDE uses).
//
// Usage:
//   node tools/r1-live-smoke.mjs --endpoint http://127.0.0.1:<port> --token <launchToken>
//
// Where to get endpoint + token:
//   - POST http://<host>/dsh-ide-launch returns { endpoint, token } (from the dsh-ide plugin), OR
//   - the DSH Web UI URL carries ?token=<launchToken>; strip it to get the endpoint.
//
// Flow (matches app.asar dsh-client-connection/lib/types/client/{rpc,connect-protocol}.js):
//   1) GET  <endpoint>/connect?token=<token>&interactions=none  -> 302 + Set-Cookie
//   2) POST <endpoint>/api/session/list  (official client-request envelope, with cookie)
//   3) expect {"type":"server-response", rpcId, result:{ok:true, value:{items:[...]}}}
//
// No private pipe, no self-made channel — 100% official /api.

import { randomUUID } from 'node:crypto';

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const endpoint = (arg('--endpoint') || process.env.DSH_IDE_ENDPOINT || '').replace(/\/+$/, '');
const token = arg('--token') || process.env.DSH_IDE_TOKEN || '';
if (!endpoint || !token) {
	console.error('usage: node tools/r1-live-smoke.mjs --endpoint http://127.0.0.1:<port> --token <launchToken>');
	process.exit(2);
}

async function main() {
	// 1) official /connect -> cookie
	const connectUrl = new URL(endpoint + '/connect');
	connectUrl.searchParams.set('token', token);
	connectUrl.searchParams.set('interactions', 'none');
	const cres = await fetch(connectUrl.href, { method: 'GET', redirect: 'manual' });
	const setCookies = typeof cres.headers.getSetCookie === 'function' ? cres.headers.getSetCookie() : (cres.headers.get('set-cookie') ? [cres.headers.get('set-cookie')] : []);
	if (cres.status !== 302 || setCookies.length === 0) {
		console.error(`FAIL: /connect did not mint a session cookie (HTTP ${cres.status}). Wrong/expired token, or Host not reachable.`);
		process.exit(1);
	}
	const cookie = setCookies[0].split(';', 1)[0].trim();
	console.log('ok - /connect exchanged token -> API Peer cookie');

	// 2) official unary /api/session/list
	const rpcId = randomUUID();
	const body = JSON.stringify({ type: 'client-request', rpcId, method: 'session/list', payload: { args: {} } });
	const ares = await fetch(endpoint + '/api/session/list', {
		method: 'POST', headers: { 'content-type': 'application/json', cookie }, body,
	});
	if (!ares.ok) { console.error(`FAIL: /api/session/list HTTP ${ares.status}`); process.exit(1); }
	const json = await ares.json();
	if (json.type !== 'server-response' || json.rpcId !== rpcId || !json.result) { console.error('FAIL: invalid server-response envelope', json); process.exit(1); }
	if (!json.result.ok) { console.error('FAIL: Host returned error', json.result.error); process.exit(1); }
	const items = json.result.value?.items ?? [];
	console.log(`ok - official /api/session/list returned ${Array.isArray(items) ? items.length : '?'} session(s)`);
	console.log('R1 LIVE SMOKE: PASS — this external process reached the same Host over the official transport.');
}

main().catch((e) => { console.error('R1 LIVE SMOKE: FAIL', e && e.message || e); process.exit(1); });
