/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { DshSpeechCatalog, dshSpeechSampleLimit, encodeDshSpeechWave, transcribeDshSpeech } from '../../../browser/speechToText/dshSpeech.js';
import { IDshClientService } from '../../../../../../platform/dshClient/common/dshClientService.js';

suite('DSH speech', () => {
	const catalog: DshSpeechCatalog = {
		providers: [{ id: 'selected', preparation: { phase: 'ready' } }],
		selection: { providerId: 'selected', language: 'zh' },
		maxAudioBytes: 48,
		maxDurationSeconds: 120,
	};

	test('encodes canonical mono PCM16 WAV and clamps samples', () => {
		const bytes = encodeDshSpeechWave(new Float32Array([-2, 1]));
		const view = new DataView(bytes.buffer);
		assert.deepStrictEqual({
			riff: String.fromCharCode(...bytes.slice(0, 4)),
			wave: String.fromCharCode(...bytes.slice(8, 12)),
			length: view.getUint32(4, true),
			format: view.getUint16(20, true),
			channels: view.getUint16(22, true),
			rate: view.getUint32(24, true),
			bits: view.getUint16(34, true),
			dataLength: view.getUint32(40, true),
			samples: [view.getInt16(44, true), view.getInt16(46, true)],
		}, { riff: 'RIFF', wave: 'WAVE', length: 40, format: 1, channels: 1, rate: 16000, bits: 16, dataLength: 4, samples: [-32768, 32767] });
	});

	test('uses selected provider readiness and both Host limits', () => {
		assert.strictEqual(dshSpeechSampleLimit(catalog), 2);
		assert.strictEqual(dshSpeechSampleLimit({ ...catalog, maxAudioBytes: 100000, maxDurationSeconds: 0.001 }), 16);
		assert.strictEqual(dshSpeechSampleLimit({ ...catalog, selection: { ...catalog.selection, providerId: 'missing' } }), 0);
		assert.strictEqual(dshSpeechSampleLimit({ ...catalog, providers: [{ id: 'selected', preparation: { phase: 'downloading' } }] }), 0);
		assert.strictEqual(dshSpeechSampleLimit({ ...catalog, providers: [{ id: 'selected', preparation: { phase: 'standby' } }] }), 2);
	});

	test('unavailable catalog and failed RPC never invoke preparation or fallback', async () => {
		const call = sinon.stub().resolves({ ok: false, error: { code: 'remote/missing', message: 'disabled' } });
		const client = { call } as Pick<IDshClientService, 'call'>;
		await assert.rejects(transcribeDshSpeech(client, catalog, new Float32Array([0])));
		assert.strictEqual(call.callCount, 0);
		call.resolves({ ok: false, error: { code: 'speech/transcription-failed', message: 'not ready' } });
		await assert.rejects(transcribeDshSpeech(client, { ...catalog, maxAudioBytes: 46 }, new Float32Array([0])));
		assert.deepStrictEqual(call.firstCall.args, ['speech/transcribe', sinon.match.object]);
		assert.strictEqual(call.callCount, 1);
	});

	test('sends the canonical speech request and returns its transcript', async () => {
		const call = sinon.stub().resolves({ ok: true, value: { text: '识别结果' } });
		const client = { call } as Pick<IDshClientService, 'call'>;
		const samples = new Float32Array([0, 1]);
		assert.strictEqual(await transcribeDshSpeech(client, catalog, samples), '识别结果');
		assert.deepStrictEqual(call.firstCall.args, ['speech/transcribe', { request: {
			audioBase64: Buffer.from(encodeDshSpeechWave(samples)).toString('base64'), providerId: 'selected', language: 'zh',
		} }]);
	});
});
