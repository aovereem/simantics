import type { ColonySnapshot, ServerMessage } from "@simantics/shared";

export interface NetHandlers {
  onSnapshot: (snap: ColonySnapshot) => void;
  onStatus: (status: "connecting" | "live" | "lost") => void;
  onHello?: (data: { version: string; demo: boolean; scope: string }) => void;
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
      else if (msg.type === "hello") handlers.onHello?.(msg.data);
    };
    ws.onclose = () => {
      handlers.onStatus("lost");
      setTimeout(open, 1500);
    };
    ws.onerror = () => ws.close();
  };

  open();
}
