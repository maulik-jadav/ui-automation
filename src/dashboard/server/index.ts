import "dotenv/config";
import { createApp } from "./app.js";

const PORT = Number(process.env.DASHBOARD_PORT ?? 5000);

const app = createApp();
app.listen(PORT, () => {
  console.log(`Automation Control Dashboard → http://localhost:${PORT}`);
  console.log(`CoreServ target stays on ${process.env.MOCK_APP_BASE_URL ?? "http://localhost:4000"}`);
});
