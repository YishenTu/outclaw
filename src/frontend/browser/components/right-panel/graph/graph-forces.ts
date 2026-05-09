export interface GraphForces {
	center: number;
	repel: number;
	linkStrength: number;
	linkDistance: number;
}

export const DEFAULT_FORCES: GraphForces = {
	center: 0.06,
	repel: 160,
	linkStrength: 0.5,
	linkDistance: 40,
};

export interface ForceSliderSpec {
	key: keyof GraphForces;
	label: string;
	min: number;
	max: number;
	step: number;
}

export const FORCE_SLIDERS: readonly ForceSliderSpec[] = [
	{ key: "center", label: "Center force", min: 0, max: 0.3, step: 0.005 },
	{ key: "repel", label: "Repel force", min: 30, max: 400, step: 5 },
	{ key: "linkStrength", label: "Link force", min: 0, max: 1, step: 0.02 },
	{ key: "linkDistance", label: "Link distance", min: 10, max: 150, step: 1 },
];

const FORCES_STORAGE_KEY = "outclaw.graph.forces";

export function loadStoredForces(): GraphForces {
	if (typeof window === "undefined") {
		return DEFAULT_FORCES;
	}
	try {
		const raw = window.localStorage.getItem(FORCES_STORAGE_KEY);
		if (!raw) {
			return DEFAULT_FORCES;
		}
		const parsed = JSON.parse(raw) as Partial<GraphForces>;
		return {
			center: clampNumber(parsed.center, 0, 0.3, DEFAULT_FORCES.center),
			repel: clampNumber(parsed.repel, 30, 400, DEFAULT_FORCES.repel),
			linkStrength: clampNumber(
				parsed.linkStrength,
				0,
				1,
				DEFAULT_FORCES.linkStrength,
			),
			linkDistance: clampNumber(
				parsed.linkDistance,
				10,
				150,
				DEFAULT_FORCES.linkDistance,
			),
		};
	} catch {
		return DEFAULT_FORCES;
	}
}

export function saveStoredForces(forces: GraphForces): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(FORCES_STORAGE_KEY, JSON.stringify(forces));
	} catch {
		// ignore quota / private mode failures
	}
}

function clampNumber(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, value));
}
