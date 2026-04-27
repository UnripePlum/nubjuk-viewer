// 🔒 INTERFACES.md 잠금 — 사용자 명시 승인 없이 시그니처/타입 export 변경 금지.

import type { EspMessage, ViewerCommand } from "@/types/protocol";

export type ConnectionState =
  | { kind: "idle" }
  | { kind: "connecting"; url: string }
  | { kind: "connected"; url: string; sessionStartTs: number }
  | { kind: "reconnecting"; nextAttemptMs: number; lastError?: string }
  | { kind: "disconnected"; reason?: string }
  | {
      kind: "rejected";
      reason: "single_viewer_occupied" | "schema_mismatch" | "manual_trigger_disabled" | string;
    };

export type Subscription = { dispose(): void };

export type ProtocolErrorEvent = {
  kind: "schema" | "parse";
  raw?: string;
  message: string;
};

export interface ViewerConnection {
  connect(url: string): Promise<void>;
  disconnect(): void;
  getState(): ConnectionState;
  send(msg: ViewerCommand): void;
  onMessage(handler: (msg: EspMessage) => void): Subscription;
  onConnectionChange(handler: (state: ConnectionState) => void): Subscription;
  onProtocolError(handler: (err: ProtocolErrorEvent) => void): Subscription;
}
