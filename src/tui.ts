import { startTui } from "./frontend/tui.tsx";

const PORT = Number(process.env.PORT ?? 4000);
const url = `ws://localhost:${PORT}`;

startTui(url);
