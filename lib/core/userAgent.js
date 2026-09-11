/**
 * Outbound `user-agent` construction.
 *
 * Package registries police automated traffic through this header, and their
 * requirements differ. GitHub rejects an absent one with a 403; crates.io
 * rejects an absent one and additionally blocks a configurable list of exact
 * strings and prefixes at the CDN edge; Packagist asks for a `mailto=` contact;
 * PyPI asks for a value that uniquely identifies the consumer, with contact
 * information; pub.dev documents a `name/version (+url)` shape. The default
 * built here satisfies all of them at once.
 *
 * Two escape hatches exist for operators whose traffic a registry has taken
 * issue with: `CDXGEN_USER_AGENT` replaces the header everywhere, and
 * `CDXGEN_USER_AGENT_<REGISTRY>` replaces it for one destination.
 */

import { CDXGEN_VERSION } from "./state.js";

/** Project home page offered as the contact URL in the default user-agent. */
const CDXGEN_HOME_URL = "https://github.com/cdxgen/cdxgen";

/**
 * Contact address offered in the default user-agent. Packagist asks API
 * consumers to include one so an operator can reach the project rather than
 * block its traffic; crates.io and PyPI make the same recommendation.
 * Overridable with CDXGEN_CONTACT_EMAIL.
 */
const CDXGEN_CONTACT_EMAIL = "cloud@appthreat.com";

/**
 * Registry keys and the hosts they cover, used to resolve the
 * `CDXGEN_USER_AGENT_<REGISTRY>` override for a request. A host matches its
 * entry exactly or as a subdomain of it.
 */
const REGISTRY_HOSTS = Object.freeze({
  CRATES: ["crates.io", "static.crates.io", "index.crates.io"],
  DOCKER: ["docker.io", "docker.com"],
  GITHUB: ["github.com", "githubusercontent.com", "ghcr.io"],
  GITLAB: ["gitlab.com"],
  GOPROXY: ["proxy.golang.org", "sum.golang.org", "pkg.go.dev"],
  HUGGINGFACE: ["huggingface.co"],
  JSR: ["jsr.io"],
  MAVEN: [
    "repo1.maven.org",
    "repo.maven.apache.org",
    "search.maven.org",
    "central.sonatype.com",
    "oss.sonatype.org",
  ],
  NPM: ["registry.npmjs.org", "npmjs.org", "npmjs.com"],
  NUGET: ["nuget.org"],
  PACKAGIST: ["packagist.org"],
  PUB: ["pub.dev"],
  PYPI: ["pypi.org", "pythonhosted.org"],
  RUBYGEMS: ["rubygems.org"],
});

/**
 * Substrings that crates.io blocks at the edge, taken from the client
 * libraries its middleware singles out. A user-agent containing one of these
 * is refused with an empty-bodied 403, so an override carrying one would fail
 * silently against that registry.
 */
const BLOCKED_SUBSTRINGS = Object.freeze([
  "curl",
  "python-requests",
  "Go-http-client",
]);

/**
 * The registry key covering a host, if any.
 *
 * @param {String} hostname Lower-case hostname of the request
 * @returns {String|undefined} Registry key such as `CRATES`, or undefined
 */
export function registryKeyForHost(hostname) {
  if (!hostname) {
    return undefined;
  }
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const [key, hosts] of Object.entries(REGISTRY_HOSTS)) {
    for (const candidate of hosts) {
      if (host === candidate || host.endsWith(`.${candidate}`)) {
        return key;
      }
    }
  }
  return undefined;
}

/**
 * The default user-agent: `cdxgen/<version> (+<home url>; mailto=<address>)`.
 * Setting CDXGEN_CONTACT_EMAIL substitutes a different address, which is what
 * an operator running cdxgen at scale should do so that a registry contacts
 * them rather than the project.
 *
 * The `@scope/name` npm spelling is deliberately avoided. crates.io blocks
 * user-agents beginning `@CycloneDX/cdxgen` outright, and a leading `@` is
 * unusual enough elsewhere to invite the same treatment.
 *
 * @returns {String} Default user-agent for outbound requests
 */
export function defaultUserAgent() {
  const email =
    (process.env.CDXGEN_CONTACT_EMAIL || "").trim() || CDXGEN_CONTACT_EMAIL;
  return `cdxgen/${CDXGEN_VERSION} (+${CDXGEN_HOME_URL}; mailto=${email})`;
}

/**
 * The user-agent to send to a host. A `CDXGEN_USER_AGENT_<REGISTRY>` override
 * wins for the hosts of that registry, then the global `CDXGEN_USER_AGENT`,
 * then the default. Blank overrides are ignored: several registries reject an
 * empty header outright, so falling back is safer than honouring it.
 *
 * @param {String} [hostname] Hostname the request is bound for
 * @returns {String} User-agent header value
 */
export function getUserAgent(hostname) {
  const key = registryKeyForHost(hostname);
  const perRegistry = key
    ? (process.env[`CDXGEN_USER_AGENT_${key}`] || "").trim()
    : "";
  if (perRegistry) {
    return perRegistry;
  }
  const global = (process.env.CDXGEN_USER_AGENT || "").trim();
  return global || defaultUserAgent();
}

/**
 * Whether a user-agent carries a substring that crates.io blocks. Useful for
 * warning an operator whose override would be refused there.
 *
 * @param {String} userAgent User-agent value to test
 * @returns {String|undefined} The offending substring, or undefined
 */
export function blockedUserAgentSubstring(userAgent) {
  if (!userAgent) {
    return undefined;
  }
  const lowered = userAgent.toLowerCase();
  return BLOCKED_SUBSTRINGS.find((candidate) =>
    lowered.includes(candidate.toLowerCase()),
  );
}

/** Registry keys that `CDXGEN_USER_AGENT_<REGISTRY>` accepts. */
export const USER_AGENT_REGISTRY_KEYS = Object.freeze(
  Object.keys(REGISTRY_HOSTS),
);
