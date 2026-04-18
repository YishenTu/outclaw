import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	publicDir: path.resolve(__dirname, "../../../assets"),
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "."),
			"@common": path.resolve(__dirname, "../../common"),
		},
	},
	server: {
		port: 3000,
		proxy: {
			"/api": {
				target: "http://localhost:4000",
				changeOrigin: true,
			},
			"/ws": {
				target: "ws://localhost:4000",
				ws: true,
			},
			"/terminal": {
				target: "ws://localhost:4000",
				ws: true,
			},
		},
	},
});
