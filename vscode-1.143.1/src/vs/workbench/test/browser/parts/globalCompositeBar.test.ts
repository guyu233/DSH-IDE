/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { GlobalCompositeBar } from '../../../browser/parts/globalCompositeBar.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { Action } from '../../../../base/common/actions.js';
import { Emitter } from '../../../../base/common/event.js';
import { ACCOUNTS_ACTIVITY_ID, GLOBAL_ACTIVITY_ID } from '../../../common/activity.js';

interface IGlobalCompositeBarTestHarness {
	globalActivityActionBar: ActionBar;
	accountAction: Action;
	accountsVisibilityPreference: boolean;
	_onDidChange: Emitter<void>;
	getHeight: typeof GlobalCompositeBar.prototype.getHeight;
	toggleAccountsActivity(): void;
}

const toggleAccountsActivity = Reflect.get(GlobalCompositeBar.prototype, 'toggleAccountsActivity') as (this: IGlobalCompositeBarTestHarness) => void;

suite('GlobalCompositeBar', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createGlobalBar(accountsVisible: boolean): IGlobalCompositeBarTestHarness {
		const globalActivityActionBar = store.add(new ActionBar(document.createElement('div')));
		const accountAction = store.add(new Action(ACCOUNTS_ACTIVITY_ID));
		if (accountsVisible) {
			globalActivityActionBar.push(accountAction);
		}
		globalActivityActionBar.push(store.add(new Action(GLOBAL_ACTIVITY_ID)));
		return {
			globalActivityActionBar,
			accountAction,
			accountsVisibilityPreference: accountsVisible,
			_onDidChange: store.add(new Emitter<void>()),
			getHeight: GlobalCompositeBar.prototype.getHeight,
			toggleAccountsActivity,
		};
	}

	test('counts only gaps between rendered actions', () => {
		const bar = createGlobalBar(true);
		const twoActions = bar.getHeight(36, 8);
		bar.globalActivityActionBar.pull(0);
		const oneAction = bar.getHeight(36, 8);
		bar.globalActivityActionBar.clear();
		const empty = bar.getHeight(36, 8);

		assert.deepStrictEqual({ twoActions, oneAction, empty }, { twoActions: 80, oneAction: 36, empty: 0 });
	});

	test('reports size changes when Accounts is toggled, without duplicating actions', () => {
		const bar = createGlobalBar(true);
		const heights = [bar.getHeight(36, 8)];
		store.add(bar._onDidChange.event(() => heights.push(bar.getHeight(36, 8))));

		bar.toggleAccountsActivity();
		bar.accountsVisibilityPreference = false;
		bar.toggleAccountsActivity();
		bar.toggleAccountsActivity();
		bar.accountsVisibilityPreference = true;
		bar.toggleAccountsActivity();
		bar.toggleAccountsActivity();

		assert.deepStrictEqual({ heights, actions: bar.globalActivityActionBar.length() }, { heights: [80, 36, 80], actions: 2 });
	});

	test('keeps a hidden Accounts action hidden when its preference is unchanged', () => {
		const bar = createGlobalBar(false);
		const heights: number[] = [];
		store.add(bar._onDidChange.event(() => heights.push(bar.getHeight(28, 0))));

		bar.toggleAccountsActivity();

		assert.deepStrictEqual({ heights, height: bar.getHeight(28, 0), actions: bar.globalActivityActionBar.length() }, { heights: [], height: 28, actions: 1 });
	});
});
