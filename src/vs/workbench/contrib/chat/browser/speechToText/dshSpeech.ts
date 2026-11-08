/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// WAV encoding adapted from DeepSeek Harness client-ui-voice-input/src/client/audio.ts.
// Copyright (c) 2026 DeepSeek. MIT License:
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software
// and associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute,
// sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
// BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import { VSBuffer, encodeBase64 } from '../../../../../base/common/buffer.js';
import { IDshClientService } from '../../../../../platform/dshClient/common/dshClientService.js';

export interface DshSpeechCatalog {
	readonly providers: readonly { readonly id: string; readonly preparation: { readonly phase: string } }[];
	readonly selection: { readonly providerId: string; readonly language: string };
	readonly maxAudioBytes: number;
	readonly maxDurationSeconds: number;
}

/** Validate the Host's selected provider and limits without selecting a fallback. */
export function dshSpeechSampleLimit(catalog: DshSpeechCatalog): number {
	if (!catalog.selection?.providerId || !catalog.providers?.some(provider => provider.id === catalog.selection.providerId && ['ready', 'standby', 'waking'].includes(provider.preparation?.phase))) {
		return 0;
	}
	if (!Number.isFinite(catalog.maxAudioBytes) || !Number.isFinite(catalog.maxDurationSeconds)) {
		return 0;
	}
	return Math.max(0, Math.floor(Math.min((catalog.maxAudioBytes - 44) / 2, catalog.maxDurationSeconds * 16000)));
}

/** Encode native-resampled 16 kHz mono samples as canonical PCM16 WAV. */
export function encodeDshSpeechWave(samples: Float32Array): Uint8Array {
	const bytes = new Uint8Array(44 + samples.length * 2);
	const view = new DataView(bytes.buffer);
	const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) { bytes[at + i] = value.charCodeAt(i); } };
	text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
	view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
	view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
	view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data');
	view.setUint32(40, samples.length * 2, true);
	for (const [i, sample] of samples.entries()) {
		const value = Math.max(-1, Math.min(1, sample));
		view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
	}
	return bytes;
}

/** Transcribe without activating a provider or submitting a chat message. */
export async function transcribeDshSpeech(client: Pick<IDshClientService, 'call'>, catalog: DshSpeechCatalog, samples: Float32Array): Promise<string> {
	const limit = dshSpeechSampleLimit(catalog);
	if (!samples.length || !limit || samples.length > limit) {
		throw new Error('Speech recording is unavailable or exceeds the Host limits');
	}
	const request = {
		audioBase64: encodeBase64(VSBuffer.wrap(encodeDshSpeechWave(samples))),
		providerId: catalog.selection.providerId,
		language: catalog.selection.language,
	};
	const result = await client.call<{ readonly text: string }>('speech/transcribe', { request });
	if (!result.ok) {
		throw new Error(result.error.message);
	}
	return result.value.text;
}
