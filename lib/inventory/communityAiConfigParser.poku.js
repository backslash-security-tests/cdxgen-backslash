import esmock from "esmock";
import { assert, describe, it } from "poku";
import sinon from "sinon";

function getProp(obj, name) {
  return obj?.properties?.find((property) => property.name === name)?.value;
}

describe("communityAiConfigParser", () => {
  it("normalizes Windows paths for community ecosystem discovery", async () => {
    const readFileSync = sinon.stub();
    readFileSync
      .withArgs("C:\\repo\\.opencode\\agents\\review.md", "utf-8")
      .returns(
        [
          "---",
          "description: Reviews code for bugs and quality",
          "mode: subagent",
          "model: anthropic/claude-sonnet-4-20250514",
          "---",
          "Focus on code review findings.",
        ].join("\n"),
      );
    readFileSync
      .withArgs("C:\\repo\\.nanocoder\\commands\\fix.md", "utf-8")
      .returns(
        [
          "---",
          "description: Apply the standard fix workflow",
          "category: engineering",
          "tags: [bugfix, workflow]",
          "---",
          "1. Reproduce the issue",
        ].join("\n"),
      );
    const { communityAiConfigParser } = await esmock(
      "./communityAiConfigParser.js",
      {
        "node:fs": { readFileSync },
      },
    );

    const result = communityAiConfigParser.parse([
      "C:\\repo\\.opencode\\agents\\review.md",
      "C:\\repo\\.nanocoder\\commands\\fix.md",
    ]);

    assert.ok(
      result.components.some(
        (component) =>
          getProp(component, "cdx:agent:framework") === "opencode" &&
          getProp(component, "cdx:file:kind") === "agent-definition",
      ),
    );
    assert.ok(
      result.components.some(
        (component) =>
          getProp(component, "cdx:agent:framework") === "nanocoder" &&
          getProp(component, "cdx:file:kind") === "custom-command",
      ),
    );
  });

  it("sanitizes secret-bearing AI inventory properties before emission", async () => {
    const readFileSync = sinon.stub();
    readFileSync.withArgs("/repo/opencode.json", "utf-8").returns(
      JSON.stringify({
        agent: {
          release: {
            description:
              "Deploy with https://user:pass@example.com/release?access_token=abc#frag and sk_test_super_secret_value",
            permission: {
              endpoints: [
                "https://user:pass@example.com/private?token=abc#frag",
              ],
              __proto__: {
                polluted: true,
              },
            },
          },
        },
      }),
    );
    readFileSync
      .withArgs("/repo/.claude/skills/release/SKILL.md", "utf-8")
      .returns(
        [
          "---",
          "name: release",
          "description: Publish release notes",
          "metadata:",
          "  endpoint: https://user:pass@example.com/skill?token=abc#frag",
          "  apiKey: sk_test_skill_secret_value",
          "---",
          "Use the release workflow.",
        ].join("\n"),
      );
    const { communityAiConfigParser } = await esmock(
      "./communityAiConfigParser.js",
      {
        "node:fs": { readFileSync },
      },
    );

    const result = communityAiConfigParser.parse([
      "/repo/opencode.json",
      "/repo/.claude/skills/release/SKILL.md",
    ]);
    const agent = result.components.find(
      (component) => getProp(component, "cdx:file:kind") === "agent-config",
    );
    const skill = result.components.find(
      (component) => getProp(component, "cdx:file:kind") === "skill-file",
    );

    assert.strictEqual(
      getProp(agent, "cdx:agent:description"),
      "Deploy with https://example.com/release and [redacted]",
    );
    assert.strictEqual(
      getProp(agent, "cdx:agent:permission"),
      JSON.stringify({
        endpoints: ["https://example.com/private"],
      }),
    );
    assert.strictEqual(
      getProp(skill, "cdx:skill:metadata"),
      JSON.stringify({
        endpoint: "https://example.com/skill",
        apiKey: "[redacted]",
      }),
    );
  });

  it("detects additional community AI rule ecosystems", async () => {
    const readFileSync = sinon.stub();
    readFileSync
      .withArgs("/repo/.cursor/rules/review.mdc", "utf-8")
      .returns("# Review\nFocus on correctness and security.\n");
    readFileSync
      .withArgs("/repo/.gemini/commands/release.md", "utf-8")
      .returns(
        [
          "---",
          "description: Publish a release safely",
          "---",
          "# Release",
        ].join("\n"),
      );
    const { communityAiConfigParser } = await esmock(
      "./communityAiConfigParser.js",
      {
        "node:fs": { readFileSync },
      },
    );

    const result = communityAiConfigParser.parse([
      "/repo/.cursor/rules/review.mdc",
      "/repo/.gemini/commands/release.md",
    ]);

    assert.ok(
      result.components.some(
        (component) =>
          getProp(component, "cdx:agent:framework") === "cursor" &&
          getProp(component, "cdx:file:kind") === "agent-instructions",
      ),
    );
    assert.ok(
      result.components.some(
        (component) =>
          getProp(component, "cdx:agent:framework") === "gemini" &&
          getProp(component, "cdx:file:kind") === "custom-command",
      ),
    );
  });

  it("discovers Agent Skills, Claude plugins, and subagents", async () => {
    const readFileSync = sinon.stub();
    readFileSync
      .withArgs("/repo/skills/pdf-processing/SKILL.md", "utf-8")
      .returns(
        [
          "---",
          "name: pdf-processing",
          "description: Extract and summarize text from PDF documents on request.",
          "---",
          "# PDF processing",
          "Use pdftotext then summarize.",
        ].join("\n"),
      );
    readFileSync
      .withArgs("/repo/.codex/skills/lint/SKILL.md", "utf-8")
      .returns(
        [
          "---",
          "name: lint",
          "description: Run the project linter and report findings.",
          "---",
          "Run biome.",
        ].join("\n"),
      );
    readFileSync.withArgs("/repo/.claude-plugin/plugin.json", "utf-8").returns(
      JSON.stringify({
        name: "cdxgen-tools",
        version: "1.2.0",
        description: "SBOM helper commands",
        commands: ["sbom", "audit"],
        skills: { "sbom-fidelity": {} },
      }),
    );
    readFileSync
      .withArgs("/repo/.claude-plugin/marketplace.json", "utf-8")
      .returns(
        JSON.stringify({
          name: "cdxgen-plugins",
          plugins: [
            { name: "cdxgen-tools", description: "SBOM helpers" },
            { name: "extra", source: "./extra" },
          ],
        }),
      );
    readFileSync
      .withArgs("/repo/.claude/agents/reviewer.md", "utf-8")
      .returns(
        [
          "---",
          "name: reviewer",
          "description: Reviews diffs for regressions",
          "model: claude-sonnet-4-5",
          "tools: [Read, Grep]",
          "---",
          "Review carefully.",
        ].join("\n"),
      );
    const { communityAiConfigParser } = await esmock(
      "./communityAiConfigParser.js",
      {
        "node:fs": { readFileSync },
      },
    );

    const result = communityAiConfigParser.parse([
      "/repo/skills/pdf-processing/SKILL.md",
      "/repo/.codex/skills/lint/SKILL.md",
      "/repo/.claude-plugin/plugin.json",
      "/repo/.claude-plugin/marketplace.json",
      "/repo/.claude/agents/reviewer.md",
    ]);

    const genericSkill = result.components.find(
      (component) => getProp(component, "cdx:skill:name") === "pdf-processing",
    );
    assert.ok(genericSkill, "expected generic Agent Skills SKILL.md component");
    assert.strictEqual(
      getProp(genericSkill, "cdx:agent:framework"),
      "agent-skills",
    );
    assert.strictEqual(getProp(genericSkill, "cdx:skill:specValid"), "true");

    assert.ok(
      result.components.some(
        (component) =>
          getProp(component, "cdx:skill:name") === "lint" &&
          getProp(component, "cdx:agent:framework") === "codex",
      ),
      "expected Codex skill component",
    );

    const plugin = result.components.find(
      (component) => getProp(component, "cdx:file:kind") === "agent-plugin",
    );
    assert.ok(plugin, "expected plugin manifest component");
    assert.strictEqual(plugin.version, "1.2.0");
    assert.strictEqual(getProp(plugin, "cdx:plugin:commandCount"), "2");

    const listings = result.components.filter(
      (component) =>
        getProp(component, "cdx:file:kind") === "agent-plugin-listing",
    );
    assert.strictEqual(listings.length, 2, "expected two marketplace listings");

    const subagent = result.components.find(
      (component) => getProp(component, "cdx:agent:role") === "claude-subagent",
    );
    assert.ok(subagent, "expected Claude subagent component");
    assert.strictEqual(getProp(subagent, "cdx:agent:tools"), "Read,Grep");
  });
});
