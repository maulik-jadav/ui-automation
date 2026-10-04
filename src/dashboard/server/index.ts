import "dotenv/config";
import { createApp } from "./app.js";

const preferred = Number(process.env.DASHBOARD_PORT ?? 5000);

function listen(port: number): void {
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`Automation Control Dashboard → http://localhost:${port}`);
    console.log(
      `CoreServ target stays on ${process.env.MOCK_APP_BASE_URL ?? "http://localhost:4000"}`
    );
    if (port !== preferred) {
      console.log(
        `(Port ${preferred} was busy — often macOS AirPlay Receiver. Set DASHBOARD_PORT=${port} in .env to pin it.)`
      );
    }
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && port === preferred && !process.env.DASHBOARD_PORT) {
      console.warn(`Port ${port} in use; trying 5050…`);
      listen(5050);
      return;
    }
    console.error(err);
    process.exit(1);
  });
}

listen(preferred);
