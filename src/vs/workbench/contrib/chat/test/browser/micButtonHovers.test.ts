/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { DICTATION_MAI_MODEL_ID, DICTATION_MODEL_SETTING } from '../../browser/speechToText/chatSpeechToTextService.js';
import { getDictationDownloadHoverMarkdown } from '../../browser/speechToText/dictationDownloadRing.js';
import { getDictationHoverMarkdown } from '../../browser/speechToText/micButtonHovers.js';

suite('MicButtonHovers', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses user-facing names for supported dictation models', () => {
		const cloud = new TestConfigurationService({ [DICTATION_MODEL_SETTING]: DICTATION_MAI_MODEL_ID });
		const legacyLocal = new TestConfigurationService({ [DICTATION_MODEL_SETTING]: 'legacy-on-device-model' });

		assert.deepStrictEqual({
			cloud: getDictationHoverMarkdown('Dictate', cloud, false).value,
			legacyLocal: getDictationHoverMarkdown('Dictate', legacyLocal, false).value,
			web: getDictationHoverMarkdown('Dictate', legacyLocal, true).value,
		}, {
			cloud: '**Dictate**\n\nTypes what you say into the input. Transcription is performed by the speech provider selected in DeepSeek Harness.',
			legacyLocal: '**Dictate**\n\nTypes what you say into the input. Transcription is performed by the speech provider selected in DeepSeek Harness.',
			web: '**Dictate**\n\nTypes what you say into the input. Transcription is performed by the speech provider selected in DeepSeek Harness.',
		});
	});

	test('describes the model download while dictation is preparing', () => {
		assert.strictEqual(getDictationDownloadHoverMarkdown({ currentBackend: 'nemo' }).value, '**Downloading local model**\n\nThis happens only the first time you dictate. Click to cancel.');
	});
});
