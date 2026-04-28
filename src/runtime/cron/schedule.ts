export type CronSchedule =
	| {
			kind: "recurring";
			expression: string;
			timezone?: string;
	  }
	| {
			kind: "once";
			runAt: string;
	  };

const ISO_RUN_AT_WITH_OFFSET =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateRunAt(value: unknown): string {
	if (
		typeof value !== "string" ||
		!ISO_RUN_AT_WITH_OFFSET.test(value.trim()) ||
		Number.isNaN(Date.parse(value))
	) {
		throw new Error(
			"runAt must be an ISO 8601 datetime with explicit Z or offset",
		);
	}

	return value.trim();
}

export function resolveJobSchedule(config: {
	schedule?: string;
	runAt?: string;
	timezone?: string;
}): CronSchedule {
	if (config.runAt !== undefined) {
		return {
			kind: "once",
			runAt: config.runAt,
		};
	}

	if (config.schedule === undefined) {
		throw new Error("Missing required field: schedule or runAt");
	}

	return {
		kind: "recurring",
		expression: config.schedule,
		timezone: config.timezone,
	};
}

export function isRunAtExpired(runAt: string, nowMs = Date.now()): boolean {
	return Date.parse(runAt) <= nowMs;
}
