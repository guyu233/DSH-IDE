/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export const IChatSpeechToTextService = createDecorator<IChatSpeechToTextService>('chatSpeechToTextService');



export const DICTATION_MODEL_SETTING = 'dictation.model';

export const enum DictationSettingId {
	ShowTranscript = 'dictation.showTranscript',
	ShowButton = 'dictation.showButton',
}

/** `dictation.model` sentinel selecting the cloud transcription backend. */
export const DICTATION_MAI_MODEL_ID = 'mai';



/**
 * A completed dictation whose text has now left the input (submitted or
 * cleared), measured to compare what was dictated against what was sent. Only
 * aggregate character metrics are logged; the transcript text never is.
 */
export interface IDictationAccuracyMeasurement {
	/** The text originally inserted by dictation. */
	readonly dictatedText: string;
	/** The text occupying the dictated region at the moment it left the input. */
	readonly submittedText: string;
	/** Backend that produced the dictated text, captured when dictation finished. */
	readonly backend: string;
	/** Surface the dictation ran in, for slicing. */
	readonly surface: ChatDictationSurface;
	/** Whether this was measured at an actual submit versus a clear/teardown. */
	readonly submitted: boolean;
}

export const enum ChatSpeechToTextState {
	/** Not recording. */
	Idle = 'idle',
	/** Capturing microphone audio and streaming it for transcription. */
	Recording = 'recording',
	/** Recording stopped, awaiting the final transcript. */
	Transcribing = 'transcribing',
}

/**
 * The surface a dictation session was started from. Reported in telemetry so
 * built-in dictation usage can be attributed to the chat input, an editor, or
 * the terminal.
 */
export type ChatDictationSurface = 'chat' | 'editor' | 'terminal';

/** A live dictation transcript update. */
export interface IChatDictationTranscript {
	/** Full cumulative transcript to display. */
	readonly text: string;
	/**
	 * The leading portion of `text` that is finalized (committed) by the
	 * recognizer. Note that streaming backends endpoint segments almost as fast
	 * as they are spoken, so this is not a good signal for how much of the
	 * transcript has settled from the user's point of view.
	 */
	readonly finalizedText: string;
}

export interface IChatSpeechToTextStopOptions {
	/** Keep the cumulative transcript emitted while recording unless the backend's post-stop hypothesis extends it. */
	readonly preserveLiveTranscript?: boolean;
}

export interface IChatSpeechToTextService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeState: Event<ChatSpeechToTextState>;
	readonly state: ChatSpeechToTextState;
	readonly isBusy: boolean;
	/** Dictation surface associated with the current or most recent session. */
	readonly currentSurface: ChatDictationSurface;

	/**
	 * Fires with the cumulative transcript while recording, so callers can
	 * render dictation live as the user speaks. The value grows monotonically
	 * (finalized utterances plus any in-progress delta), and carries the
	 * finalized (committed) portion of that transcript.
	 */
	readonly onDidUpdateTranscript: Event<IChatDictationTranscript>;

	/** Whether interim transcript text should be rendered while recording. */
	readonly showTranscriptWhileDictating: boolean;

	/** Analyser for the active microphone capture, used for audio-reactive feedback. */
	readonly analyserNode: AnalyserNode | undefined;

	/** Replace the microphone used by an active recording and return its analyser. */
	switchMicrophone(window: Window & typeof globalThis, deviceId: string): Promise<AnalyserNode | undefined>;

	/**
	 * Whether speech-to-text is available for the current Copilot entitlement,
	 * selected backend, and platform. Callers gate the dictation UI on this.
	 */
	readonly isConfigured: boolean;

	/**
	 * Fires when the model-preparation state changes. `true` while the model is
	 * downloading/loading, `false` once it is ready, errors, or the session
	 * ends. Callers swap the mic affordance for a spinner while preparing.
	 */
	readonly onDidChangePreparingModel: Event<boolean>;
	/** Whether the on-device model is currently downloading/loading. */
	readonly isPreparingModel: boolean;

	/**
	 * Fires when the model-download sub-state changes. `true` while the model is
	 * actively downloading to disk (a confirmed cache miss), `false` while it is
	 * merely loading an already-cached model into memory or once preparation
	 * ends. Callers use this to show a download affordance only during a real
	 * download, and a plain spinner while loading.
	 */
	readonly onDidChangeDownloadingModel: Event<boolean>;
	/** Whether the on-device model is currently downloading to disk (cache miss). */
	readonly isDownloadingModel: boolean;

	/**
	 * Fires whenever the on-device model download progress changes while the
	 * model is being prepared, so callers can update a progress ring.
	 */
	readonly onDidChangeModelDownloadProgress: Event<void>;

	/**
	 * Fractional download progress in `[0, 1]` while the model is downloading,
	 * or `undefined` when the fraction is not yet known (indeterminate), the
	 * download has finished and the model is loading into memory, or no
	 * preparation is in progress.
	 */
	readonly modelDownloadProgress: number | undefined;

	/**
	 * Begin capturing microphone audio in the given window and streaming it to
	 * the on-device transcription model. Rejects if the microphone cannot be
	 * accessed. `surface` identifies the dictation surface for telemetry
	 * (defaults to the chat input).
	 */
	start(window: Window & typeof globalThis, surface?: ChatDictationSurface): Promise<void>;

	/**
	 * Stop capturing, flush the final utterance, and resolve with the complete
	 * cumulative transcript (or `undefined` when nothing was transcribed).
	 */
	stopAndTranscribe(options?: IChatSpeechToTextStopOptions): Promise<string | undefined>;

	/** Abort an in-progress recording without keeping the transcript. */
	cancel(): Promise<void>;

	/** The backend selected for the current/most-recent session (`nemo` or `mai`). */
	readonly currentBackend: string;

	/**
	 * Report how much a finished dictation was edited before it was submitted, as
	 * an accuracy proxy. Computes the edit distance internally and logs only
	 * aggregate metrics; no transcript text is emitted.
	 */
	logDictationAccuracy(measurement: IDictationAccuracyMeasurement): void;
}

export function isDictationActiveOnSurface(service: IChatSpeechToTextService, surface: ChatDictationSurface): boolean {
	return service.currentSurface === surface && service.isBusy;
}