/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IAgentHostService } from '../common/agentService.js';
import { NullAgentHostService } from '../browser/nullAgentHostService.js';

registerSingleton(IAgentHostService, NullAgentHostService, InstantiationType.Delayed);
