// App IPC registration. Every handler goes through here so the floating panels can only reach the
// channels in PANEL_CHANNELS; settings writes, account changes, MCP setup and deletes stay with
// the main and Settings windows.

import {
  ipcMain as glazeIpcMain,
  type IpcMainHandler,
  type IpcMainHandlerOptions,
  type IpcMainStreamHandlerOptions,
  type StreamingIPCHandler,
} from "@glaze/core/backend";

import { PANEL_CHANNELS } from "./system-panels/panel-channels.js";
import { isPanelInvoke, isPanelStream } from "./system-panels/panel-registry.js";

type Decision = boolean | { allowed: boolean; reason?: string };

export function panelDecision(channel: string, fromPanel: boolean): Decision {
  if (!fromPanel || PANEL_CHANNELS.has(channel)) return true;
  return {
    allowed: false,
    reason: `This DayBoard window can't use ${channel}.`,
  };
}

function isAllowed(decision: Decision): boolean {
  return typeof decision === "boolean" ? decision : decision.allowed;
}

export const ipcMain = {
  handle(channel: string, handler: IpcMainHandler, options: IpcMainHandlerOptions = {}): void {
    const { authorize } = options;
    glazeIpcMain.handle(channel, handler, {
      ...options,
      authorize: (event, ...args) => {
        const fromPanel = isPanelInvoke(event.sender, event.senderFrameURL);
        const decision = panelDecision(channel, fromPanel);
        return isAllowed(decision) && authorize ? authorize(event, ...args) : decision;
      },
    });
  },
  handleStream<TParams = unknown, TChunk = unknown, TResult = unknown>(
    channel: string,
    handler: StreamingIPCHandler<TParams, TChunk, TResult>,
    options: IpcMainStreamHandlerOptions<TParams> = {},
  ): void {
    const { authorize } = options;
    glazeIpcMain.handleStream<TParams, TChunk, TResult>(channel, handler, {
      ...options,
      authorize: (params, context) => {
        const decision = panelDecision(channel, isPanelStream(context.sender));
        return isAllowed(decision) && authorize ? authorize(params, context) : decision;
      },
    });
  },
  broadcast(channel: string, ...args: unknown[]): void {
    glazeIpcMain.broadcast(channel, ...args);
  },
};
