import { defineConfig } from "vite";

// Dev server proxies the WebSocket to the local simantics server so the client can
// talk to it on a stable path regardless of port juggling.
export default defineConfig({
  server: {
    port: 5179,
    proxy: {
      "/colony": { target: "ws://127.0.0.1:4317", ws: true },
    },
  },
});
