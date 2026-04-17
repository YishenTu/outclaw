export class VoiceToolError extends Error {
	constructor(message, exitCode = 1) {
		super(message);
		this.name = "VoiceToolError";
		this.exitCode = exitCode;
	}
}

export function exitCodeForError(error) {
	if (error instanceof VoiceToolError) {
		return error.exitCode;
	}
	return 1;
}

export function messageForError(error) {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
