import { describe, expect, it } from "vitest";
import {
	DEFAULT_EXTERNAL_CLI_AGENTS,
	DEFAULT_NATIVE_ONLY_OPTIONS,
	DEFAULT_REVIEW_INTENT_PATTERNS,
	DEFAULT_WEAK_MODEL_PATTERNS,
} from "../src/config.js";
import {
	decideSubagentCall,
	normalizeSubagentInput,
} from "../src/modules/subagent-policy.js";

const opts = {
	weakModelPatterns: DEFAULT_WEAK_MODEL_PATTERNS,
	externalCliAgents: DEFAULT_EXTERNAL_CLI_AGENTS,
	nativeOnlyOptions: DEFAULT_NATIVE_ONLY_OPTIONS,
	reviewIntentPatterns: DEFAULT_REVIEW_INTENT_PATTERNS,
};
const facts = (
	over: Partial<{ capabilitiesListed: boolean; isSubagentChild: boolean }> = {},
) => ({
	capabilitiesListed: false,
	isSubagentChild: false,
	...over,
});

describe("規則 1（:88）— 派發前置檢查", () => {
	it("blocks an execution call before capabilities were listed", () => {
		const decision = decideSubagentCall(
			{ agent: "worker", task: "do x" },
			facts(),
			opts,
		);
		expect(decision.kind).toBe("block");
	});

	it("blocks a workflowScript call before capabilities were listed", () => {
		expect(
			decideSubagentCall(
				{ workflowScript: "return 1", async: true },
				facts(),
				opts,
			).kind,
		).toBe("block");
	});

	it("names the missing prerequisite in the reason", () => {
		const decision = decideSubagentCall({ agent: "worker" }, facts(), opts);
		expect(decision.kind).toBe("block");
		if (decision.kind === "block") {
			expect(decision.reason).toContain("capabilities");
			expect(decision.reason).toContain("AGENTS.md");
		}
	});

	it("passes once capabilities have been listed", () => {
		expect(
			decideSubagentCall(
				{ agent: "worker", task: "do x" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});

	it("passes a management action call regardless of capabilitiesListed", () => {
		expect(
			decideSubagentCall({ action: "list", capabilities: true }, facts(), opts)
				.kind,
		).toBe("pass");
		expect(decideSubagentCall({ action: "status" }, facts(), opts).kind).toBe(
			"pass",
		);
	});

	it("is disabled inside a subagent child session", () => {
		expect(
			decideSubagentCall(
				{ agent: "worker", task: "do x" },
				facts({ isSubagentChild: true }),
				opts,
			).kind,
		).toBe("pass");
	});

	it("does not apply to calls that neither execute nor manage", () => {
		expect(decideSubagentCall({}, facts(), opts).kind).toBe("pass");
	});
});

describe("規則 2（:91）— 高風險不得降級", () => {
	it("blocks a review-intent agent name paired with a weak model", () => {
		expect(
			decideSubagentCall(
				{
					agent: "reviewer",
					task: "review the diff",
					model: "anthropic/claude-haiku",
				},
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("block");
	});

	it("blocks a review-intent task paired with a weak model", () => {
		expect(
			decideSubagentCall(
				{ agent: "worker", task: "run a security audit", model: "gpt-mini" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("block");
	});

	it("passes when no model is specified", () => {
		expect(
			decideSubagentCall(
				{ agent: "reviewer", task: "review the diff" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});

	it("passes a weak model for a non-review task", () => {
		expect(
			decideSubagentCall(
				{ agent: "worker", task: "summarize the README", model: "haiku" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});

	it("passes a review task on a strong model", () => {
		expect(
			decideSubagentCall(
				{ agent: "reviewer", task: "review the diff", model: "opus" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});
});

describe("規則 3（:92）— external runner 不吃 native options", () => {
	it("blocks an external CLI agent given a native-only option", () => {
		const decision = decideSubagentCall(
			{ agent: "codex-exec", task: "review", model: "opus" },
			facts({ capabilitiesListed: true }),
			opts,
		);
		expect(decision.kind).toBe("block");
	});

	it("lists every violating field in the reason", () => {
		const decision = decideSubagentCall(
			{
				agent: "codex-exec",
				task: "review",
				model: "opus",
				acceptance: { level: "checked" },
			},
			facts({ capabilitiesListed: true }),
			opts,
		);
		expect(decision.kind).toBe("block");
		if (decision.kind === "block") {
			expect(decision.reason).toContain("model");
			expect(decision.reason).toContain("acceptance");
		}
	});

	it("blocks a native-only option nested in options", () => {
		const decision = decideSubagentCall(
			{
				agent: "codex-exec",
				task: "review",
				options: { acceptance: { level: "checked" } },
			},
			facts({ capabilitiesListed: true }),
			opts,
		);
		expect(decision.kind).toBe("block");
		if (decision.kind === "block") {
			expect(decision.reason).toContain("acceptance");
		}
	});

	it("blocks a context option nested in options", () => {
		expect(
			decideSubagentCall(
				{ agent: "codex-exec", task: "review", options: { context: "fresh" } },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("block");
	});

	it("ignores a non-object options value", () => {
		for (const options of [null, [], "fresh", 7]) {
			expect(
				decideSubagentCall(
					{ agent: "codex-exec", task: "review", options },
					facts({ capabilitiesListed: true }),
					opts,
				).kind,
			).toBe("pass");
		}
	});

	it("does not let options mask a top-level native-only option", () => {
		expect(
			decideSubagentCall(
				{
					agent: "codex-exec",
					task: "review",
					acceptance: { level: "checked" },
					options: { acceptance: undefined },
				},
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("block");
	});

	it("passes an external CLI agent without native-only options", () => {
		expect(
			decideSubagentCall(
				{ agent: "codex-exec", task: "review" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});

	it("passes a native agent using the same options", () => {
		expect(
			decideSubagentCall(
				{ agent: "reviewer", task: "review", model: "opus" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});
});

describe("normalizeSubagentInput", () => {
	it("merges options over the top level without mutating the input", () => {
		const input: Record<string, unknown> = {
			agent: "codex-exec",
			options: { context: "fresh" },
		};
		const snapshot = structuredClone(input);
		const view = normalizeSubagentInput(input);
		expect(view).not.toBe(input);
		expect(view.agent).toBe("codex-exec");
		expect(view.context).toBe("fresh");
		expect(input).toEqual(snapshot);
	});

	it("returns the input unchanged when options is not an object", () => {
		const input: Record<string, unknown> = { agent: "worker", options: null };
		expect(normalizeSubagentInput(input)).toEqual(input);
	});

	it("falls back to the top level when options cannot be enumerated", () => {
		const options: Record<string, unknown> = {};
		Object.defineProperty(options, "context", {
			enumerable: true,
			get() {
				throw new Error("hostile getter");
			},
		});
		const input: Record<string, unknown> = { agent: "codex-exec", options };
		expect(normalizeSubagentInput(input)).toBe(input);
	});
});

describe("config override", () => {
	it("honours a narrowed externalCliAgents list", () => {
		const narrow = { ...opts, externalCliAgents: ["only-this-runner"] };
		expect(
			decideSubagentCall(
				{ agent: "codex-exec", task: "review", model: "opus" },
				facts({ capabilitiesListed: true }),
				narrow,
			).kind,
		).toBe("pass");
	});

	it("honours an empty weakModelPatterns list", () => {
		const noWeak = { ...opts, weakModelPatterns: [] };
		expect(
			decideSubagentCall(
				{ agent: "reviewer", task: "review", model: "haiku" },
				facts({ capabilitiesListed: true }),
				noWeak,
			).kind,
		).toBe("pass");
	});
});
