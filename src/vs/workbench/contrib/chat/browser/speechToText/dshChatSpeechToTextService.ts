/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { status } from '../../../../../base/browser/ui/aria/aria.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IDshClientService } from '../../../../../platform/dshClient/common/dshClientService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { AgentsVoiceStorageKeys } from '../../../agentsVoice/common/agentsVoice.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { createPcmCaptureNode, IPcmCaptureNode } from '../pcmCaptureWorklet.js';
import { getMediaCaptureWindow } from '../voiceClient/micCaptureService.js';
import { ChatDictationSurface, ChatSpeechToTextState, IChatDictationTranscript, IChatSpeechToTextService } from './chatSpeechToTextService.js';
import { DshSpeechCatalog, dshSpeechSampleLimit, transcribeDshSpeech } from './dshSpeech.js';
import { stopDictation } from './dictationSession.js';

/** DSH-backed implementation of the existing chat dictation service. */
export class DshChatSpeechToTextService extends Disposable implements IChatSpeechToTextService {
	declare readonly _serviceBrand: undefined;

	private readonly stateEmitter = this._register(new Emitter<ChatSpeechToTextState>());
	readonly onDidChangeState = this.stateEmitter.event;
	readonly onDidUpdateTranscript: Event<IChatDictationTranscript> = Event.None;
	readonly onDidChangePreparingModel: Event<boolean> = Event.None;
	readonly onDidChangeDownloadingModel: Event<boolean> = Event.None;
	readonly onDidChangeModelDownloadProgress: Event<void> = Event.None;
	readonly showTranscriptWhileDictating = false;
	readonly isPreparingModel = false;
	readonly isDownloadingModel = false;
	readonly modelDownloadProgress = undefined;
	readonly currentBackend = 'dsh';

	private _state = ChatSpeechToTextState.Idle;
	private _surface: ChatDictationSurface = 'chat';
	private generation = 0;
	private starting = false;
	private pendingStop: Promise<string | undefined> | undefined;
	private catalog: DshSpeechCatalog | undefined;
	private chunks: Float32Array[] = [];
	private sampleCount = 0;
	private switchGeneration = 0;
	private limitTimer: ReturnType<typeof setTimeout> | undefined;
	private limitStopRequested = false;
	private stream: MediaStream | undefined;
	private context: AudioContext | undefined;
	private source: MediaStreamAudioSourceNode | undefined;
	private analyser: AnalyserNode | undefined;
	private capture: IPcmCaptureNode | undefined;
	private readonly recordingKey: IContextKey<boolean>;
	private readonly configuredKey: IContextKey<boolean>;

	constructor(
		private readonly createCapture: typeof createPcmCaptureNode = createPcmCaptureNode,
		@IDshClientService private readonly client: IDshClientService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IContextKeyService contextKeys: IContextKeyService,
		@INotificationService private readonly notifications: INotificationService,
		@IStorageService private readonly storage: IStorageService,
		@IAccessibilitySignalService private readonly signals: IAccessibilitySignalService,
	) {
		super();
		this.recordingKey = ChatContextKeys.speechToTextRecording.bindTo(contextKeys);
		this.configuredKey = ChatContextKeys.speechToTextConfigured.bindTo(contextKeys);
		ChatContextKeys.speechToTextUsesMai.bindTo(contextKeys).set(false);
		ChatContextKeys.speechToTextPreparing.bindTo(contextKeys).set(false);
		this.updateConfigured();
		this._register(configuration.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('dictation.enabled')) {
				this.updateConfigured();
			}
		}));
	}

	get state(): ChatSpeechToTextState { return this._state; }
	get currentSurface(): ChatDictationSurface { return this._surface; }
	get isBusy(): boolean { return this.starting || this._state !== ChatSpeechToTextState.Idle || !!this.pendingStop; }
	get isConfigured(): boolean { return this.configuration.getValue<boolean>('dictation.enabled') !== false; }
	get analyserNode(): AnalyserNode | undefined { return this.analyser; }
	get maxRecordingDurationMs(): number | undefined {
		return this.catalog ? dshSpeechSampleLimit(this.catalog) / 16000 * 1000 : undefined;
	}

	private updateConfigured(): void {
		// Leave the action discoverable: start() explains when the optional DSH
		// service is missing or its selected provider is not ready.
		this.configuredKey.set(this.isConfigured);
	}

	private setState(state: ChatSpeechToTextState): void {
		this._state = state;
		this.recordingKey.set(state === ChatSpeechToTextState.Recording && this._surface === 'chat');
		this.stateEmitter.fire(state);
	}

	async start(targetWindow: Window & typeof globalThis, surface: ChatDictationSurface = 'chat'): Promise<void> {
		if (this.isBusy || !this.isConfigured) { return; }
		const generation = ++this.generation;
		this.starting = true;
		try {
			const result = await this.client.call<DshSpeechCatalog>('speech/catalog', {});
			if (generation !== this.generation) { return; }
			if (!result.ok || !dshSpeechSampleLimit(result.value)) {
				this.notifications.warn(localize('dshSpeech.unavailable', "DSH speech-to-text is unavailable or its selected provider is not ready. Configure it in DeepSeek Harness."));
				return;
			}
			this.catalog = result.value;
			this._surface = surface;
			this.chunks = [];
			this.sampleCount = 0;
			this.limitStopRequested = false;
			const window = getMediaCaptureWindow(targetWindow);
			const device = this.storage.get(AgentsVoiceStorageKeys.MicrophoneDevice, StorageScope.APPLICATION);
			const stream = await this.acquire(window, device);
			if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
			this.stream = stream;
			const context = this.context = new window.AudioContext({ sampleRate: 16000 });
			if (context.sampleRate !== 16000) { throw new Error(localize('dshSpeech.sampleRate', "The microphone cannot capture audio at 16 kHz.")); }
			await context.resume();
			const capture = await this.createCapture(window, context, 4096, samples => this.captureSamples(samples, generation));
			if (generation !== this.generation) { capture.node.port.onmessage = null; capture.node.disconnect(); return; }
			this.capture = capture;
			this.connectStream(stream, context);
			capture.node.connect(context.destination);
			this.setState(ChatSpeechToTextState.Recording);
			this.limitTimer = setTimeout(() => this.stopAtLimit(generation), this.maxRecordingDurationMs);
			this.signals.playSignal(AccessibilitySignal.voiceRecordingStarted);
		} catch (error) {
			if (generation === this.generation) {
				this.release();
				this.catalog = undefined;
				this.notifications.error(localize('dshSpeech.startFailed', "Could not start DSH dictation: {0}", error instanceof Error ? error.message : String(error)));
			}
		} finally {
			if (generation === this.generation) { this.starting = false; }
		}
	}

	private async acquire(window: Window & typeof globalThis, deviceId?: string): Promise<MediaStream> {
		const audio: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true };
		if (deviceId) { audio.deviceId = { exact: deviceId }; }
		return window.navigator.mediaDevices.getUserMedia({ audio });
	}

	private connectStream(stream: MediaStream, context: AudioContext): void {
		const source = context.createMediaStreamSource(stream);
		const analyser = context.createAnalyser();
		analyser.fftSize = 256;
		analyser.smoothingTimeConstant = 0.75;
		source.connect(analyser);
		analyser.connect(this.capture!.node);
		this.source = source;
		this.analyser = analyser;
		for (const track of stream.getAudioTracks()) {
			track.onended = () => {
				if (this.stream === stream && this.state === ChatSpeechToTextState.Recording) {
					this.notifications.warn(localize('dshSpeech.interrupted', "DSH dictation stopped because the microphone was disconnected."));
					void this.cancel();
				}
			};
		}
	}

	private captureSamples(samples: Float32Array, generation: number): void {
		if (generation !== this.generation || !this.catalog) { return; }
		const remaining = dshSpeechSampleLimit(this.catalog) - this.sampleCount;
		if (remaining <= 0) { return; }
		const chunk = samples.slice(0, remaining);
		this.chunks.push(chunk);
		this.sampleCount += chunk.length;
		if (this.sampleCount >= dshSpeechSampleLimit(this.catalog)) { this.stopAtLimit(generation); }
	}

	private stopAtLimit(generation: number): void {
		if (generation !== this.generation || this.state !== ChatSpeechToTextState.Recording || this.limitStopRequested) { return; }
		this.limitStopRequested = true;
		status(localize('dshSpeech.limitReached', "Dictation stopped at the DSH recording limit."));
		void stopDictation();
	}

	async switchMicrophone(targetWindow: Window & typeof globalThis, deviceId: string): Promise<AnalyserNode | undefined> {
		if (this._state !== ChatSpeechToTextState.Recording || !this.context || !this.capture) { return this.analyser; }
		const generation = this.generation;
		const switchGeneration = ++this.switchGeneration;
		const context = this.context;
		const stream = await this.acquire(getMediaCaptureWindow(targetWindow), deviceId);
		if (generation !== this.generation || switchGeneration !== this.switchGeneration || context !== this.context) { stream.getTracks().forEach(track => track.stop()); return this.analyser; }
		const oldStream = this.stream;
		const oldSource = this.source;
		const oldAnalyser = this.analyser;
		try {
			this.connectStream(stream, context);
			this.stream = stream;
		} catch (error) {
			stream.getTracks().forEach(track => track.stop());
			throw error;
		}
		oldSource?.disconnect();
		oldAnalyser?.disconnect();
		oldStream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
		return this.analyser;
	}

	async stopAndTranscribe(): Promise<string | undefined> {
		if (this.pendingStop) { return this.pendingStop; }
		if (this._state !== ChatSpeechToTextState.Recording) { return undefined; }
		const generation = this.generation;
		const operation = this.finish(generation);
		this.pendingStop = operation;
		try { return await operation; } finally { if (this.pendingStop === operation) { this.pendingStop = undefined; } }
	}

	private async finish(generation: number): Promise<string | undefined> {
		this.setState(ChatSpeechToTextState.Transcribing);
		try {
			await this.capture?.flush();
			if (generation !== this.generation) { return undefined; }
			this.release();
			this.signals.playSignal(AccessibilitySignal.voiceRecordingStopped);
			const catalog = this.catalog;
			if (!catalog || !this.sampleCount) { return undefined; }
			const samples = new Float32Array(this.sampleCount);
			let offset = 0;
			for (const chunk of this.chunks) { samples.set(chunk, offset); offset += chunk.length; }
			const text = await transcribeDshSpeech(this.client, catalog, samples);
			return generation === this.generation ? text : undefined;
		} catch (error) {
			if (generation === this.generation) {
				this.notifications.error(localize('dshSpeech.transcribeFailed', "DSH speech-to-text failed: {0}", error instanceof Error ? error.message : String(error)));
			}
			return undefined;
		} finally {
			if (generation === this.generation) {
				this.release();
				this.catalog = undefined;
				this.chunks = [];
				this.sampleCount = 0;
				this.setState(ChatSpeechToTextState.Idle);
			}
		}
	}

	async cancel(): Promise<void> {
		const wasRecording = this.state === ChatSpeechToTextState.Recording;
		this.generation++;
		this.switchGeneration++;
		this.starting = false;
		this.release();
		this.catalog = undefined;
		this.chunks = [];
		this.sampleCount = 0;
		this.setState(ChatSpeechToTextState.Idle);
		if (wasRecording) { this.signals.playSignal(AccessibilitySignal.voiceRecordingStopped); }
	}

	private release(): void {
		clearTimeout(this.limitTimer);
		this.limitTimer = undefined;
		this.capture?.node.disconnect();
		if (this.capture) { this.capture.node.port.onmessage = null; }
		this.capture = undefined;
		this.source?.disconnect();
		this.source = undefined;
		this.analyser?.disconnect();
		this.analyser = undefined;
		this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
		this.stream = undefined;
		if (this.context) { void this.context.close().catch(() => undefined); }
		this.context = undefined;
	}

	logDictationAccuracy(): void { /* No transcript or telemetry is sent by this service. */ }

	override dispose(): void {
		void this.cancel();
		super.dispose();
	}
}
