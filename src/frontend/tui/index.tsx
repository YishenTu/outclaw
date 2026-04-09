import { render } from "ink";
import { TuiApp } from "./app.tsx";

export function startTui(url: string) {
	return render(<TuiApp url={url} />);
}
