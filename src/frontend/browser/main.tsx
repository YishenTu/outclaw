import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
	throw new Error("Missing #root element for browser frontend");
}

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
