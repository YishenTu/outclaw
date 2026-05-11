import type { BrowserCodingFolderPickerResponse } from "../../../common/protocol.ts";

export type FolderPicker = () => Promise<BrowserCodingFolderPickerResponse>;

interface FolderPickerSpawnResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

type SpawnFolderPicker = (
	command: string[],
) => Promise<FolderPickerSpawnResult>;

const defaultSpawn: SpawnFolderPicker = async (command) => {
	const proc = Bun.spawn(command, {
		stderr: "pipe",
		stdout: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { exitCode, stdout, stderr };
};

interface NativeDialog {
	command: string[];
	cancelExitCodes: ReadonlySet<number>;
}

function selectNativeDialog(
	platform: NodeJS.Platform,
): NativeDialog | undefined {
	if (platform === "darwin") {
		return {
			command: [
				"osascript",
				"-e",
				'POSIX path of (choose folder with prompt "Pick a repository folder")',
			],
			cancelExitCodes: new Set([1]),
		};
	}
	if (platform === "linux") {
		return {
			command: ["zenity", "--file-selection", "--directory"],
			cancelExitCodes: new Set([1]),
		};
	}
	if (platform === "win32") {
		return {
			command: [
				"powershell",
				"-NoProfile",
				"-Command",
				[
					"Add-Type -AssemblyName System.Windows.Forms;",
					"$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
					"if ($dialog.ShowDialog() -eq 'OK') { Write-Output $dialog.SelectedPath } else { exit 1 }",
				].join(" "),
			],
			cancelExitCodes: new Set([1]),
		};
	}
	return undefined;
}

export function createNativeFolderPicker(options?: {
	platform?: NodeJS.Platform;
	spawn?: SpawnFolderPicker;
}): FolderPicker {
	const platform = options?.platform ?? process.platform;
	const spawn = options?.spawn ?? defaultSpawn;
	const dialog = selectNativeDialog(platform);

	return async () => {
		if (!dialog) {
			return {
				status: "unavailable",
				message: `No native folder picker available for platform ${platform}`,
			};
		}
		let result: FolderPickerSpawnResult;
		try {
			result = await spawn(dialog.command);
		} catch (error) {
			return {
				status: "unavailable",
				message:
					error instanceof Error
						? error.message
						: `Failed to launch ${dialog.command[0]}`,
			};
		}
		if (result.exitCode === 0) {
			const path = result.stdout.replace(/\r?\n$/, "").trimEnd();
			if (path === "") {
				return { status: "canceled" };
			}
			return { status: "selected", path };
		}
		if (
			result.exitCode !== null &&
			dialog.cancelExitCodes.has(result.exitCode)
		) {
			return { status: "canceled" };
		}
		const message =
			result.stderr.trim() ||
			`Folder picker exited with code ${result.exitCode ?? "unknown"}`;
		return { status: "unavailable", message };
	};
}
