export function parseFlagValues(args: string[]): Record<string, string> {
	const flags: Record<string, string> = {};
	for (let index = 0; index < args.length; index += 1) {
		const key = args[index];
		if (!key?.startsWith("--")) {
			continue;
		}
		const value = args[index + 1];
		if (value && !value.startsWith("--")) {
			flags[key.slice(2)] = value;
			index += 1;
			continue;
		}
		flags[key.slice(2)] = "";
	}
	return flags;
}
