// WebSocket link to the sim server. Sends typed commands; every state change comes back
// from the server (no optimistic updates). The server's address comes from VITE_SIM_URL at build
// time (the public server, docs/13); without it, the page's own host (the dev proxy).

import type { ClientCommand, ServerMessage } from "@vch/shared-types";
import { applyMessage, useView } from "./store";

/** The admin token for this tab only (the admin page sets it); never in the bundle or on disk. */
const TOKEN_KEY = "vch-admin-token";

let socket: WebSocket | null = null;
let retryMs = 500;

export function serverUrl(configured: string | undefined = import.meta.env.VITE_SIM_URL as string | undefined): string {
  if (configured) return configured;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

export function connect(): void {
  useView.setState({ status: "connecting" });
  socket = new WebSocket(serverUrl());
  socket.onopen = () => {
    retryMs = 500;
    useView.setState({ status: "open" });
    const token = savedToken();
    if (token) send({ type: "auth", token }); // back in as admin after a reconnect
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data as string) as ServerMessage;
    if (message.type === "auth" && !message.ok) forgetToken(); // don't resend a wrong token on reconnect
    applyMessage(message);
  };
  socket.onclose = () => {
    useView.setState({ status: "closed" });
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 5000);
  };
}

export function send(command: ClientCommand): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
}

/** Sends the admin token and keeps it for this tab, so a reconnect signs in again. */
export function signIn(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode or storage blocked: this connection still signs in.
  }
  send({ type: "auth", token });
}

/** Forgets the token and reconnects as a viewer. */
export function signOut(): void {
  forgetToken();
  socket?.close();
}

function forgetToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored.
  }
}

function savedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
