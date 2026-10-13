import type {
	Decision,
	SubagentPolicyFacts,
	SubagentPolicyOptions,
} from "../types.js";

/** Keys whose presence marks a call as execution (as opposed to management). */
const EXECUTION_KEYS: readonly string[] = [
	"agent",
	"workflowScript",
	"workflowScriptPath",
	"workflow",
];

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isExecutionCall(input: Record<string, unknown>): boolean {
	if (asString(input.action) !== undefined) return false;
	return EXECUTION_KEYS.some((key) => input[key] !== undefined);
}

function matchesAny(value: string, patterns: string[]): boolean {
	const lower = value.toLowerCase();
	return patterns.some(
		(pattern) => pattern !== "" && lower.includes(pattern.toLowerCase()),
	);
}

function blockReason(what: string, detail: string): string {
	return [
		`[agents-guard/subagent-policy] 已阻擋：${what}`,
		`  ${detail}`,
		"  這是 AGENTS.md 的 MUST 級防線，不提供單次放行選項。",
	].join("\n");
}

/**
 * pi-subagents 0.77.0 moved every management/option field into a single
 * `options` object in the model-facing `subagent` schema, while RPC/slash and
 * older sessions still send the flat shape. Pi hands the model's raw arguments
 * to this module, so both shapes must be read as one view. `options` overrides
 * the top level, but `undefined` values are dropped so a nested `undefined`
 * cannot mask a top-level value the way a plain spread would. Upstream
 * reference: pi-subagents `src/extension/subagent-options.js`
 * (`flattenSubagentToolOptions`) and `src/extension/schemas.js`.
 */
export function normalizeSubagentInput(
	input: Record<string, unknown>,
): Record<string, unknown> {
	const { options } = input;
	if (
		options === null ||
		typeof options !== "object" ||
		Array.isArray(options)
	) {
		return input;
	}
	try {
		const defined = Object.fromEntries(
			Object.entries(options).filter(([, value]) => value !== undefined),
		);
		return { ...input, ...defined };
	} catch {
		// An exotic `options` object must not take down the caller:
		// `handleToolResult` reads this helper outside the guarded policy wrapper.
		return input;
	}
}

/**
 * Pure decision core for the three subagent-dispatch rules in design.md §5.2.
 * No I/O, no pi API — every fact the rules need arrives via `facts`/`opts`.
 */
export function decideSubagentCall(
	input: Record<string, unknown>,
	facts: SubagentPolicyFacts,
	opts: SubagentPolicyOptions,
): Decision {
	const view = normalizeSubagentInput(input);
	// Rule 1 (AGENTS.md:88): a dispatching call must first have listed
	// available agents. Management/control calls (those carrying `action`)
	// are exempt, and this rule has no downstream consumer inside a child
	// session (the parent's brief already picked the agent), so it is
	// disabled there — see design.md §5.5.
	if (
		!facts.isSubagentChild &&
		!facts.capabilitiesListed &&
		isExecutionCall(view)
	) {
		return {
			kind: "block",
			reason: blockReason(
				"派發前未列出可用 agent",
				'請先呼叫 { action: "list", capabilities: true }，確認要派發的 agent 可執行、未停用後再派發。（AGENTS.md:88）',
			),
		};
	}

	// Rule 2 (AGENTS.md:91): review/audit/security/threat work must not be
	// silently downgraded to a weak model. Only fires when `model` is given
	// explicitly — omitting it means "use the agent's own default", which is
	// not a downgrade.
	const model = asString(view.model);
	if (model !== undefined && matchesAny(model, opts.weakModelPatterns)) {
		const agent = asString(view.agent) ?? "";
		const task = asString(view.task) ?? "";
		if (
			matchesAny(agent, opts.reviewIntentPatterns) ||
			matchesAny(task, opts.reviewIntentPatterns)
		) {
			return {
				kind: "block",
				reason: blockReason(
					"高風險任務被指定使用弱模型",
					`agent=${agent || "(未命名)"}  model=${model}  高風險 review/audit 類任務不得降級。（AGENTS.md:91）`,
				),
			};
		}
	}

	// Rule 3 (AGENTS.md:92): native-only Pi child options do not apply to
	// external CLI runners unless their contract explicitly supports them.
	const agent = asString(view.agent);
	if (agent !== undefined && opts.externalCliAgents.includes(agent)) {
		const violating = opts.nativeOnlyOptions.filter(
			(key) => view[key] !== undefined,
		);
		if (violating.length > 0) {
			return {
				kind: "block",
				reason: blockReason(
					"external CLI agent 收到 native-only 選項",
					`agent=${agent}  違規欄位=${violating.join(", ")}  外部 runner 不套用這些選項，除非其 contract 明示支援。（AGENTS.md:92）`,
				),
			};
		}
	}

	return { kind: "pass" };
}
