import { homedir } from "node:os";
import { join } from "node:path";

export interface OutclawLayoutOptions {
	homeDir?: string;
	srcRoot?: string;
	userHomeDir?: string;
}

export interface AgentLayout {
	homeDir: string;
	promptHomeDir: string;
	cronDir: string;
	claudeSkillsPath: string;
}

export interface OutclawLayout {
	homeDir: string;
	agentsDir: string;
	configPath: string;
	envPath: string;
	pidPath: string;
	logPath: string;
	readyPath: string;
	dbPath: string;
	filesRoot: string;
	cliEntry: string;
	daemonEntry: string;
	tuiEntry: string;
	templatesDir: string;
	browserDir: string;
	browserDistDir: string;
	agent(name: string): AgentLayout;
}

export function outclawHomeDir(userHomeDir = homedir()): string {
	return join(userHomeDir, ".outclaw");
}

export function createOutclawLayout(
	options: OutclawLayoutOptions = {},
): OutclawLayout {
	const homeDir = options.homeDir ?? outclawHomeDir(options.userHomeDir);
	const srcRoot = options.srcRoot ?? join(import.meta.dir, "..");
	const agentsDir = join(homeDir, "agents");
	const browserDir = join(srcRoot, "frontend", "browser");

	return {
		homeDir,
		agentsDir,
		configPath: join(homeDir, "config.json"),
		envPath: join(homeDir, ".env"),
		pidPath: join(homeDir, "daemon.pid"),
		logPath: join(homeDir, "daemon.log"),
		readyPath: join(homeDir, "daemon.ready"),
		dbPath: join(homeDir, "db.sqlite"),
		filesRoot: join(homeDir, "files"),
		cliEntry: join(srcRoot, "cli.ts"),
		daemonEntry: join(srcRoot, "index.ts"),
		tuiEntry: join(srcRoot, "tui.ts"),
		templatesDir: join(srcRoot, "templates"),
		browserDir,
		browserDistDir: join(browserDir, "dist"),
		agent(name: string) {
			const agentHomeDir = join(agentsDir, name);
			return {
				homeDir: agentHomeDir,
				promptHomeDir: agentHomeDir,
				cronDir: join(agentHomeDir, "cron"),
				claudeSkillsPath: join(agentHomeDir, ".claude", "skills"),
			};
		},
	};
}
