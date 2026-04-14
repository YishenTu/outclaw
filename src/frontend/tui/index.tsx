import { render } from "ink";
import { TuiApp } from "./app.tsx";

export function startTui(url: string, options: { agentName?: string } = {}) {
	return render(<TuiApp url={url} agentName={options.agentName} />);
}
