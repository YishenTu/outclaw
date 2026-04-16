import figlet from "figlet";
import { Box, Text } from "ink";
import { randomTagline } from "../../../common/taglines.ts";
import { collectStartupInfo } from "./startup-info.ts";
import { theme } from "./theme.ts";

const banner = figlet.textSync("OutCLAW", { font: "ANSI Shadow" }).trimEnd();

const tagline = randomTagline();
const info = collectStartupInfo();

export function HeaderBar() {
	return (
		<Box flexDirection="column">
			<Box flexDirection="column" alignItems="center" paddingX={1}>
				<Text bold color={theme.brand}>
					{banner}
				</Text>
			</Box>
			<Box flexDirection="column" alignItems="center" marginTop={1}>
				<Text bold color={theme.accent} italic>
					~ {tagline.toUpperCase()} ~
				</Text>
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Box>
					<Text dimColor>{"  "}</Text>
					{info.git ? (
						<>
							<Text color="cyan">{info.git.branch}</Text>
							<Text dimColor> · </Text>
							<Text color={info.git.dirty ? "yellow" : "green"}>
								{info.git.summary}
							</Text>
						</>
					) : (
						<Text color="yellow">
							tip: git init ~/.outclaw to track config changes
						</Text>
					)}
					{info.missingFiles.length > 0 ? (
						<>
							<Text dimColor> · </Text>
							<Text color="yellow">
								missing: {info.missingFiles.join(", ")} — run oc start to
								initialize
							</Text>
						</>
					) : (
						<>
							<Text dimColor> · </Text>
							<Text color="green">files ok</Text>
						</>
					)}
				</Box>
				{info.git?.dirty &&
					info.git.files.map((file, i) => (
						<Box key={file}>
							<Text dimColor>
								{"  "}
								{i === (info.git?.files.length ?? 0) - 1
									? "\u2514\u2500\u2500 "
									: "\u251C\u2500\u2500 "}
							</Text>
							<Text color="yellow">{file}</Text>
						</Box>
					))}
			</Box>
		</Box>
	);
}
