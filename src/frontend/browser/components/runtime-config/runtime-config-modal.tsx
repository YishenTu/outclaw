import { type ReactNode, useCallback, useEffect, useState } from "react";
import { requestConfigRestart } from "../../commands/config-save-restart.ts";
import { useWs } from "../../contexts/websocket-context.tsx";
import { fetchConfigFile, updateConfigFile } from "../../lib/api.ts";
import { useAgentsStore } from "../../stores/agents.ts";
import {
	applyConfigEntryEdits,
	type ConfigDocument,
	type ConfigEntry,
	parseConfigDocument,
	parseConfigEntries,
} from "../agent-sidebar/config-editor.ts";
import { ConfigModalContent } from "../agent-sidebar/config-panel.tsx";

interface RuntimeConfigModalControls {
	configOpen: boolean;
	onRestart: () => void;
	onToggleConfig: () => void;
}

interface RuntimeConfigModalControllerProps {
	children: (controls: RuntimeConfigModalControls) => ReactNode;
}

export function RuntimeConfigModalController({
	children,
}: RuntimeConfigModalControllerProps) {
	const { sendCommand } = useWs();
	const agents = useAgentsStore((state) => state.agents);
	const [configOpen, setConfigOpen] = useState(false);
	const [configLoading, setConfigLoading] = useState(false);
	const [configSaving, setConfigSaving] = useState(false);
	const [configError, setConfigError] = useState<string | null>(null);
	const [configErrorMode, setConfigErrorMode] = useState<"load" | "save">(
		"load",
	);
	const [configDocument, setConfigDocument] = useState<ConfigDocument | null>(
		null,
	);
	const [configEntries, setConfigEntries] = useState<ConfigEntry[]>([]);

	useEffect(() => {
		if (!configOpen) {
			return;
		}

		let cancelled = false;
		setConfigLoading(true);
		setConfigError(null);
		setConfigErrorMode("load");

		void fetchConfigFile()
			.then((configFile) => {
				if (configFile.kind !== "text" || configFile.content === undefined) {
					throw new Error("Config file is not readable text");
				}
				const document = parseConfigDocument(configFile.content);
				const agentNamesById = Object.fromEntries(
					agents.map((agent) => [agent.agentId, agent.name] as const),
				);
				const parsed = parseConfigEntries(document, {
					agentNamesById,
					schema: configFile.schema,
				});
				if (!cancelled) {
					setConfigDocument(document);
					setConfigEntries(parsed);
					setConfigError(null);
					setConfigErrorMode("load");
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setConfigDocument(null);
					setConfigEntries([]);
					setConfigErrorMode("load");
					setConfigError(
						error instanceof Error ? error.message : "Failed to load config",
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setConfigLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [agents, configOpen]);

	const handleConfigEntryChange = useCallback((item: string, value: string) => {
		setConfigEntries((current) =>
			current.map((entry) =>
				entry.item === item ? { ...entry, value } : entry,
			),
		);
	}, []);

	const handleConfigSave = useCallback(() => {
		if (!configDocument) {
			setConfigErrorMode("save");
			setConfigError("Config is not loaded");
			return;
		}

		let nextDocument: ConfigDocument;
		try {
			nextDocument = applyConfigEntryEdits(configDocument, configEntries);
		} catch (error) {
			setConfigErrorMode("save");
			setConfigError(
				error instanceof Error ? error.message : "Failed to update config",
			);
			return;
		}

		setConfigSaving(true);
		setConfigError(null);
		setConfigErrorMode("save");
		void updateConfigFile(nextDocument)
			.then((configFile) => {
				if (configFile.kind !== "text" || configFile.content === undefined) {
					throw new Error("Config file is not readable text");
				}
				const document = parseConfigDocument(configFile.content);
				const agentNamesById = Object.fromEntries(
					agents.map((agent) => [agent.agentId, agent.name] as const),
				);
				setConfigDocument(document);
				setConfigEntries(
					parseConfigEntries(document, {
						agentNamesById,
						schema: configFile.schema,
					}),
				);
				const restartError = requestConfigRestart(sendCommand);
				if (restartError) {
					setConfigErrorMode("save");
					setConfigError(restartError);
					return;
				}

				setConfigOpen(false);
				setConfigError(null);
				setConfigErrorMode("load");
			})
			.catch((error) => {
				setConfigErrorMode("save");
				setConfigError(
					error instanceof Error ? error.message : "Failed to save config",
				);
			})
			.finally(() => {
				setConfigSaving(false);
			});
	}, [agents, configDocument, configEntries, sendCommand]);

	const handleRestart = useCallback(() => {
		sendCommand("/restart");
	}, [sendCommand]);

	const handleToggleConfig = useCallback(() => {
		setConfigOpen((current) => !current);
	}, []);

	return (
		<>
			{configOpen ? (
				<ConfigModalContent
					entries={configEntries}
					error={configError}
					errorMode={configErrorMode}
					isLoading={configLoading}
					isSaving={configSaving}
					onClose={() => setConfigOpen(false)}
					onEntryChange={handleConfigEntryChange}
					onSave={handleConfigSave}
				/>
			) : null}
			{children({
				configOpen,
				onRestart: handleRestart,
				onToggleConfig: handleToggleConfig,
			})}
		</>
	);
}
