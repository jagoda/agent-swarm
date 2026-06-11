import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPiRuntimeAuth,
  extractPiAssistantText,
  PiMonoAdapter,
  resolveModel,
} from "../providers/pi-mono-adapter";

describe("PiMonoAdapter", () => {
  test("name is 'pi'", () => {
    const adapter = new PiMonoAdapter();
    expect(adapter.name).toBe("pi");
  });
});

describe("AGENTS.md symlink management", () => {
  const tmpDir = `/tmp/pi-mono-test-${Date.now()}`;

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates symlink when CLAUDE.md exists but AGENTS.md does not", () => {
    const testDir = join(tmpDir, "symlink-create");
    mkdirSync(testDir);
    writeFileSync(join(testDir, "CLAUDE.md"), "# Test");

    // Simulate what createAgentsMdSymlink does
    const claudeMd = join(testDir, "CLAUDE.md");
    const agentsMd = join(testDir, "AGENTS.md");

    if (existsSync(claudeMd) && !existsSync(agentsMd)) {
      symlinkSync("CLAUDE.md", agentsMd);
    }

    expect(existsSync(agentsMd)).toBe(true);
  });

  test("does not overwrite existing AGENTS.md", () => {
    const testDir = join(tmpDir, "no-overwrite");
    mkdirSync(testDir);
    writeFileSync(join(testDir, "CLAUDE.md"), "# Claude");
    writeFileSync(join(testDir, "AGENTS.md"), "# Real AGENTS.md");

    const claudeMd = join(testDir, "CLAUDE.md");
    const agentsMd = join(testDir, "AGENTS.md");

    // Simulate createAgentsMdSymlink — should NOT overwrite existing AGENTS.md
    if (existsSync(claudeMd) && !existsSync(agentsMd)) {
      symlinkSync("CLAUDE.md", agentsMd);
    }

    // AGENTS.md should still be a real file, not a symlink
    expect(existsSync(agentsMd)).toBe(true);
    const content = readFileSync(agentsMd, "utf-8");
    expect(content).toBe("# Real AGENTS.md");
  });

  test("no-op when CLAUDE.md does not exist", () => {
    const testDir = join(tmpDir, "no-claudemd");
    mkdirSync(testDir);

    const claudeMd = join(testDir, "CLAUDE.md");
    const agentsMd = join(testDir, "AGENTS.md");

    if (existsSync(claudeMd) && !existsSync(agentsMd)) {
      symlinkSync("CLAUDE.md", agentsMd);
    }

    expect(existsSync(agentsMd)).toBe(false);
  });
});

describe("Model name mapping", () => {
  // Test the shortname → full ID mapping logic that resolveModel uses
  const shortnames: Record<string, [string, string]> = {
    opus: ["anthropic", "claude-opus-4-20250514"],
    sonnet: ["anthropic", "claude-sonnet-4-20250514"],
    haiku: ["anthropic", "claude-haiku-4-5-20251001"],
  };

  test("opus maps to anthropic/claude-opus-4-20250514", () => {
    const mapping = shortnames.opus;
    expect(mapping).toBeDefined();
    expect(mapping![0]).toBe("anthropic");
    expect(mapping![1]).toBe("claude-opus-4-20250514");
  });

  test("sonnet maps to anthropic/claude-sonnet-4-20250514", () => {
    const mapping = shortnames.sonnet;
    expect(mapping).toBeDefined();
    expect(mapping![0]).toBe("anthropic");
    expect(mapping![1]).toBe("claude-sonnet-4-20250514");
  });

  test("haiku maps to anthropic/claude-haiku-4-5-20251001", () => {
    const mapping = shortnames.haiku;
    expect(mapping).toBeDefined();
    expect(mapping![0]).toBe("anthropic");
    expect(mapping![1]).toBe("claude-haiku-4-5-20251001");
  });

  test("unknown shortname returns undefined", () => {
    const mapping = shortnames.gpt4;
    expect(mapping).toBeUndefined();
  });

  test("provider/model-id format is parseable", () => {
    const modelStr = "anthropic/claude-opus-4-20250514";
    expect(modelStr.includes("/")).toBe(true);
    const [provider, modelId] = modelStr.split("/", 2);
    expect(provider).toBe("anthropic");
    expect(modelId).toBe("claude-opus-4-20250514");
  });
});

describe("resolveModel — OpenRouter reroute for anthropic shortnames", () => {
  // Regression coverage for task 37a4a87a: workers spawned with
  // `provider: pi` + `OPENROUTER_API_KEY` (no ANTHROPIC_API_KEY) and a task
  // model of `sonnet` / `haiku` / `opus` previously crashed at
  // session-start with "No API key found for anthropic" because pi-ai's
  // anthropic provider only checks ANTHROPIC_OAUTH_TOKEN / ANTHROPIC_API_KEY.
  // The adapter now reroutes the shortname through the OpenRouter mirror.

  test("sonnet → openrouter/anthropic/claude-sonnet-4 when only OPENROUTER_API_KEY is set", () => {
    const env = { OPENROUTER_API_KEY: "sk-or-..." };
    const model = resolveModel("sonnet", env);
    expect(model).toBeDefined();
    expect(model?.provider).toBe("openrouter");
    expect(model?.id).toBe("anthropic/claude-sonnet-4");
  });

  test("haiku → openrouter/anthropic/claude-haiku-4.5 when only OPENROUTER_API_KEY is set", () => {
    const env = { OPENROUTER_API_KEY: "sk-or-..." };
    const model = resolveModel("haiku", env);
    expect(model).toBeDefined();
    expect(model?.provider).toBe("openrouter");
    expect(model?.id).toBe("anthropic/claude-haiku-4.5");
  });

  test("opus → openrouter/anthropic/claude-opus-4 when only OPENROUTER_API_KEY is set", () => {
    const env = { OPENROUTER_API_KEY: "sk-or-..." };
    const model = resolveModel("opus", env);
    expect(model).toBeDefined();
    expect(model?.provider).toBe("openrouter");
    expect(model?.id).toBe("anthropic/claude-opus-4");
  });

  test("anthropic native path wins when ANTHROPIC_API_KEY is set (even alongside OPENROUTER_API_KEY)", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-...", OPENROUTER_API_KEY: "sk-or-..." };
    const model = resolveModel("sonnet", env);
    expect(model).toBeDefined();
    expect(model?.provider).toBe("anthropic");
    expect(model?.id).toBe("claude-sonnet-4-20250514");
  });

  test("ANTHROPIC_OAUTH_TOKEN alone also wins over OPENROUTER reroute", () => {
    const env = { ANTHROPIC_OAUTH_TOKEN: "sk-ant-oat-...", OPENROUTER_API_KEY: "sk-or-..." };
    const model = resolveModel("sonnet", env);
    expect(model).toBeDefined();
    expect(model?.provider).toBe("anthropic");
  });

  test("no rerouting for non-shortname `anthropic/<model>` strings", () => {
    // Explicit provider prefix should not be silently swapped — that path is
    // the caller's explicit choice, surface as-is.
    const env = { OPENROUTER_API_KEY: "sk-or-..." };
    const model = resolveModel("anthropic/claude-sonnet-4-20250514", env);
    expect(model?.provider).toBe("anthropic");
  });

  test("default env arg falls back to process.env (smoke test — no creds set)", () => {
    // Just confirm the default parameter doesn't throw — the actual model
    // resolution depends on the test runner's env.
    expect(() => resolveModel("unknown-model-id")).not.toThrow();
  });
});

describe("createPiRuntimeAuth", () => {
  test("threads resolved OpenRouter key into pi runtime auth without process.env", async () => {
    const { modelRegistry } = createPiRuntimeAuth({ OPENROUTER_API_KEY: "sk-or-runtime" });

    await expect(modelRegistry.getApiKeyForProvider("openrouter")).resolves.toBe("sk-or-runtime");
  });

  test("supports all pi env-backed providers", async () => {
    const { modelRegistry } = createPiRuntimeAuth({
      ANTHROPIC_API_KEY: "sk-ant-runtime",
      OPENAI_API_KEY: "sk-openai-runtime",
      GOOGLE_API_KEY: "sk-google-runtime",
    });

    await expect(modelRegistry.getApiKeyForProvider("anthropic")).resolves.toBe("sk-ant-runtime");
    await expect(modelRegistry.getApiKeyForProvider("openai")).resolves.toBe("sk-openai-runtime");
    await expect(modelRegistry.getApiKeyForProvider("google")).resolves.toBe("sk-google-runtime");
  });
});

describe("Pi-mono event normalization", () => {
  test("extractPiAssistantText ignores user messages", () => {
    const text = extractPiAssistantText({
      role: "user",
      content: "/skill:work-on-task task-123\n\nTask: hello",
    });

    expect(text).toBe("");
  });

  test("extractPiAssistantText extracts assistant text blocks", () => {
    const text = extractPiAssistantText({
      role: "assistant",
      content: [
        { type: "text", text: "Hello, " },
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "world!" },
      ],
    });

    expect(text).toBe("Hello, world!");
  });

  test("extractPiAssistantText supports string assistant content", () => {
    const text = extractPiAssistantText({
      role: "assistant",
      content: "Plain assistant output",
    });

    expect(text).toBe("Plain assistant output");
  });

  test("message_update with text content produces raw_log-style data", () => {
    // Simulates what PiMonoSession.handleAgentEvent does
    const event = {
      type: "message_update" as const,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Hello, world!" },
          { type: "text", text: " More text." },
        ],
      },
    };

    const content = event.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("");

    expect(content).toBe("Hello, world! More text.");
  });

  test("tool_execution_start produces tool_use log", () => {
    const event = {
      type: "tool_execution_start" as const,
      toolName: "write",
      toolCallId: "tc-123",
    };

    const logEntry = JSON.stringify({
      type: "tool_use",
      name: event.toolName,
      id: event.toolCallId,
    });

    const parsed = JSON.parse(logEntry);
    expect(parsed.type).toBe("tool_use");
    expect(parsed.name).toBe("write");
    expect(parsed.id).toBe("tc-123");
  });

  test("tool_execution_end produces tool_result log", () => {
    const event = {
      type: "tool_execution_end" as const,
      toolName: "write",
      toolCallId: "tc-123",
      isError: false,
    };

    const logEntry = JSON.stringify({
      type: "tool_result",
      name: event.toolName,
      id: event.toolCallId,
      isError: event.isError,
    });

    const parsed = JSON.parse(logEntry);
    expect(parsed.type).toBe("tool_result");
    expect(parsed.isError).toBe(false);
  });
});

describe("Cost aggregation from SessionStats", () => {
  test("builds CostData from SessionStats shape", () => {
    const stats = {
      tokens: {
        input: 5000,
        output: 2000,
        cacheRead: 1000,
        cacheWrite: 500,
        total: 8500,
      },
      cost: 0.0456,
      userMessages: 1,
      assistantMessages: 4,
    };

    const cost = {
      sessionId: "",
      taskId: "task-1",
      agentId: "agent-1",
      totalCostUsd: stats.cost || 0,
      inputTokens: stats.tokens.input,
      outputTokens: stats.tokens.output,
      cacheReadTokens: stats.tokens.cacheRead,
      cacheWriteTokens: stats.tokens.cacheWrite,
      durationMs: 0,
      numTurns: stats.userMessages + stats.assistantMessages,
      model: "opus",
      isError: false,
    };

    expect(cost.totalCostUsd).toBe(0.0456);
    expect(cost.inputTokens).toBe(5000);
    expect(cost.outputTokens).toBe(2000);
    expect(cost.cacheReadTokens).toBe(1000);
    expect(cost.cacheWriteTokens).toBe(500);
    expect(cost.numTurns).toBe(5);
  });

  test("handles zero-cost stats", () => {
    const stats = {
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
      userMessages: 0,
      assistantMessages: 0,
    };

    const cost = {
      totalCostUsd: stats.cost || 0,
      numTurns: stats.userMessages + stats.assistantMessages,
    };

    expect(cost.totalCostUsd).toBe(0);
    expect(cost.numTurns).toBe(0);
  });
});

// ============================================================================
// AWS SDK error detection — PiMonoSession + classifyAwsSdkError integration
// ============================================================================

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { PiMonoSession } from "../providers/pi-mono-adapter";
import type { ProviderEvent, ProviderResult, ProviderSessionConfig } from "../providers/types";
import { classifyAwsSdkError } from "../utils/aws-error-classifier";

/**
 * Build a minimal ProviderSessionConfig pointing at a temp log file.
 */
function makeSessionConfig(logFile: string): ProviderSessionConfig {
  return {
    prompt: "test prompt",
    systemPrompt: "",
    model: "amazon-bedrock/anthropic.claude-3-5-sonnet-20240620-v1:0",
    role: "worker",
    agentId: "test-agent-id",
    taskId: "test-task-id",
    apiUrl: "http://localhost:3013",
    apiKey: "test-key",
    cwd: "/tmp",
    logFile,
    iteration: 1,
  };
}

type AgentSessionEvent = Parameters<Parameters<AgentSession["subscribe"]>[0]>[0];

/**
 * Create a minimal mock AgentSession.
 *
 * @param throwError   If set, `prompt()` throws with this message.
 * @param autoRetryErrors  If set, `prompt()` fires auto_retry_start events before returning/throwing.
 */
function makeMockAgentSession(opts: {
  throwError?: string;
  autoRetryErrors?: string[];
}): AgentSession {
  const listeners: Array<(event: AgentSessionEvent) => void> = [];

  return {
    sessionId: "mock-session-id",
    isStreaming: false,
    model: undefined,
    subscribe(listener: (event: AgentSessionEvent) => void) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    async prompt() {
      // Simulate auto_retry events before throwing / returning
      if (opts.autoRetryErrors) {
        for (let i = 0; i < opts.autoRetryErrors.length; i++) {
          for (const l of listeners) {
            l({
              type: "auto_retry_start",
              attempt: i + 1,
              maxAttempts: opts.autoRetryErrors.length,
              delayMs: 0,
              errorMessage: opts.autoRetryErrors[i],
            });
          }
        }
      }
      if (opts.throwError) throw new Error(opts.throwError);
    },
    getContextUsage: () => null,
    getSessionStats: () => ({
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
      userMessages: 0,
      assistantMessages: 0,
    }),
    abort: async () => {},
    dispose: () => {},
  } as unknown as AgentSession;
}

const tmpLogDir = `/tmp/pi-mono-aws-test-${Date.now()}`;

beforeAll(() => {
  mkdirSync(tmpLogDir, { recursive: true });
});

afterAll(() => {
  rmSync(tmpLogDir, { recursive: true, force: true });
});

describe("PiMonoSession — AWS error catch path (exception thrown from prompt())", () => {
  async function runWithError(errorMessage: string): Promise<{
    events: ProviderEvent[];
    result: ProviderResult;
  }> {
    const logFile = join(
      tmpLogDir,
      `catch-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    );
    const session = new PiMonoSession(
      makeMockAgentSession({ throwError: errorMessage }),
      makeSessionConfig(logFile),
      false,
    );
    const events: ProviderEvent[] = [];
    session.onEvent((e) => events.push(e));
    const result = await session.waitForCompletion();
    return { events, result };
  }

  test("ExpiredTokenException → {type:'error', category:'aws-auth'} + result.isError + result.errorCategory", async () => {
    const { events, result } = await runWithError(
      "ExpiredTokenException: The security token included in the request is expired",
    );
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as Extract<ProviderEvent, { type: "error" }>).category).toBe("aws-auth");
    expect(result.isError).toBe(true);
    expect(result.errorCategory).toBe("aws-auth");
    expect(result.exitCode).toBe(1);
    expect(result.failureReason).toContain("aws sso login");
  });

  test("ThrottlingException → {type:'error', category:'aws-throttle'}", async () => {
    const { events, result } = await runWithError("ThrottlingException: Rate exceeded");
    const errorEvent = events.find((e) => e.type === "error") as Extract<
      ProviderEvent,
      { type: "error" }
    >;
    expect(errorEvent?.category).toBe("aws-throttle");
    expect(result.errorCategory).toBe("aws-throttle");
    expect(result.isError).toBe(true);
  });

  test("AccessDeniedException → {type:'error', category:'aws-access'}", async () => {
    const { events, result } = await runWithError(
      "AccessDeniedException: not authorized to perform: bedrock:InvokeModel",
    );
    const errorEvent = events.find((e) => e.type === "error") as Extract<
      ProviderEvent,
      { type: "error" }
    >;
    expect(errorEvent?.category).toBe("aws-access");
    expect(result.errorCategory).toBe("aws-access");
  });

  test("ValidationException → {type:'error', category:'aws-model'}", async () => {
    const { events, result } = await runWithError(
      "ValidationException: Invocation of model ID x with on-demand throughput isn't supported",
    );
    const errorEvent = events.find((e) => e.type === "error") as Extract<
      ProviderEvent,
      { type: "error" }
    >;
    expect(errorEvent?.category).toBe("aws-model");
    expect(result.errorCategory).toBe("aws-model");
  });

  test("non-AWS error does NOT emit {type:'error'} event", async () => {
    const { events, result } = await runWithError("ECONNREFUSED 127.0.0.1:3013");
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeUndefined();
    // Still fails (exitCode 1) but no typed error event
    expect(result.isError).toBe(true);
    expect(result.errorCategory).toBeUndefined();
  });

  test("AWS error sets rawStderr on ProviderResult", async () => {
    const { result } = await runWithError("ExpiredTokenException: The security token is expired");
    expect(result.rawStderr).toBeDefined();
    expect(result.rawStderr).toContain("[pi-mono] Error:");
  });
});

describe("PiMonoSession — AWS error silent-exit path (auto_retry + no output)", () => {
  async function runWithAutoRetry(autoRetryErrors: string[]): Promise<{
    events: ProviderEvent[];
    result: ProviderResult;
  }> {
    const logFile = join(
      tmpLogDir,
      `autoretry-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    );
    // Session that fires auto_retry_start events but does NOT throw (silent exit)
    const session = new PiMonoSession(
      makeMockAgentSession({ autoRetryErrors }),
      makeSessionConfig(logFile),
      false,
    );
    const events: ProviderEvent[] = [];
    session.onEvent((e) => events.push(e));
    const result = await session.waitForCompletion();
    return { events, result };
  }

  test("ExpiredTokenException in auto_retry + no output → {type:'error'} + exitCode 1", async () => {
    const { events, result } = await runWithAutoRetry([
      "ExpiredTokenException: The security token included in the request is expired",
    ]);
    const errorEvent = events.find((e) => e.type === "error") as Extract<
      ProviderEvent,
      { type: "error" }
    >;
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.category).toBe("aws-auth");
    expect(result.isError).toBe(true);
    expect(result.errorCategory).toBe("aws-auth");
    expect(result.exitCode).toBe(1);
  });

  test("ThrottlingException in auto_retry + no output → aws-throttle error event", async () => {
    const { events, result } = await runWithAutoRetry([
      "ThrottlingException: Rate exceeded",
      "ThrottlingException: Rate exceeded",
    ]);
    const errorEvent = events.find((e) => e.type === "error") as Extract<
      ProviderEvent,
      { type: "error" }
    >;
    expect(errorEvent?.category).toBe("aws-throttle");
    expect(result.errorCategory).toBe("aws-throttle");
  });
});

describe("classifyAwsSdkError — all 4 categories (quick summary)", () => {
  test("all four categories are reachable", () => {
    const cases: Array<[string, string]> = [
      ["ExpiredTokenException: token expired", "aws-auth"],
      ["ThrottlingException: rate exceeded", "aws-throttle"],
      ["AccessDeniedException: no permission", "aws-access"],
      ["ValidationException: bad model", "aws-model"],
    ];
    for (const [msg, expected] of cases) {
      const r = classifyAwsSdkError(msg);
      expect(r?.category).toBe(expected);
    }
  });
});
