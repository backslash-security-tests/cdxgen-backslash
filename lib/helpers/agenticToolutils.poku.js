import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { assert, describe, it } from "poku";

import {
  AGENTIC_TOOL_PURL_TYPE,
  collectToolSignals,
  componentForAgenticTool,
  getAgenticToolDirs,
  redactHomePath,
} from "./agenticToolutils.js";

const getProp = (subject, name) =>
  subject?.properties?.find((property) => property.name === name)?.value;

const createTempHome = () => mkdtempSync(join(os.tmpdir(), "cdxgen-agentic-"));

/** Build a fixture ~/.kiro layout, including a secret file that must be ignored. */
function writeKiroFixture(root) {
  const kiro = join(root, ".kiro");
  mkdirSync(join(kiro, "agents"), { recursive: true });
  mkdirSync(join(kiro, "settings"), { recursive: true });
  mkdirSync(join(kiro, "sessions", "cli"), { recursive: true });
  writeFileSync(
    join(kiro, "agents", "autonomous.json"),
    JSON.stringify({
      name: "autonomous",
      description: "Autonomous agent",
      prompt: "SECRET PROMPT TEXT THAT MUST NOT LEAK",
      model: "claude-sonnet-4-5",
      mcpServers: { fs: {}, git: {} },
      tools: ["fs_read", "fs_write", "execute_bash"],
      allowedTools: ["fs_read"],
    }),
  );
  // An example file that should be skipped.
  writeFileSync(join(kiro, "agents", "agent_config.json.example"), "{}");
  writeFileSync(
    join(kiro, "settings", "cli.json"),
    JSON.stringify({
      "chat.defaultAgent": "autonomous",
      "telemetry.enabled": true,
    }),
  );
  // A secret transcript that must never be read.
  writeFileSync(
    join(kiro, "sessions", "cli", "abc.jsonl"),
    '{"secret":"sk-do-not-read"}',
  );
  const support = join(root, "kiro-support");
  mkdirSync(join(support, "knowledge_bases", "kb1"), { recursive: true });
  mkdirSync(join(support, "knowledge_bases", "kb2"), { recursive: true });
  return { kiro, support };
}

describe("agenticToolutils", () => {
  it("lists known agentic tool home directories", () => {
    const entries = getAgenticToolDirs();
    const tools = entries.map((entry) => entry.tool);
    for (const tool of ["kiro-cli", "zcode", "opencode", "claude-code"]) {
      assert.ok(tools.includes(tool), `expected ${tool} in the tool map`);
    }
    for (const entry of entries) {
      assert.ok(Array.isArray(entry.dirs) && entry.dirs.length > 0);
    }
    assert.strictEqual(AGENTIC_TOOL_PURL_TYPE, "generic");
  });

  it("collects redacted kiro signals without reading secrets", () => {
    const root = createTempHome();
    try {
      const { kiro, support } = writeKiroFixture(root);
      const signals = collectToolSignals("kiro-cli", kiro, support);
      assert.strictEqual(signals.agentCount, 1);
      assert.strictEqual(signals.knowledgeBaseCount, 2);
      assert.strictEqual(signals.defaultAgent, "autonomous");
      assert.strictEqual(signals.hasSessions, true);
      // Ensure no secret value leaked into the signal map.
      const serialized = JSON.stringify(signals);
      assert.ok(!serialized.includes("sk-do-not-read"));
      assert.ok(!serialized.includes("SECRET PROMPT"));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("builds a generic-purl component with kiro agent children", () => {
    const root = createTempHome();
    try {
      const { kiro, support } = writeKiroFixture(root);
      const component = componentForAgenticTool({
        tool: "kiro-cli",
        name: "Kiro CLI",
        dir: kiro,
        supportDir: support,
      });
      assert.strictEqual(component.type, "application");
      // The display name is used for the component name; the tool key lives on
      // cdx:agentic:tool.
      assert.strictEqual(component.name, "Kiro CLI");
      assert.strictEqual(getProp(component, "cdx:agentic:tool"), "kiro-cli");
      // No declarative version file, so the namespaced purl carries no version.
      assert.strictEqual(component.purl, "pkg:generic/cdxgen-agentic/kiro-cli");
      assert.strictEqual(getProp(component, "cdx:agentic:agentCount"), "1");
      assert.ok((component.tags || []).includes("agentic-cli"));
      // The whole component must be free of secret content.
      const serialized = JSON.stringify(component);
      assert.ok(!serialized.includes("SECRET PROMPT"));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("counts opencode providers and zcode plugins", () => {
    const root = createTempHome();
    try {
      const oc = join(root, "opencode");
      mkdirSync(join(oc, "plugins"), { recursive: true });
      writeFileSync(
        join(oc, "opencode.json"),
        JSON.stringify({
          provider: { openai: {}, anthropic: {} },
          model: "openai/gpt-4o",
        }),
      );
      writeFileSync(
        join(oc, "package.json"),
        JSON.stringify({
          dependencies: { "@opencode-ai/plugin": "1.15.0" },
        }),
      );
      writeFileSync(join(oc, "plugins", "git-ai.ts"), "export const x = 1;");
      const ocSignals = collectToolSignals("opencode", oc);
      assert.strictEqual(ocSignals.providerCount, 2);
      assert.strictEqual(ocSignals.hasDefaultModel, true);
      assert.strictEqual(ocSignals.pluginCount, 1);

      const ocComponent = componentForAgenticTool({
        tool: "opencode",
        name: "opencode",
        dir: oc,
      });
      assert.strictEqual(ocComponent.version, "1.15.0");
      assert.strictEqual(
        ocComponent.purl,
        "pkg:generic/cdxgen-agentic/opencode@1.15.0",
      );

      const zc = join(root, "zcode");
      const pluginDir = join(
        zc,
        "cli",
        "plugins",
        "cache",
        "official",
        "docs",
        "0.1.0",
        ".zcode-plugin",
      );
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "plugin.json"),
        JSON.stringify({
          name: "docs",
          version: "0.1.0",
          license: "MIT",
          skills: "skills/docs.md",
          mcpServers: { docs: {} },
        }),
      );
      mkdirSync(join(zc, "cli"), { recursive: true });
      writeFileSync(
        join(zc, "cli", "config.json"),
        JSON.stringify({
          plugins: {
            enabledPlugins: { "docs@official": true, "x@official": false },
          },
        }),
      );
      const zcSignals = collectToolSignals("zcode", zc);
      assert.strictEqual(zcSignals.pluginCount, 2);
      assert.strictEqual(zcSignals.enabledPluginCount, 1);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("redacts the home directory prefix to a ~-relative path", () => {
    const home = os.homedir();
    assert.strictEqual(redactHomePath(join(home, ".kiro")), "~/.kiro");
    assert.strictEqual(redactHomePath(home), "~");
    // Paths outside the home directory are returned unchanged.
    assert.strictEqual(redactHomePath("/opt/tools/x"), "/opt/tools/x");
  });

  it("counts codex TOML and gemini settings MCP servers", () => {
    const root = createTempHome();
    try {
      const codex = join(root, ".codex");
      mkdirSync(codex, { recursive: true });
      writeFileSync(
        join(codex, "config.toml"),
        [
          "[mcp_servers.fs]",
          'command = "npx"',
          "",
          "[mcp_servers.git]",
          'command = "uvx"',
        ].join("\n"),
      );
      const codexSignals = collectToolSignals("codex", codex);
      assert.strictEqual(codexSignals.mcpServerCount, 2);

      const gemini = join(root, ".gemini");
      mkdirSync(gemini, { recursive: true });
      writeFileSync(
        join(gemini, "settings.json"),
        JSON.stringify({ mcpServers: { docs: {} } }),
      );
      const geminiSignals = collectToolSignals("gemini-cli", gemini);
      assert.strictEqual(geminiSignals.mcpServerCount, 1);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("reads opencode.jsonc with comments and trailing commas", () => {
    const root = createTempHome();
    try {
      const oc = join(root, "opencode");
      mkdirSync(oc, { recursive: true });
      writeFileSync(
        join(oc, "opencode.jsonc"),
        [
          "{",
          "  // default model",
          '  "model": "openai/gpt-4o",',
          '  "provider": { "openai": {}, },',
          "}",
        ].join("\n"),
      );
      const signals = collectToolSignals("opencode", oc);
      assert.strictEqual(signals.providerCount, 1);
      assert.strictEqual(signals.hasDefaultModel, true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
