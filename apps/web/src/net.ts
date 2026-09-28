// WebSocket link to the sim server. Sends typed commands; every state change comes back
// from the server (no optimistic updates).

import type { ClientCommand, ServerMessage } from "@vch/shared-types";
import { applyMessage, useView } from "./store";

let socket: WebSocket | null = null;
let retryMs = 500;

export function connect(): void {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  useView.setState({ status: "connecting" });
  socket = new WebSocket(url);
  socket.onopen = () => {
    retryMs = 500;
    useView.setState({ status: "open" });
  };
  socket.onmessage = (event) => applyMessage(JSON.parse(event.data as string) as ServerMessage);
  socket.onclose = () => {
    useView.setState({ status: "closed" });
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 5000);
  };
}

export function send(command: ClientCommand): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
}
