/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ForkConversationAction } from './actions/chatForkActions.js';
import { ContinueChatInCopilotAction } from './actions/chatContinueInAction.js';
import { IChatResponseFileChangesService } from './chatResponseFileChangesService.js';
import { EditorChatResponseFileChangesService } from './editorChatResponseFileChangesService.js';
import { IAgentHostPolicyContinuationPresenter } from './agentSessions/agentHost/agentHostPolicyContinuation.js';
import { EditorAgentHostPolicyContinuationPresenter } from './agentSessions/agentHost/agentHostPolicyContinuationEditor.js';

registerAction2(ForkConversationAction);
registerAction2(ContinueChatInCopilotAction);
// `ExportAgentHostDebugLogsAction` 不注册：它在 run 里 `accessor.get(IAgentHostDebugLogsExportService)`，
// 而该服务的 desktop 实现（原 `electron-browser/actions/exportAgentHostDebugLogsService.ts`）随 T11-04
// 一并删除，桌面端已无 provider（R31 实测 `registerSingleton` 命中共 1 处，仅在 `workbench.web.main.ts`）。
// 注册着只会让命令面板出现一个一执行就抛 UNKNOWN service 的命令；AgentHost 后端已不存在，该命令无意义。
registerSingleton(IChatResponseFileChangesService, EditorChatResponseFileChangesService, InstantiationType.Delayed);
registerSingleton(IAgentHostPolicyContinuationPresenter, EditorAgentHostPolicyContinuationPresenter, InstantiationType.Delayed);
