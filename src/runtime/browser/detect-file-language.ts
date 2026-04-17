import { basename, extname } from "node:path";

export function detectFileLanguage(path: string): string | undefined {
	switch (basename(path)) {
		case "Dockerfile":
			return "dockerfile";
		case "Makefile":
			return "makefile";
	}

	switch (extname(path).toLowerCase()) {
		case ".md":
			return "markdown";
		case ".ts":
		case ".mts":
		case ".cts":
			return "typescript";
		case ".tsx":
			return "tsx";
		case ".js":
		case ".mjs":
		case ".cjs":
			return "javascript";
		case ".jsx":
			return "jsx";
		case ".json":
			return "json";
		case ".yml":
		case ".yaml":
			return "yaml";
		case ".toml":
			return "toml";
		case ".ini":
		case ".cfg":
		case ".conf":
			return "ini";
		case ".py":
			return "python";
		case ".rs":
			return "rust";
		case ".go":
			return "go";
		case ".java":
			return "java";
		case ".kt":
		case ".kts":
			return "kotlin";
		case ".swift":
			return "swift";
		case ".rb":
			return "ruby";
		case ".php":
			return "php";
		case ".lua":
			return "lua";
		case ".sh":
		case ".bash":
		case ".zsh":
			return "bash";
		case ".ps1":
			return "powershell";
		case ".css":
			return "css";
		case ".scss":
			return "scss";
		case ".html":
		case ".xml":
		case ".svg":
			return "xml";
		case ".sql":
			return "sql";
		case ".c":
		case ".h":
			return "c";
		case ".cc":
		case ".cpp":
		case ".cxx":
		case ".hh":
		case ".hpp":
		case ".hxx":
			return "cpp";
		default:
			return undefined;
	}
}
