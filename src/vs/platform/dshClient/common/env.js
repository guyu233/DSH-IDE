// src/vs/platform/dshClient/common/env.js
// 注入到 DSH-IDE（VS Code）进程的环境变量名（v2 官方传输）。Host 与文档共用，避免拼写漂移。
//
// 取代 v1 的 DSH_IDE_PIPE/DSH_IDE_NONCE：v2 不再有私有管道，改为官方端点+launch token。
export const DSH_IDE_ENDPOINT_ENV = 'DSH_IDE_ENDPOINT';   // Host Web origin，如 http://127.0.0.1:56188
export const DSH_IDE_INTERACTIONS_ENV = 'DSH_IDE_INTERACTIONS'; // 'none' | 'answer'
export const DSH_IDE_COOKIE_ENV = 'DSH_IDE_COOKIE';       // 已换取的 host cookie（name=value）
export const DSH_IDE_LAUNCH_URL_ENV = 'DSH_IDE_LAUNCH_URL'; // 官方 launch URL（origin/?token=…）
export const DSH_IDE_SESSION_ENV = 'DSH_IDE_SESSION';     // 本窗口要跟随的 DSH 会话 id（由开窗方决定）
