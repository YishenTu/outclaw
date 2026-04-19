import { Settings2, X } from "lucide-react";
import type { ReactNode } from "react";
import type { ConfigEntry, ConfigValueKind } from "./config-editor.ts";
import { buildConfigEntryTree, type ConfigTreeNode } from "./config-tree.ts";

interface ConfigModalContentProps {
	entries: ConfigEntry[];
	error: string | null;
	errorMode?: "load" | "save";
	isLoading: boolean;
	isSaving: boolean;
	onClose: () => void;
	onEntryChange: (item: string, value: string) => void;
	onSave: () => void;
}

const KIND_BADGE_CLASS: Record<ConfigValueKind, string> = {
	array: "border-success/40 bg-success/10 text-success",
	boolean: "border-warning/40 bg-warning/10 text-warning",
	null: "border-dark-700 bg-dark-900 text-dark-500",
	number: "border-info/40 bg-info/10 text-info",
	object: "border-brand/40 bg-brand/10 text-ember",
	string: "border-dark-700 bg-dark-900 text-dark-200",
};

export function ConfigModalContent({
	entries,
	error,
	errorMode = "load",
	isLoading,
	isSaving,
	onClose,
	onEntryChange,
	onSave,
}: ConfigModalContentProps) {
	const tree = buildConfigEntryTree(entries);
	const hasBlockingError = errorMode === "load" && error !== null;
	const hasContent = !isLoading && !hasBlockingError && entries.length > 0;
	const isEmpty = !isLoading && !hasBlockingError && entries.length === 0;
	const errorTitle =
		errorMode === "save" ? "Failed to save config" : "Failed to load config";

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-950/80 px-4 py-6 backdrop-blur-sm">
			<div
				role="dialog"
				aria-label="Config modal"
				className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-dark-800 bg-dark-950 shadow-2xl shadow-black/50"
			>
				<header className="flex h-14 items-center gap-3 border-b border-dark-800 bg-dark-900/40 px-5">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dark-800 bg-dark-950 text-brand">
						<Settings2 size={14} />
					</div>
					<div className="min-w-0">
						<div className="font-display text-[13px] font-semibold uppercase tracking-[0.22em] text-dark-50">
							Runtime config
						</div>
						<div className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-dark-500">
							config.json
						</div>
					</div>
					<div className="flex-1" />
					<button
						type="button"
						onClick={onClose}
						aria-label="Close config modal"
						className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-dark-500 transition-colors hover:border-dark-700 hover:bg-dark-900 hover:text-dark-100"
					>
						<X size={16} />
					</button>
				</header>

				<div className="scrollbar-none flex-1 overflow-y-auto px-5 py-4">
					{isLoading ? (
						<StatusCard tone="muted">Loading config…</StatusCard>
					) : null}
					{!isLoading && error ? (
						<StatusCard tone="danger" title={errorTitle}>
							{error}
						</StatusCard>
					) : null}
					{isEmpty ? (
						<StatusCard tone="muted">No config entries found.</StatusCard>
					) : null}
					{hasContent ? (
						<div className="space-y-4">
							{tree.map((node) => (
								<TopLevelNode
									key={node.key}
									node={node}
									onEntryChange={onEntryChange}
								/>
							))}
						</div>
					) : null}
				</div>

				<footer className="flex items-center justify-end gap-3 border-t border-dark-800 bg-dark-900/40 px-5 py-4">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg border border-dark-700 bg-dark-950 px-3 py-2 text-sm text-dark-200 transition-colors hover:border-dark-500 hover:text-dark-50"
					>
						Close
					</button>
					<button
						type="button"
						onClick={onSave}
						disabled={isLoading || isSaving || entries.length === 0}
						className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-dark-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isSaving ? "Saving…" : "Save changes"}
					</button>
				</footer>
			</div>
		</div>
	);
}

function TopLevelNode({
	node,
	onEntryChange,
}: {
	node: ConfigTreeNode;
	onEntryChange: (item: string, value: string) => void;
}) {
	if (node.children.length === 0 && node.entry) {
		return (
			<section className="rounded-xl border border-dark-800 bg-dark-900/40 px-4 py-3">
				<ConfigLeaf
					entry={node.entry}
					label={node.label}
					onEntryChange={onEntryChange}
				/>
			</section>
		);
	}

	return (
		<section className="overflow-hidden rounded-xl border border-dark-800 bg-dark-900/40">
			<div className="border-b border-dark-800 px-4 py-2.5">
				<div className="font-mono-ui text-[11px] uppercase tracking-[0.18em] text-dark-200">
					{node.label}
				</div>
			</div>
			<div className="space-y-3 px-4 py-3">
				{node.entry ? (
					<ConfigLeaf
						entry={node.entry}
						label={node.label}
						onEntryChange={onEntryChange}
					/>
				) : null}
				{node.children.map((child) => (
					<NestedNode
						key={child.key}
						node={child}
						isRoot
						onEntryChange={onEntryChange}
					/>
				))}
			</div>
		</section>
	);
}

function NestedNode({
	isRoot,
	node,
	onEntryChange,
}: {
	isRoot: boolean;
	node: ConfigTreeNode;
	onEntryChange: (item: string, value: string) => void;
}) {
	if (node.children.length === 0 && node.entry) {
		return (
			<ConfigLeaf
				entry={node.entry}
				label={node.label}
				onEntryChange={onEntryChange}
			/>
		);
	}

	return (
		<div className={isRoot ? "" : "border-l border-dark-800 pl-3"}>
			<div className="mb-2 font-mono-ui text-[11px] uppercase tracking-[0.14em] text-dark-400">
				{node.label}
			</div>
			<div className="space-y-3">
				{node.entry ? (
					<ConfigLeaf
						entry={node.entry}
						label={node.label}
						onEntryChange={onEntryChange}
					/>
				) : null}
				{node.children.map((child) => (
					<NestedNode
						key={child.key}
						node={child}
						isRoot={false}
						onEntryChange={onEntryChange}
					/>
				))}
			</div>
		</div>
	);
}

function ConfigLeaf({
	entry,
	label,
	onEntryChange,
}: {
	entry: ConfigEntry;
	label: string;
	onEntryChange: (item: string, value: string) => void;
}) {
	return (
		<div className="grid gap-2 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)] md:items-start md:gap-3">
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				<span className="font-mono-ui break-all text-[12px] text-dark-100">
					{label}
				</span>
				<span
					className={`font-mono-ui inline-flex items-center rounded border px-1.5 py-0 text-[9px] uppercase tracking-[0.12em] ${KIND_BADGE_CLASS[entry.valueKind]}`}
				>
					{entry.typeLabel ?? entry.valueKind}
				</span>
			</div>
			<ConfigValueField entry={entry} onEntryChange={onEntryChange} />
		</div>
	);
}

function ConfigValueField({
	entry,
	onEntryChange,
}: {
	entry: ConfigEntry;
	onEntryChange: (item: string, value: string) => void;
}) {
	const editableKinds = entry.allowedValueKinds ?? [entry.valueKind];
	const usesTextarea =
		editableKinds.includes("array") || editableKinds.includes("object");
	const isBooleanOnlyField =
		editableKinds.length === 1 && editableKinds[0] === "boolean";

	if (isBooleanOnlyField) {
		const enabled = entry.value === "true";
		return (
			<button
				type="button"
				onClick={() => onEntryChange(entry.item, enabled ? "false" : "true")}
				aria-pressed={enabled}
				aria-label={enabled ? "Set to false" : "Set to true"}
				className="inline-flex items-center gap-2 self-start py-1.5"
			>
				<div
					aria-hidden="true"
					className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
						enabled ? "bg-success/30" : "bg-dark-700"
					}`}
				>
					<div
						className={`absolute top-0.5 h-3 w-3 rounded-full transition-transform ${
							enabled
								? "translate-x-3.5 bg-success"
								: "translate-x-0.5 bg-dark-300"
						}`}
					/>
				</div>
				<span
					className={`font-mono-ui text-xs ${
						enabled ? "text-success" : "text-dark-400"
					}`}
				>
					{enabled ? "true" : "false"}
				</span>
			</button>
		);
	}

	if (usesTextarea) {
		return (
			<textarea
				value={entry.value}
				onChange={(event) => onEntryChange(entry.item, event.target.value)}
				rows={3}
				className="scrollbar-none w-full rounded-lg border border-dark-800 bg-dark-950 px-3 py-2 font-mono-ui text-sm text-dark-50 outline-none transition-colors focus:border-brand"
			/>
		);
	}

	return (
		<input
			type="text"
			value={entry.value}
			onChange={(event) => onEntryChange(entry.item, event.target.value)}
			className="w-full rounded-lg border border-dark-800 bg-dark-950 px-3 py-1.5 font-mono-ui text-sm text-dark-50 outline-none transition-colors focus:border-brand"
		/>
	);
}

function StatusCard({
	children,
	title,
	tone,
}: {
	children: ReactNode;
	title?: string;
	tone: "muted" | "danger";
}) {
	const toneClass =
		tone === "danger"
			? "border-danger/40 bg-danger/5 text-danger"
			: "border-dashed border-dark-800 bg-dark-900/30 text-dark-500";
	return (
		<div
			className={`space-y-1 rounded-xl border px-4 py-5 text-sm ${toneClass}`}
		>
			{title ? <div className="font-medium text-dark-50">{title}</div> : null}
			<div className={tone === "danger" ? "text-dark-400" : undefined}>
				{children}
			</div>
		</div>
	);
}
