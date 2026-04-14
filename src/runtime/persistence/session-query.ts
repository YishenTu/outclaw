import { Database } from "bun:sqlite";
import {
	mapSessionRows,
	type SessionRow,
	type SessionTag,
} from "./session-store-records.ts";

interface SessionQueryListOptions {
	agentId?: string;
	limit?: number;
	tag: SessionTag;
}

interface SessionQueryResolveOptions {
	agentId?: string;
	selector: string;
	tag: SessionTag;
}

export type SessionResolveResult =
	| { status: "none" }
	| { status: "one"; match: SessionRow }
	| { status: "many"; matches: SessionRow[] };

export class SessionQuery {
	private readonly db: Database;

	constructor(path: string) {
		this.db = new Database(path, { readonly: true, create: false });
	}

	close() {
		this.db.close();
	}

	list(options: SessionQueryListOptions): SessionRow[] {
		const conditions = ["tag = $tag"];
		const params: Record<string, string | number> = {
			$limit: options.limit ?? 20,
			$tag: options.tag,
		};

		if (options.agentId) {
			conditions.push("agent_id = $agentId");
			params.$agentId = options.agentId;
		}

		return mapSessionRows(
			this.db
				.query(
					`SELECT
						agent_id,
						provider_id,
						sdk_session_id,
						title,
						model,
						source,
						tag,
						created_at,
						last_active
					FROM sessions
					WHERE ${conditions.join(" AND ")}
					ORDER BY last_active DESC
					LIMIT $limit`,
				)
				.all(params) as Parameters<typeof mapSessionRows>[0],
		);
	}

	resolve(options: SessionQueryResolveOptions): SessionResolveResult {
		const exactMatches = this.findByCondition(
			"sdk_session_id = $selector",
			options,
		);
		if (exactMatches.length === 1) {
			return { status: "one", match: exactMatches[0] as SessionRow };
		}
		if (exactMatches.length > 1) {
			return { status: "many", matches: exactMatches };
		}

		const prefixMatches = this.findByCondition(
			"sdk_session_id LIKE $selector",
			{
				...options,
				selector: `${options.selector}%`,
			},
		);
		if (prefixMatches.length === 0) {
			return { status: "none" };
		}
		if (prefixMatches.length === 1) {
			return { status: "one", match: prefixMatches[0] as SessionRow };
		}
		return { status: "many", matches: prefixMatches };
	}

	private findByCondition(
		selectorCondition: string,
		options: SessionQueryResolveOptions,
	): SessionRow[] {
		const conditions = ["tag = $tag", selectorCondition];
		const params: Record<string, string> = {
			$selector: options.selector,
			$tag: options.tag,
		};

		if (options.agentId) {
			conditions.push("agent_id = $agentId");
			params.$agentId = options.agentId;
		}

		return mapSessionRows(
			this.db
				.query(
					`SELECT
						agent_id,
						provider_id,
						sdk_session_id,
						title,
						model,
						source,
						tag,
						created_at,
						last_active
					FROM sessions
					WHERE ${conditions.join(" AND ")}
					ORDER BY last_active DESC`,
				)
				.all(params) as Parameters<typeof mapSessionRows>[0],
		);
	}
}
