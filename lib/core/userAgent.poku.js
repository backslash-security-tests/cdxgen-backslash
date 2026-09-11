import { assert, describe, it } from "poku";

import {
  blockedUserAgentSubstring,
  defaultUserAgent,
  getUserAgent,
  registryKeyForHost,
  USER_AGENT_REGISTRY_KEYS,
} from "./userAgent.js";

const OVERRIDE_VARS = [
  "CDXGEN_CONTACT_EMAIL",
  "CDXGEN_USER_AGENT",
  ...USER_AGENT_REGISTRY_KEYS.map((key) => `CDXGEN_USER_AGENT_${key}`),
];

function withEnv(vars, fn) {
  const saved = new Map(OVERRIDE_VARS.map((name) => [name, process.env[name]]));
  for (const name of OVERRIDE_VARS) {
    delete process.env[name];
  }
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

describe("defaultUserAgent", () => {
  it("identifies cdxgen and offers a url and address as contact", () => {
    withEnv({}, () => {
      const ua = defaultUserAgent();
      assert.ok(ua.startsWith("cdxgen/"));
      assert.ok(ua.includes("+https://github.com/cdxgen/cdxgen"));
      // Packagist asks for `mailto=` specifically, not a mailto: url.
      assert.ok(ua.includes("mailto=cloud@appthreat.com"));
    });
  });

  it("avoids the forms registries reject", () => {
    withEnv({}, () => {
      const ua = defaultUserAgent();
      // crates.io blocks user-agents beginning `@CycloneDX/cdxgen` and any
      // carrying a known client-library name.
      assert.ok(!ua.startsWith("@"));
      assert.equal(blockedUserAgentSubstring(ua), undefined);
      // GitHub and search.maven.org reject an absent or empty value.
      assert.ok(ua.trim().length > 0);
    });
  });

  it("substitutes the address from CDXGEN_CONTACT_EMAIL", () => {
    withEnv({ CDXGEN_CONTACT_EMAIL: "team@example.org" }, () => {
      const ua = defaultUserAgent();
      assert.ok(ua.includes("mailto=team@example.org"));
      assert.ok(!ua.includes("cloud@appthreat.com"));
    });
  });

  it("keeps the project address when the override is blank", () => {
    withEnv({ CDXGEN_CONTACT_EMAIL: "   " }, () => {
      assert.ok(defaultUserAgent().includes("mailto=cloud@appthreat.com"));
    });
  });
});

describe("registryKeyForHost", () => {
  it("maps registry hosts and their subdomains", () => {
    assert.equal(registryKeyForHost("crates.io"), "CRATES");
    assert.equal(registryKeyForHost("static.crates.io"), "CRATES");
    assert.equal(registryKeyForHost("REGISTRY.NPMJS.ORG"), "NPM");
    assert.equal(registryKeyForHost("files.pythonhosted.org"), "PYPI");
    assert.equal(registryKeyForHost("repo1.maven.org"), "MAVEN");
    assert.equal(registryKeyForHost("api.github.com"), "GITHUB");
  });

  it("does not match lookalike hosts", () => {
    assert.equal(registryKeyForHost("evil-crates.io"), undefined);
    assert.equal(registryKeyForHost("crates.io.example.org"), undefined);
    assert.equal(registryKeyForHost(""), undefined);
    assert.equal(registryKeyForHost(undefined), undefined);
  });
});

describe("getUserAgent", () => {
  it("prefers a registry override over the global one", () => {
    withEnv(
      {
        CDXGEN_USER_AGENT: "global/1",
        CDXGEN_USER_AGENT_CRATES: "crates-only/2 (help@example.org)",
      },
      () => {
        assert.equal(
          getUserAgent("crates.io"),
          "crates-only/2 (help@example.org)",
        );
        assert.equal(getUserAgent("registry.npmjs.org"), "global/1");
        assert.equal(getUserAgent("example.invalid"), "global/1");
      },
    );
  });

  it("falls back to the default rather than sending a blank header", () => {
    withEnv({ CDXGEN_USER_AGENT: "   ", CDXGEN_USER_AGENT_NPM: "" }, () => {
      assert.equal(getUserAgent("registry.npmjs.org"), defaultUserAgent());
    });
  });

  it("resolves without a hostname", () => {
    withEnv({}, () => {
      assert.equal(getUserAgent(), defaultUserAgent());
    });
  });
});

describe("blockedUserAgentSubstring", () => {
  it("flags client-library names crates.io refuses, anywhere in the value", () => {
    assert.equal(blockedUserAgentSubstring("mycurl/8.7.1"), "curl");
    assert.equal(
      blockedUserAgentSubstring("python-requests/2.31.0"),
      "python-requests",
    );
    assert.equal(
      blockedUserAgentSubstring("Go-http-client/2.0"),
      "Go-http-client",
    );
  });

  it("passes acceptable values", () => {
    assert.equal(blockedUserAgentSubstring("cdxgen/13.0.0 (+url)"), undefined);
    assert.equal(blockedUserAgentSubstring(""), undefined);
  });
});
