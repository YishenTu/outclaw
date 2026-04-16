import { Component, type ReactNode } from "react";

interface Props {
	fallback?: ReactNode;
	children: ReactNode;
}

interface State {
	hasError: boolean;
}

export class RenderErrorBoundary extends Component<Props, State> {
	override state: State = {
		hasError: false,
	};

	static getDerivedStateFromError(_error: unknown): State {
		return { hasError: true };
	}

	override componentDidCatch(error: unknown) {
		console.error("Browser render error", error);
	}

	override render() {
		if (this.state.hasError) {
			return this.props.fallback ?? null;
		}
		return this.props.children;
	}
}
