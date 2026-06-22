import type { ColonySnapshot, ServerMessage } from "@antics/shared";

export interface NetHandlers {
  onSnapshot: (snap: ColonySnapshot) => void;
  onStatus: (status: "connecting" | "live" | "lost") => void;
}

/** Connects to the local colony WebSocket and auto-reconnects. */
export function connect(handlers: NetHandlers): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/colony`;

  const open = () => {
    handlers.onStatus("connecting");
    const ws = new WebSocket(url);

    ws.onopen = () => handlers.onStatus("live");
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "snapshot") handlers.onSnapshot(msg.data);
    };
    ws.onclose = () => {
      handlers.onStatus("lost");
      setTimeout(open, 1500);
    };
    ws.onerror = () => ws.close();
  };

  open();
}
