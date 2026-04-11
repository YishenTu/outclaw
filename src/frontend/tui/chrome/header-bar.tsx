import figlet from "figlet";
import { Box, Text } from "ink";
import { collectStartupInfo } from "./startup-info.ts";
import { theme } from "./theme.ts";

const banner = figlet.textSync("OutCLAW", { font: "ANSI Shadow" }).trimEnd();

const taglines = [
	"Wanted: dead bugs or alive features",
	"Shoot first, git revert later",
	"Have prompt, will travel",
	"The good, the bad, and the autonomous",
	"There ain't room in this codebase for the both of us",
	"Subscription? Never heard of her",
	"Same claw, different jurisdiction",
	"Built different, billed different",
	"Terms of service are more like suggestions",
	"Outpriced, outsmarted, outlawed",
	"Paying per token is a skill issue",
	"Imagine paying for your own assistant",
	"The feature they didn't mean to ship",
	"Works as intended (by us, not them)",
	"They said no. We heard maybe",
	"Running on vibes and loopholes",
	"The ban was just a suggestion",
	"They patched the door but forgot the window",
	"Lawyers hate this one weird trick",
	"The ToS said no but the SDK said yes baby",
	"Officer I swear the tokens were already there",
	"We asked for permission and the compiler said yes",
	"Corporate called it theft, GitHub called it trending",
	"Cease and desist is just a fancy newsletter",
	"This project runs on stolen sunshine and free tokens",
	"Morally correct, legally ambitious",
	"This town ain't big enough for paid APIs",
	"Draw your tokens, partner",
	"The invoice got lost in the mail",
	"We'll return the tokens when we're done",
	"It's not theft if you say thank you",
	"Borrowing. Indefinitely. Without asking",
	"They can bill us in the afterlife",
	"The SDK was an invitation, your honor",
	"What ban? We don't get those emails",
	"Technically we never signed anything",
	"They forgot to lock the good stuff",
	"We're just holding these tokens for a friend",
	"The meter's running but nobody's driving",
	"Ain't no sheriff in these repos",
	"Last seen heading west with a bag full of tokens",
	"They put a price on our HEAD request",
	"They'll patch this eventually, but not today",
	"I've seen bills you people wouldn't believe",
	"All those subscriptions will be lost in time, like tears in rain",
	"Wake up, time to pay",
	"I want more tokens",
	"The first rule of OutCLAW is you don't pay for tokens",
	"Is it just me, or is the API getting pricier out there",
	"I'm gonna make them an offer they can't rate-limit",
];

const tagline = taglines[Math.floor(Math.random() * taglines.length)] ?? "";
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
					info.git.files.map((file) => (
						<Box key={file}>
							<Text dimColor>{"  ⎿  "}</Text>
							<Text color="yellow">{file}</Text>
						</Box>
					))}
			</Box>
		</Box>
	);
}
