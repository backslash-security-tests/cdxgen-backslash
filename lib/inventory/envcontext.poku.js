import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import esmock from "esmock";
import { assert, it } from "poku";
import sinon from "sinon";

import {
  getLedgerEvents,
  LEDGER_EVENT_IMPACTS,
  LEDGER_EVENT_KINDS,
} from "../core/buildLedger.js";
import { isWin } from "../managers/docker.js";
import {
  collectDotnetInfo,
  collectGccInfo,
  collectGoInfo,
  collectJavaInfo,
  collectNodeInfo,
  collectPythonInfo,
  collectRustInfo,
  collectSwiftInfo,
  getBranch,
  getOriginUrl,
  isSdkmanAvailable,
  isSdkmanToolAvailable,
  listFiles,
} from "./envcontext.js";

it("git tests", () => {
  assert.ok(getBranch());
  assert.ok(getOriginUrl());
  const files = listFiles();
  assert.ok(files.length > 10);
});

it("every toolchain collector answers with a platform component or nothing", () => {
  // Which toolchains a machine carries is not a property of cdxgen, so the
  // contract under test is the shape of the answer: a collector either
  // describes the tool it found or returns undefined, and never invents a
  // component for a tool that is absent.
  const collectors = [
    ["dotnet", collectDotnetInfo],
    ["python", collectPythonInfo],
    ["gcc", collectGccInfo],
    ["rustc", collectRustInfo],
    ["swift", collectSwiftInfo],
    ["java", collectJavaInfo],
    ["go", collectGoInfo],
  ];
  for (const [name, collect] of collectors) {
    const info = collect();
    if (info === undefined) {
      continue;
    }
    assert.equal(info.type, "platform", `${name} must report a platform type`);
    assert.equal(info.name, name, `${name} must name itself`);
    assert.ok(
      typeof info.version === "string" && info.version.length > 0,
      `${name} must report a non-empty version`,
    );
  }
  // The runtime running this test is by definition present, so the node
  // collector is the one that must always answer.
  const nodeInfo = collectNodeInfo();
  assert.ok(nodeInfo, "the running runtime must be detected");
  assert.equal(nodeInfo.type, "platform");
  assert.ok(typeof nodeInfo.version === "string" && nodeInfo.version.length);
});

it("sdkman tests", () => {
  if (process.env?.SDKMAN_VERSION) {
    assert.deepStrictEqual(isSdkmanAvailable(), true);
    assert.deepStrictEqual(isSdkmanToolAvailable("java", "23.0.2-tem"), true);
    // Version identifiers are directory names; absent versions must report
    // unavailable without touching the network.
    assert.deepStrictEqual(
      isSdkmanToolAvailable("maven", "0.0.0-not-installed"),
      false,
    );
  }
});

it("installSdkmanTool rejects unsafe version tokens before spawning", async () => {
  const spawnCalls = [];
  const { installSdkmanTool: installWithMock } = await esmock(
    "./envcontext.js",
    {},
    {
      "../core/fs.js": {
        MAX_BUFFER: 104857600,
        getTmpDir: () => tmpdir(),
        safeExistsSync: () => false,
        safeSpawnSync: (...args) => {
          spawnCalls.push(args);
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    },
  );
  for (const unsafeVersion of [
    "3.9.9;rm -rf",
    "$(whoami)",
    "9.9\nrm",
    "3.9.9`id`",
    "",
  ]) {
    assert.deepStrictEqual(
      installWithMock("maven", unsafeVersion),
      false,
      `${unsafeVersion} must be rejected`,
    );
  }
  assert.ok(
    spawnCalls.length === 0,
    "no shell command may run for unsafe version tokens",
  );
});

it("installSdkmanTool passes validated versions to sdk install", async () => {
  const spawnCalls = [];
  const candidatesDir = mkdtempSync(join(tmpdir(), "cdxgen-sdkman-test-"));
  const previousCandidatesDir = process.env.SDKMAN_CANDIDATES_DIR;
  process.env.SDKMAN_CANDIDATES_DIR = candidatesDir;
  try {
    const { installSdkmanTool: installWithMock } = await esmock(
      "./envcontext.js",
      {},
      {
        "../core/fs.js": {
          MAX_BUFFER: 104857600,
          getTmpDir: () => tmpdir(),
          safeExistsSync: () => false,
          safeSpawnSync: (...args) => {
            spawnCalls.push(args);
            return { status: 0, stdout: "", stderr: "" };
          },
        },
      },
    );
    if (!isWin) {
      assert.deepStrictEqual(installWithMock("maven", "3.9.9"), true);
      const shellCommand = `${spawnCalls[0][1].join(" ")}`;
      assert.ok(
        shellCommand.includes("sdk install maven 3.9.9"),
        `expected sdk install invocation, got: ${shellCommand}`,
      );
    }
  } finally {
    if (previousCandidatesDir === undefined) {
      delete process.env.SDKMAN_CANDIDATES_DIR;
    } else {
      process.env.SDKMAN_CANDIDATES_DIR = previousCandidatesDir;
    }
  }
});

it("version probes record tool.resolved ledger events", async () => {
  const ledgerEvents = [];
  const { collectGoInfo, collectJavaInfo, collectNodeInfo } = await esmock(
    "./envcontext.js",
    {},
    {
      "../core/buildLedger.js": {
        LEDGER_ENABLED: true,
        isLedgerEnabled: () => true,
        LEDGER_EVENT_KINDS,
        recordLedgerEvent: (kind, fields = {}) => {
          ledgerEvents.push({ kind, ...fields });
          return { kind, ...fields };
        },
      },
      "../core/fs.js": {
        MAX_BUFFER: 104857600,
        getTmpDir: () => tmpdir(),
        safeExistsSync: () => false,
        safeSpawnSync: (_cmd, args) => {
          if (args?.includes("--version") || args?.includes("version")) {
            return { status: 0, stdout: "tool version 1.2.3\n", stderr: "" };
          }
          return { status: 1, error: "not found", stdout: "", stderr: "" };
        },
      },
    },
  );
  const javaInfo = collectJavaInfo(tmpdir());
  assert.ok(javaInfo, "expected a java info object");
  const goInfo = collectGoInfo(tmpdir());
  assert.ok(goInfo, "expected a go info object");
  collectNodeInfo(tmpdir());
  const resolved = ledgerEvents.filter(
    (event) => event.kind === LEDGER_EVENT_KINDS.TOOL_RESOLVED,
  );
  assert.deepStrictEqual(
    resolved.map((event) => [event.ecosystem, event.tool, event.source]),
    [
      ["java", "java", "PATH"],
      ["go", "go", "PATH"],
      ["generic", "node", "runtime"],
      ["npm", "npm", "PATH"],
    ],
  );
  assert.strictEqual(resolved[0].found, "tool version 1.2.3");
});

it("a failed probe records tool.missing rather than degraded evidence", async () => {
  const ledgerEvents = [];
  const { collectJavaInfo } = await esmock(
    "./envcontext.js",
    {},
    {
      "../core/buildLedger.js": {
        LEDGER_ENABLED: true,
        isLedgerEnabled: () => true,
        LEDGER_EVENT_KINDS,
        recordLedgerEvent: (kind, fields = {}) => {
          ledgerEvents.push({ kind, ...fields });
          return { kind, ...fields };
        },
      },
      "../core/fs.js": {
        MAX_BUFFER: 104857600,
        getTmpDir: () => tmpdir(),
        safeExistsSync: () => false,
        safeSpawnSync: () => ({
          status: 1,
          error: "not found",
          stdout: "",
          stderr: "",
        }),
      },
    },
  );
  assert.strictEqual(collectJavaInfo(tmpdir()), undefined);
  assert.deepStrictEqual(
    ledgerEvents.map((event) => event.kind),
    [LEDGER_EVENT_KINDS.TOOL_MISSING],
  );
  assert.strictEqual(ledgerEvents[0].ecosystem, "java");
  assert.strictEqual(ledgerEvents[0].tool, "java");
  assert.strictEqual(ledgerEvents[0].source, "PATH");
});

it("a denied probe records evidence.degraded, never tool.missing", async () => {
  const ledgerEvents = [];
  const { collectJavaInfo } = await esmock(
    "./envcontext.js",
    {},
    {
      "./toolRequirements.js": {
        // Simulates what the real classifier reports under Deno with
        // restricted --allow-run, or under any other spawn restriction.
        describeSpawnRestriction: () =>
          "the Deno run permission is not granted for this command",
      },
      "../core/buildLedger.js": {
        LEDGER_ENABLED: true,
        isLedgerEnabled: () => true,
        LEDGER_EVENT_KINDS,
        recordLedgerEvent: (kind, fields = {}) => {
          ledgerEvents.push({ kind, ...fields });
          return { kind, ...fields };
        },
      },
      "../core/fs.js": {
        MAX_BUFFER: 104857600,
        getTmpDir: () => tmpdir(),
        safeExistsSync: () => false,
        safeSpawnSync: () => ({ status: 1, stdout: "", stderr: "" }),
      },
    },
  );
  assert.strictEqual(collectJavaInfo(tmpdir()), undefined);
  assert.deepStrictEqual(
    ledgerEvents.map((event) => event.kind),
    [LEDGER_EVENT_KINDS.EVIDENCE_DEGRADED],
  );
  assert.strictEqual(ledgerEvents[0].tool, "java");
  assert.match(ledgerEvents[0].detail, /could not run/);
});

it("a dry-run-denied probe records policy.dry-run with no impact", async () => {
  const ledgerEvents = [];
  const { collectJavaInfo } = await esmock(
    "./envcontext.js",
    {},
    {
      "./toolRequirements.js": {
        describeSpawnRestriction: () => "dry-run mode blocks command execution",
        classifySpawnRestriction: () => "dry-run",
      },
      "../core/buildLedger.js": {
        LEDGER_ENABLED: true,
        isLedgerEnabled: () => true,
        LEDGER_EVENT_KINDS,
        LEDGER_EVENT_IMPACTS,
        recordLedgerEvent: (kind, fields = {}) => {
          ledgerEvents.push({ kind, ...fields });
          return { kind, ...fields };
        },
      },
      "../core/fs.js": {
        MAX_BUFFER: 104857600,
        getTmpDir: () => tmpdir(),
        safeExistsSync: () => false,
        safeSpawnSync: () => ({ status: 1, stdout: "", stderr: "" }),
      },
    },
  );
  assert.strictEqual(collectJavaInfo(tmpdir()), undefined);
  assert.strictEqual(ledgerEvents[0].remediationId, "policy.dry-run");
  assert.strictEqual(ledgerEvents[0].impact, LEDGER_EVENT_IMPACTS.NONE);
});

it("a secure-mode-denied probe records policy.secure-mode with versions impact", async () => {
  const ledgerEvents = [];
  const { collectJavaInfo } = await esmock(
    "./envcontext.js",
    {},
    {
      "./toolRequirements.js": {
        describeSpawnRestriction: () =>
          "secure mode denies child process execution",
        classifySpawnRestriction: () => "secure-mode",
      },
      "../core/buildLedger.js": {
        LEDGER_ENABLED: true,
        isLedgerEnabled: () => true,
        LEDGER_EVENT_KINDS,
        LEDGER_EVENT_IMPACTS,
        recordLedgerEvent: (kind, fields = {}) => {
          ledgerEvents.push({ kind, ...fields });
          return { kind, ...fields };
        },
      },
      "../core/fs.js": {
        MAX_BUFFER: 104857600,
        getTmpDir: () => tmpdir(),
        safeExistsSync: () => false,
        safeSpawnSync: () => ({ status: 1, stdout: "", stderr: "" }),
      },
    },
  );
  assert.strictEqual(collectJavaInfo(tmpdir()), undefined);
  assert.strictEqual(ledgerEvents[0].remediationId, "policy.secure-mode");
  assert.strictEqual(ledgerEvents[0].impact, LEDGER_EVENT_IMPACTS.VERSIONS);
});

it("ruby installs record command.attempted and command.failed", async () => {
  const ledgerEvents = [];
  const { installRubyVersion } = await esmock(
    "./envcontext.js",
    {},
    {
      "../core/buildLedger.js": {
        LEDGER_ENABLED: true,
        isLedgerEnabled: () => true,
        LEDGER_EVENT_KINDS,
        recordLedgerEvent: (kind, fields = {}) => {
          ledgerEvents.push({ kind, ...fields });
          return { kind, ...fields };
        },
      },
      "../core/fs.js": {
        MAX_BUFFER: 104857600,
        getTmpDir: () => tmpdir(),
        safeExistsSync: () => false,
        safeSpawnSync: () => ({
          status: 1,
          error: "install failed",
          stdout: "",
          stderr: "",
        }),
      },
    },
  );
  const consoleStub = sinon.stub(console, "log");
  try {
    const result = installRubyVersion("3.3.6", tmpdir());
    assert.strictEqual(result.status, false);
  } finally {
    consoleStub.restore();
  }
  assert.deepStrictEqual(
    ledgerEvents.map((event) => [event.kind, event.tool]),
    [
      [LEDGER_EVENT_KINDS.TOOL_MISSING, "ruby"],
      [LEDGER_EVENT_KINDS.COMMAND_ATTEMPTED, "rbenv"],
      [LEDGER_EVENT_KINDS.COMMAND_FAILED, "rbenv"],
    ],
  );
});

it("bundle installs record command.attempted and command.failed", async () => {
  const ledgerEvents = [];
  const { performBundleInstall } = await esmock(
    "./envcontext.js",
    {},
    {
      "../core/buildLedger.js": {
        LEDGER_ENABLED: true,
        isLedgerEnabled: () => true,
        LEDGER_EVENT_KINDS,
        recordLedgerEvent: (kind, fields = {}) => {
          ledgerEvents.push({ kind, ...fields });
          return { kind, ...fields };
        },
      },
      "../core/fs.js": {
        MAX_BUFFER: 104857600,
        getTmpDir: () => tmpdir(),
        safeExistsSync: () => false,
        safeSpawnSync: () => ({
          status: 1,
          error: "bundle failed",
          stdout: "",
          stderr: "",
        }),
      },
    },
  );
  const consoleStub = sinon.stub(console, "log");
  try {
    const result = performBundleInstall(tmpdir(), "3.3.6", "bundle", tmpdir());
    assert.strictEqual(result, false);
  } finally {
    consoleStub.restore();
  }
  assert.deepStrictEqual(
    ledgerEvents.map((event) => [event.kind, event.tool]),
    [
      [LEDGER_EVENT_KINDS.COMMAND_ATTEMPTED, "bundler"],
      [LEDGER_EVENT_KINDS.COMMAND_FAILED, "bundler"],
    ],
  );
});

it("envcontext ledger recording stays inert when introspection is disabled", async () => {
  const { collectGoInfo } = await import("./envcontext.js");
  collectGoInfo(tmpdir());
  collectRustInfo(tmpdir());
  assert.deepStrictEqual(getLedgerEvents(), []);
});
