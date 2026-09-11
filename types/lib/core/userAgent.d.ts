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
/**
 * The registry key covering a host, if any.
 *
 * @param {String} hostname Lower-case hostname of the request
 * @returns {String|undefined} Registry key such as `CRATES`, or undefined
 */
export declare function registryKeyForHost(hostname: string): string | undefined;
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
export declare function defaultUserAgent(): string;
/**
 * The user-agent to send to a host. A `CDXGEN_USER_AGENT_<REGISTRY>` override
 * wins for the hosts of that registry, then the global `CDXGEN_USER_AGENT`,
 * then the default. Blank overrides are ignored: several registries reject an
 * empty header outright, so falling back is safer than honouring it.
 *
 * @param {String} [hostname] Hostname the request is bound for
 * @returns {String} User-agent header value
 */
export declare function getUserAgent(hostname?: string): string;
/**
 * Whether a user-agent carries a substring that crates.io blocks. Useful for
 * warning an operator whose override would be refused there.
 *
 * @param {String} userAgent User-agent value to test
 * @returns {String|undefined} The offending substring, or undefined
 */
export declare function blockedUserAgentSubstring(userAgent: string): string | undefined;
/** Registry keys that `CDXGEN_USER_AGENT_<REGISTRY>` accepts. */
export declare const USER_AGENT_REGISTRY_KEYS: readonly string[];
//# sourceMappingURL=userAgent.d.ts.map