/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getMacOSWindowControlsPosition } from '../../common/window.js';

suite('window', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('preserves legacy macOS traffic-light positioning without a fixed inset', () => {
		assert.deepStrictEqual({
			beforeTahoe: [35, 44, 16].map(height => getMacOSWindowControlsPosition(height, '24.0.0')),
			tahoe: [35, 44, 14].map(height => getMacOSWindowControlsPosition(height, '25.0.0')),
		}, {
			beforeTahoe: [{ x: 10, y: 9 }, { x: 15, y: 14 }, null],
			tahoe: [{ x: 11, y: 10 }, { x: 16, y: 15 }, null],
		});
	});

	test('keeps macOS traffic lights horizontally fixed while centering different heights', () => {
		assert.deepStrictEqual({
			beforeTahoe: [35, 44, 35].map(height => getMacOSWindowControlsPosition(height, '24.0.0', 10)),
			tahoe: [35, 44, 35].map(height => getMacOSWindowControlsPosition(height, '25.0.0', 11)),
			zoomedBeforeTahoe: [44, 55, 44].map(height => getMacOSWindowControlsPosition(height, '24.0.0', 15)),
			zoomedTahoe: [44, 55, 44].map(height => getMacOSWindowControlsPosition(height, '25.0.0', 16)),
		}, {
			beforeTahoe: [{ x: 10, y: 9 }, { x: 10, y: 14 }, { x: 10, y: 9 }],
			tahoe: [{ x: 11, y: 10 }, { x: 11, y: 15 }, { x: 11, y: 10 }],
			zoomedBeforeTahoe: [{ x: 15, y: 14 }, { x: 15, y: 19 }, { x: 15, y: 14 }],
			zoomedTahoe: [{ x: 16, y: 15 }, { x: 16, y: 20 }, { x: 16, y: 15 }],
		});
	});

});
