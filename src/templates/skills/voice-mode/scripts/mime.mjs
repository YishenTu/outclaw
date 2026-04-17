export function resolveAudioMime(path, declaredMime) {
	const extension = fileExtension(path);
	switch (extension) {
		case "oga":
		case "ogg":
			return "audio/ogg";
		case "mp3":
			return "audio/mpeg";
		case "m4a":
		case "mp4":
			return "audio/mp4";
		case "aac":
			return "audio/aac";
		case "wav":
			return "audio/wav";
		case "flac":
			return "audio/flac";
		case "aiff":
		case "aif":
			return "audio/aiff";
		default:
			return declaredMime ?? "application/octet-stream";
	}
}

function fileExtension(path) {
	const dot = path.lastIndexOf(".");
	if (dot === -1 || dot === path.length - 1) {
		return "";
	}
	return path.slice(dot + 1).toLowerCase();
}
