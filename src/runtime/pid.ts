import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export class PidManager {
	constructor(private path: string) {}

	write(pid: number) {
		writeFileSync(this.path, String(pid));
	}

	read(): number | undefined {
		if (!existsSync(this.path)) return undefined;
		const content = readFileSync(this.path, "utf-8").trim();
		const pid = Number(content);
		return Number.isNaN(pid) ? undefined : pid;
	}

	remove() {
		if (existsSync(this.path)) {
			unlinkSync(this.path);
		}
	}

	isRunning(): boolean {
		const pid = this.read();
		if (!pid) return false;
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}
}
