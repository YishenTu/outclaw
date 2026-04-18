import { ConnectionToast } from "./components/connection-toast";
import { RenderErrorBoundary } from "./components/render-error-boundary";
import { WebSocketProvider } from "./contexts/websocket-context";
import { AppLayout } from "./layouts/app-layout";

function App() {
	return (
		<RenderErrorBoundary
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-dark-950 px-6 text-dark-100">
					<div className="max-w-lg rounded-[28px] border border-danger/30 bg-danger/10 px-6 py-5">
						<div className="text-sm font-semibold uppercase tracking-[0.22em] text-danger">
							Browser Render Error
						</div>
						<p className="mt-3 text-sm leading-7 text-danger/90">
							The browser UI crashed during render. Check the dev console for
							the actual exception.
						</p>
					</div>
				</div>
			}
		>
			<WebSocketProvider>
				<AppLayout />
				<ConnectionToast />
			</WebSocketProvider>
		</RenderErrorBoundary>
	);
}

export default App;
