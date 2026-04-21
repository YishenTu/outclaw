import { Box, Text, useApp, useInput } from "ink";
import React, { useMemo, useState } from "react";
import {
	ActiveSelect,
	ActiveText,
	Answered,
	CommandsPanel,
	type OnboardingChoice,
	Spacer,
} from "./chrome.tsx";
import {
	type AgentOnboardingChoice,
	type AgentOnboardingDraft,
	type AgentOnboardingMode,
	type AgentOnboardingStep,
	type AgentOnboardingSubmission,
	buildAgentOnboardingSubmission,
	createAgentOnboardingDraft,
	parseAllowedUsers,
	resolveAgentOnboardingSteps,
	validateAgentOnboardingName,
	validateAllowedUsers,
	validateTelegramToken,
} from "./state.ts";

const MODE_CHOICES: OnboardingChoice<AgentOnboardingMode>[] = [
	{
		label: "Quick",
		note: "agent only, minimal setup",
		value: "quick",
	},
	{
		label: "Agent + Telegram",
		note: "set up the agent and Telegram",
		value: "full",
	},
];

const SECURE_CHOICES: OnboardingChoice<AgentOnboardingChoice>[] = [
	{
		label: "Yes",
		note: "move hardcoded Telegram config into .env",
		value: "yes",
	},
	{
		label: "No",
		note: "leave Telegram config in config.json",
		value: "no",
	},
];

const LAN_CHOICES: OnboardingChoice<AgentOnboardingChoice>[] = [
	{
		label: "No",
		note: "this machine only",
		value: "no",
	},
	{
		label: "Yes",
		note: "enable LAN access",
		value: "yes",
	},
];

const CONFIRM_CHOICES: OnboardingChoice<"apply" | "edit">[] = [
	{ label: "Apply and restart", value: "apply" },
	{ label: "Back and edit", value: "edit" },
];

function maskTelegramToken(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length <= 10) {
		return trimmed;
	}

	return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

function renderAnsweredStep(
	draft: AgentOnboardingDraft,
	step: AgentOnboardingStep,
) {
	switch (step) {
		case "mode":
			return (
				<Answered
					question="Onboarding mode"
					answer={draft.mode === "quick" ? "Quick" : "Agent + Telegram"}
				/>
			);
		case "name":
			return <Answered question="Agent name" answer={draft.name.trim()} />;
		case "token":
			return (
				<Answered
					question="Telegram bot token"
					answer={maskTelegramToken(draft.botToken)}
				/>
			);
		case "users": {
			const ids = parseAllowedUsers(draft.allowedUsers);
			return (
				<Answered
					question="Allowed Telegram users"
					answer={ids.length > 0 ? ids.join(", ") : "(none)"}
				/>
			);
		}
		case "secure":
			return (
				<Answered
					question="Move Telegram config into .env for all agents?"
					answer={draft.secureTelegramConfig === "yes" ? "Yes" : "No"}
				/>
			);
		case "lan":
			return (
				<Answered
					question="Browser access mode"
					answer={draft.enableLan === "yes" ? "Yes" : "No"}
				/>
			);
		case "confirm":
			return <Answered question="Review" answer="Apply and restart" />;
	}
}

function renderActiveStep(
	activeStep: AgentOnboardingStep,
	draft: AgentOnboardingDraft,
	error: string | undefined,
	selectCursor: number,
) {
	switch (activeStep) {
		case "mode":
			return (
				<ActiveSelect
					question="Onboarding mode"
					choices={MODE_CHOICES}
					cursor={selectCursor}
				/>
			);
		case "name":
			return (
				<ActiveText
					question="Agent name"
					value={draft.name}
					placeholder="e.g. railly"
					error={error}
					hint="lowercase letters, digits, and single hyphens only"
				/>
			);
		case "token":
			return (
				<ActiveText
					question="Telegram bot token"
					value={draft.botToken}
					placeholder="123456:AA..."
					error={error}
					hint="from @BotFather on Telegram"
				/>
			);
		case "users":
			return (
				<ActiveText
					question="Allowed Telegram users (optional)"
					value={draft.allowedUsers}
					placeholder="12345, 67890"
					error={error}
					hint="comma-separated user IDs, leave empty for none"
				/>
			);
		case "secure":
			return (
				<ActiveSelect
					question="Move Telegram config into .env for all agents?"
					choices={SECURE_CHOICES}
					cursor={selectCursor}
				/>
			);
		case "lan":
			return (
				<ActiveSelect
					question="Browser access mode"
					choices={LAN_CHOICES}
					cursor={selectCursor}
				/>
			);
		case "confirm":
			return (
				<ActiveSelect
					question="Apply and restart?"
					choices={CONFIRM_CHOICES}
					cursor={selectCursor}
				/>
			);
	}
}

export function AgentOnboardingApp({
	existingCount = 0,
	onCancel,
	onSubmit,
}: {
	existingCount?: number;
	onCancel?: () => void;
	onSubmit: (submission: AgentOnboardingSubmission) => void;
}) {
	const { exit } = useApp();
	const [draft, setDraft] = useState(() => createAgentOnboardingDraft());
	const [activeStep, setActiveStep] = useState<AgentOnboardingStep>("mode");
	const [selectCursor, setSelectCursor] = useState(0);
	const [showValidation, setShowValidation] = useState(false);
	const stepOrder = useMemo(() => resolveAgentOnboardingSteps(draft), [draft]);
	const stepIndex = stepOrder.indexOf(activeStep);
	const validationError =
		activeStep === "name"
			? validateAgentOnboardingName(draft.name)
			: activeStep === "token"
				? validateTelegramToken(draft.botToken)
				: activeStep === "users"
					? validateAllowedUsers(draft.allowedUsers)
					: undefined;
	const currentError = showValidation ? validationError : undefined;

	function goPrev() {
		setShowValidation(false);
		setSelectCursor(0);
		const previousStep = stepIndex > 0 ? stepOrder[stepIndex - 1] : undefined;
		if (previousStep) {
			setActiveStep(previousStep);
		}
	}

	function goNext(nextDraft: AgentOnboardingDraft) {
		setShowValidation(false);
		setSelectCursor(0);
		const nextSteps = resolveAgentOnboardingSteps(nextDraft);
		const currentIndex = nextSteps.indexOf(activeStep);
		const nextStep =
			currentIndex >= 0 && currentIndex < nextSteps.length - 1
				? nextSteps[currentIndex + 1]
				: undefined;
		if (nextStep) {
			setActiveStep(nextStep);
		}
	}

	useInput((input, key) => {
		if (key.ctrl && input === "c") {
			onCancel?.();
			exit();
			return;
		}

		if (key.escape) {
			goPrev();
			return;
		}

		if (activeStep === "mode") {
			if (key.upArrow) {
				setSelectCursor(
					(cursor) => (cursor - 1 + MODE_CHOICES.length) % MODE_CHOICES.length,
				);
				return;
			}
			if (key.downArrow) {
				setSelectCursor((cursor) => (cursor + 1) % MODE_CHOICES.length);
				return;
			}
			if (key.return) {
				const nextDraft = {
					...draft,
					mode: MODE_CHOICES[selectCursor]?.value,
				};
				setDraft(nextDraft);
				goNext(nextDraft);
			}
			return;
		}

		if (activeStep === "secure") {
			if (key.upArrow) {
				setSelectCursor(
					(cursor) =>
						(cursor - 1 + SECURE_CHOICES.length) % SECURE_CHOICES.length,
				);
				return;
			}
			if (key.downArrow) {
				setSelectCursor((cursor) => (cursor + 1) % SECURE_CHOICES.length);
				return;
			}
			if (key.return) {
				const nextDraft = {
					...draft,
					secureTelegramConfig: SECURE_CHOICES[selectCursor]?.value,
				};
				setDraft(nextDraft);
				goNext(nextDraft);
			}
			return;
		}

		if (activeStep === "lan") {
			if (key.upArrow) {
				setSelectCursor(
					(cursor) => (cursor - 1 + LAN_CHOICES.length) % LAN_CHOICES.length,
				);
				return;
			}
			if (key.downArrow) {
				setSelectCursor((cursor) => (cursor + 1) % LAN_CHOICES.length);
				return;
			}
			if (key.return) {
				const nextDraft = {
					...draft,
					enableLan: LAN_CHOICES[selectCursor]?.value,
				};
				setDraft(nextDraft);
				goNext(nextDraft);
			}
			return;
		}

		if (activeStep === "confirm") {
			if (key.upArrow) {
				setSelectCursor(
					(cursor) =>
						(cursor - 1 + CONFIRM_CHOICES.length) % CONFIRM_CHOICES.length,
				);
				return;
			}
			if (key.downArrow) {
				setSelectCursor((cursor) => (cursor + 1) % CONFIRM_CHOICES.length);
				return;
			}
			if (key.return) {
				if (CONFIRM_CHOICES[selectCursor]?.value === "edit") {
					setActiveStep("mode");
					setSelectCursor(0);
					return;
				}
				onSubmit(buildAgentOnboardingSubmission(draft));
				exit();
			}
			return;
		}

		const fieldKey =
			activeStep === "name"
				? "name"
				: activeStep === "token"
					? "botToken"
					: activeStep === "users"
						? "allowedUsers"
						: undefined;
		if (!fieldKey) {
			return;
		}

		if (key.return) {
			if (validationError) {
				setShowValidation(true);
				return;
			}
			goNext(draft);
			return;
		}

		if (key.backspace || key.delete) {
			setDraft((current) => ({
				...current,
				[fieldKey]: current[fieldKey].slice(0, -1),
			}));
			return;
		}

		if (!input || key.ctrl || key.meta) {
			return;
		}
		if (input.length === 1 && input.charCodeAt(0) < 32) {
			return;
		}

		setDraft((current) => ({
			...current,
			[fieldKey]: current[fieldKey] + input,
		}));
		setShowValidation(false);
	});

	return (
		<Box flexDirection="column" paddingX={1} paddingY={1}>
			<CommandsPanel />

			{stepOrder.slice(0, stepIndex).map((step, index) => (
				<React.Fragment key={step}>
					{index > 0 ? <Spacer /> : null}
					{renderAnsweredStep(draft, step)}
				</React.Fragment>
			))}
			{stepIndex > 0 ? <Spacer /> : null}
			{renderActiveStep(activeStep, draft, currentError, selectCursor)}

			<Box marginTop={1}>
				<Text dimColor>
					{existingCount > 0
						? `you have ${existingCount} agent${existingCount === 1 ? "" : "s"} · Ctrl+C to quit`
						: "Ctrl+C to quit"}
				</Text>
			</Box>
		</Box>
	);
}
