export const CONFIG_SAVE_RESTART_COMMAND = "/restart";
export const CONFIG_SAVE_RESTART_ERROR =
	"Config saved, but runtime restart could not be requested";

export function requestConfigRestart(
	sendCommand: (command: string) => boolean,
): string | null {
	return sendCommand(CONFIG_SAVE_RESTART_COMMAND)
		? null
		: CONFIG_SAVE_RESTART_ERROR;
}
