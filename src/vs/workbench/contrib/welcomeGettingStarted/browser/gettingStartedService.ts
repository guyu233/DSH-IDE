/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Memento } from '../../../common/memento.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { FileAccess } from '../../../../base/common/network.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { ILink, LinkedText, parseLinkedText } from '../../../../base/common/linkedText.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { coalesce } from '../../../../base/common/arrays.js';
import { localize, localize2 } from '../../../../nls.js';
import { asWebviewUri } from '../../webview/common/webview.js';

export const HasMultipleNewFileEntries = new RawContextKey<boolean>('hasMultipleNewFileEntries', false);

export const IWalkthroughsService = createDecorator<IWalkthroughsService>('walkthroughsService');

export const hiddenEntriesConfigurationKey = 'workbench.welcomePage.hiddenCategories';

export const walkthroughMetadataConfigurationKey = 'workbench.welcomePage.walkthroughMetadata';
export type WalkthroughMetaDataType = Map<string, { firstSeen: number; stepIDs: string[]; manaullyOpened: boolean }>;

const BUILT_IN_SOURCE = localize('builtin', "Built-In");

export interface IWalkthrough {
	id: string;
	title: string;
	description: string;
	order: number;
	source: string;
	isFeatured: boolean;
	next?: string;
	when: ContextKeyExpression;
	steps: IWalkthroughStep[];
	icon:
	| { type: 'icon'; icon: ThemeIcon }
	| { type: 'image'; path: string };
	walkthroughPageTitle: string;
}

export type IWalkthroughLoose = Omit<IWalkthrough, 'steps'> & { steps: (Omit<IWalkthroughStep, 'description'> & { description: string })[] };

export interface IResolvedWalkthrough extends IWalkthrough {
	steps: IResolvedWalkthroughStep[];
	newItems: boolean;
	recencyBonus: number;
	newEntry: boolean;
}

export interface IWalkthroughStep {
	id: string;
	title: string;
	description: LinkedText[];
	category: string;
	when: ContextKeyExpression;
	order: number;
	completionEvents: string[];
	media:
	| { type: 'image'; path: { hcDark: URI; hcLight: URI; light: URI; dark: URI }; altText: string }
	| { type: 'svg'; path: URI; altText: string }
	| { type: 'markdown'; path: URI; base: URI; root: URI }
	| { type: 'video'; path: { hcDark: URI; hcLight: URI; light: URI; dark: URI }; poster?: { hcDark: URI; hcLight: URI; light: URI; dark: URI }; root: URI; altText: string };
}

type StepProgress = { done: boolean };

export interface IResolvedWalkthroughStep extends IWalkthroughStep, StepProgress { }

export interface IWalkthroughsService {
	_serviceBrand: undefined;

	readonly onDidAddWalkthrough: Event<IResolvedWalkthrough>;
	readonly onDidRemoveWalkthrough: Event<string>;
	readonly onDidChangeWalkthrough: Event<IResolvedWalkthrough>;
	readonly onDidProgressStep: Event<IResolvedWalkthroughStep>;

	getWalkthroughs(): IResolvedWalkthrough[];
	getWalkthrough(id: string): IResolvedWalkthrough;

	registerWalkthrough(descriptor: IWalkthroughLoose): void;

	progressByEvent(eventName: string): void;
	progressStep(id: string): void;
	deprogressStep(id: string): void;

	markWalkthroughOpened(id: string): void;
}

// Show walkthrough as "new" for 7 days after first install
const DAYS = 24 * 60 * 60 * 1000;
const NEW_WALKTHROUGH_TIME = 7 * DAYS;

export class WalkthroughsService extends Disposable implements IWalkthroughsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidAddWalkthrough = this._register(new Emitter<IResolvedWalkthrough>());
	readonly onDidAddWalkthrough: Event<IResolvedWalkthrough> = this._onDidAddWalkthrough.event;
	private readonly _onDidRemoveWalkthrough = this._register(new Emitter<string>());
	readonly onDidRemoveWalkthrough: Event<string> = this._onDidRemoveWalkthrough.event;
	private readonly _onDidChangeWalkthrough = this._register(new Emitter<IResolvedWalkthrough>());
	readonly onDidChangeWalkthrough: Event<IResolvedWalkthrough> = this._onDidChangeWalkthrough.event;
	private readonly _onDidProgressStep = this._register(new Emitter<IResolvedWalkthroughStep>());
	readonly onDidProgressStep: Event<IResolvedWalkthroughStep> = this._onDidProgressStep.event;

	private memento: Memento<Record<string, StepProgress | undefined>>;
	private stepProgress: Record<string, StepProgress | undefined>;

	private sessionEvents = new Set<string>();
	private completionListeners = new Map<string, Set<string>>();

	private gettingStartedContributions = new Map<string, IWalkthrough>();
	private steps = new Map<string, IWalkthroughStep>();

	private sessionInstalledExtensions: Set<string> = new Set<string>();

	private categoryVisibilityContextKeys = new Set<string>();
	private stepCompletionContextKeyExpressions = new Set<ContextKeyExpression>();
	private stepCompletionContextKeys = new Set<string>();

	private metadata: WalkthroughMetaDataType;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService private readonly contextService: IContextKeyService,
	) {
		super();

		this.metadata = new Map(
			JSON.parse(
				this.storageService.get(walkthroughMetadataConfigurationKey, StorageScope.PROFILE, '[]')));

		this.memento = new Memento('gettingStartedService', this.storageService);
		this.stepProgress = this.memento.getMemento(StorageScope.PROFILE, StorageTarget.USER);


		HasMultipleNewFileEntries.bindTo(this.contextService).set(false);
		this.registerWalkthroughs();

	}

	private registerWalkthroughs(): void {
		// DSH-IDE 不提供 Walkthroughs：不装内置步骤，也不接收扩展的 walkthroughs 贡献。
	}

	markWalkthroughOpened(id: string) {
		const walkthrough = this.gettingStartedContributions.get(id);
		const prior = this.metadata.get(id);
		if (prior && walkthrough) {
			this.metadata.set(id, { ...prior, manaullyOpened: true, stepIDs: walkthrough.steps.map(s => s.id) });
		}

		this.storageService.store(walkthroughMetadataConfigurationKey, JSON.stringify([...this.metadata.entries()]), StorageScope.PROFILE, StorageTarget.USER);
	}

	getWalkthrough(id: string): IResolvedWalkthrough {

		const walkthrough = this.gettingStartedContributions.get(id);
		if (!walkthrough) { throw Error('Trying to get unknown walkthrough: ' + id); }
		return this.resolveWalkthrough(walkthrough);
	}

	getWalkthroughs(): IResolvedWalkthrough[] {

		const registeredCategories = [...this.gettingStartedContributions.values()];
		const categoriesWithCompletion = registeredCategories
			.map(category => {
				return {
					...category,
					content: {
						type: 'steps' as const,
						steps: category.steps
					}
				};
			})
			.filter(category => category.content.type !== 'steps' || category.content.steps.length)
			.filter(category => category.id !== 'NewWelcomeExperience')
			.map(category => this.resolveWalkthrough(category));

		return categoriesWithCompletion;
	}

	private resolveWalkthrough(category: IWalkthrough): IResolvedWalkthrough {

		const stepsWithProgress = category.steps.map(step => this.getStepProgress(step));

		const hasOpened = this.metadata.get(category.id)?.manaullyOpened;
		const firstSeenDate = this.metadata.get(category.id)?.firstSeen;
		const isNew = firstSeenDate && firstSeenDate > (+new Date() - NEW_WALKTHROUGH_TIME);

		const lastStepIDs = this.metadata.get(category.id)?.stepIDs;
		const rawCategory = this.gettingStartedContributions.get(category.id);
		if (!rawCategory) { throw Error('Could not find walkthrough with id ' + category.id); }

		const currentStepIds: string[] = rawCategory.steps.map(s => s.id);

		const hasNewSteps = lastStepIDs && (currentStepIds.length !== lastStepIDs.length || currentStepIds.some((id, index) => id !== lastStepIDs[index]));

		let recencyBonus = 0;
		if (firstSeenDate) {
			const currentDate = +new Date();
			const timeSinceFirstSeen = currentDate - firstSeenDate;
			recencyBonus = Math.max(0, (NEW_WALKTHROUGH_TIME - timeSinceFirstSeen) / NEW_WALKTHROUGH_TIME);
		}

		return {
			...category,
			recencyBonus,
			steps: stepsWithProgress,
			newItems: !!hasNewSteps,
			newEntry: !!(isNew && !hasOpened),
		};
	}

	private getStepProgress(step: IWalkthroughStep): IResolvedWalkthroughStep {
		return {
			...step,
			done: false,
			...this.stepProgress[step.id]
		};
	}

	progressStep(id: string) {
		const oldProgress = this.stepProgress[id];
		if (!oldProgress || oldProgress.done !== true) {
			this.stepProgress[id] = { done: true };
			this.memento.saveMemento();
			const step = this.getStep(id);
			if (!step) { throw Error('Tried to progress unknown step'); }

			this._onDidProgressStep.fire(this.getStepProgress(step));
		}
	}

	deprogressStep(id: string) {
		delete this.stepProgress[id];
		this.memento.saveMemento();
		const step = this.getStep(id);
		this._onDidProgressStep.fire(this.getStepProgress(step));
	}

	progressByEvent(event: string): void {
		if (this.sessionEvents.has(event)) { return; }

		this.sessionEvents.add(event);
		this.completionListeners.get(event)?.forEach(id => this.progressStep(id));
	}

	registerWalkthrough(walkthoughDescriptor: IWalkthroughLoose) {
		this._registerWalkthrough({
			...walkthoughDescriptor,
			steps: walkthoughDescriptor.steps.map(step => ({ ...step, description: parseDescription(step.description) }))
		});
	}

	_registerWalkthrough(walkthroughDescriptor: IWalkthrough): void {
		const oldCategory = this.gettingStartedContributions.get(walkthroughDescriptor.id);
		if (oldCategory) {
			console.error(`Skipping attempt to overwrite walkthrough. (${walkthroughDescriptor.id})`);
			return;
		}

		this.gettingStartedContributions.set(walkthroughDescriptor.id, walkthroughDescriptor);

		walkthroughDescriptor.steps.forEach(step => {
			if (this.steps.has(step.id)) { throw Error('Attempting to register step with id ' + step.id + ' twice. Second is dropped.'); }
			this.steps.set(step.id, step);
			step.when.keys().forEach(key => this.categoryVisibilityContextKeys.add(key));
			this.registerDoneListeners(step);
		});

		walkthroughDescriptor.when.keys().forEach(key => this.categoryVisibilityContextKeys.add(key));
	}

	private registerDoneListeners(step: IWalkthroughStep) {
		// eslint-disable-next-line local/code-no-any-casts
		if ((step as any).doneOn) {
			console.error(`wakthrough step`, step, `uses deprecated 'doneOn' property. Adopt 'completionEvents' to silence this warning`);
			return;
		}

		if (!step.completionEvents.length) {
			step.completionEvents = coalesce(
				step.description
					.filter(linkedText => linkedText.nodes.length === 1) // only buttons
					.flatMap(linkedText =>
						linkedText.nodes
							.filter(((node): node is ILink => typeof node !== 'string'))
							.map(({ href }) => {
								if (href.startsWith('command:')) {
									return 'onCommand:' + href.slice('command:'.length, href.includes('?') ? href.indexOf('?') : undefined);
								}
								if (href.startsWith('https://') || href.startsWith('http://')) {
									return 'onLink:' + href;
								}
								return undefined;
							})));
		}

		if (!step.completionEvents.length) {
			step.completionEvents.push('stepSelected');
		}

		for (let event of step.completionEvents) {
			const [_, eventType, argument] = /^([^:]*):?(.*)$/.exec(event) ?? [];

			if (!eventType) {
				console.error(`Unknown completionEvent ${event} when registering step ${step.id}`);
				continue;
			}

			switch (eventType) {
				case 'onLink': case 'onEvent': case 'onView': case 'onSettingChanged':
					break;
				case 'onContext': {
					const expression = ContextKeyExpr.deserialize(argument);
					if (expression) {
						this.stepCompletionContextKeyExpressions.add(expression);
						expression.keys().forEach(key => this.stepCompletionContextKeys.add(key));
						event = eventType + ':' + expression.serialize();
						if (this.contextService.contextMatchesRules(expression)) {
							this.sessionEvents.add(event);
						}
					} else {
						console.error('Unable to parse context key expression:', expression, 'in walkthrough step', step.id);
					}
					break;
				}
				case 'onStepSelected': case 'stepSelected':
					event = 'stepSelected:' + step.id;
					break;
				case 'onCommand':
					event = eventType + ':' + argument.replace(/^toSide:/, '');
					break;
				case 'onExtensionInstalled': case 'extensionInstalled':
					event = 'extensionInstalled:' + argument.toLowerCase();
					break;
				default:
					console.error(`Unknown completionEvent ${event} when registering step ${step.id}`);
					continue;
			}

			this.registerCompletionListener(event, step);
		}
	}

	private registerCompletionListener(event: string, step: IWalkthroughStep) {
		if (!this.completionListeners.has(event)) {
			this.completionListeners.set(event, new Set());
		}
		this.completionListeners.get(event)?.add(step.id);
	}

	private getStep(id: string): IWalkthroughStep {
		const step = this.steps.get(id);
		if (!step) { throw Error('Attempting to access step which does not exist in registry ' + id); }
		return step;
	}
}

export const parseDescription = (desc: string): LinkedText[] => desc.split('\n').filter(x => x).map(text => parseLinkedText(text));

export const convertInternalMediaPathToFileURI = (path: string) => path.startsWith('https://')
	? URI.parse(path, true)
	: FileAccess.asFileUri(`vs/workbench/contrib/welcomeGettingStarted/common/media/${path}`);

const convertInternalMediaPathToBrowserURI = (path: string) => path.startsWith('https://')
	? URI.parse(path, true)
	: FileAccess.asBrowserUri(`vs/workbench/contrib/welcomeGettingStarted/common/media/${path}`);
const convertInternalMediaPathsToBrowserURIs = (path: string | { hc: string; hcLight?: string; dark: string; light: string }): { hcDark: URI; hcLight: URI; dark: URI; light: URI } => {
	if (typeof path === 'string') {
		const converted = convertInternalMediaPathToBrowserURI(path);
		return { hcDark: converted, hcLight: converted, dark: converted, light: converted };
	} else {
		return {
			hcDark: convertInternalMediaPathToBrowserURI(path.hc),
			hcLight: convertInternalMediaPathToBrowserURI(path.hcLight ?? path.light),
			light: convertInternalMediaPathToBrowserURI(path.light),
			dark: convertInternalMediaPathToBrowserURI(path.dark)
		};
	}
};

const convertRelativeMediaPathsToWebviewURIs = (basePath: URI, path: string | { hc: string; hcLight?: string; dark: string; light: string }): { hcDark: URI; hcLight: URI; dark: URI; light: URI } => {
	const convertPath = (path: string) => path.startsWith('https://')
		? URI.parse(path, true)
		: asWebviewUri(joinPath(basePath, path));

	if (typeof path === 'string') {
		const converted = convertPath(path);
		return { hcDark: converted, hcLight: converted, dark: converted, light: converted };
	} else {
		return {
			hcDark: convertPath(path.hc),
			hcLight: convertPath(path.hcLight ?? path.light),
			light: convertPath(path.light),
			dark: convertPath(path.dark)
		};
	}
};


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'resetGettingStartedProgress',
			category: localize2('developer', "Developer"),
			title: localize2('resetWelcomePageWalkthroughProgress', "Reset Welcome Page Walkthrough Progress"),
			f1: true,
			metadata: {
				description: localize2('resetGettingStartedProgressDescription', 'Reset the progress of all Walkthrough steps on the Welcome Page to make them appear as if they are being viewed for the first time, providing a fresh start to the getting started experience.'),
			}
		});
	}

	run(accessor: ServicesAccessor) {
		const gettingStartedService = accessor.get(IWalkthroughsService);
		const storageService = accessor.get(IStorageService);

		storageService.store(
			hiddenEntriesConfigurationKey,
			JSON.stringify([]),
			StorageScope.PROFILE,
			StorageTarget.USER);

		storageService.store(
			walkthroughMetadataConfigurationKey,
			JSON.stringify([]),
			StorageScope.PROFILE,
			StorageTarget.USER);

		const memento = new Memento('gettingStartedService', accessor.get(IStorageService));
		const record = memento.getMemento(StorageScope.PROFILE, StorageTarget.USER);
		for (const key in record) {
			if (Object.prototype.hasOwnProperty.call(record, key)) {
				try {
					gettingStartedService.deprogressStep(key);
				} catch (e) {
					console.error(e);
				}
			}
		}
		memento.saveMemento();
	}
});

registerSingleton(IWalkthroughsService, WalkthroughsService, InstantiationType.Delayed);
