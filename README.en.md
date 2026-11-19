# free-dsh-search

[![ci](https://github.com/Wuyueyu-ovo/free-dsh-search/actions/workflows/ci.yml/badge.svg)](https://github.com/Wuyueyu-ovo/free-dsh-search/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)

Free-tier web search providers for [DeepSeek Harness](https://www.deepseek.com/harness) (DSH): Tavily, Serper, Exa, Firecrawl and LangSearch, with **priority-based fallback** — a stand-in for the paid DeepSeek Search API.

DSH resolves web search through the pluggable `ctx.web` seam. This bundle registers providers into it, so they appear in **Plugins → Web search and fetch**. It modifies no shipped dsh file and overrides no deployment composition.

## Providers

| Provider id | Service | Free tier (check the vendor site) | Credential ref |
|---|---|---|---|
| `free-search` | **Aggregate (recommended)**: tries providers by your priority, falls back on failure | — | — |
| `tavily` | [Tavily](https://tavily.com) | about 1,000 searches/month | `TAVILY_API_KEY` |
| `serper` | [Serper](https://serper.dev) (Google results) | 2,500 one-time | `SERPER_API_KEY` |
| `exa` | [Exa](https://exa.ai) neural search | sign-up credits + small monthly | `EXA_API_KEY` |
| `firecrawl` | [Firecrawl](https://firecrawl.dev) | monthly free credits | `FIRECRAWL_API_KEY` |
| `langsearch` | [LangSearch](https://langsearch.com) | free plan | `LANGSEARCH_API_KEY` |

One key is enough; the aggregate provider only uses providers that have a key.

## Install

Plain JavaScript, no build step, no runtime dependencies.

- **UI**: Plugins → **Add plugin**, pick this directory.
- **CLI**: `dsh plugin --profile <profile> add <path>`, then enable the bundle (subcommands vary by dsh version; check `dsh plugin --help`).
- **Verified here**: plugin manager `install_bundle` with the repository path.

## Usage

1. **Plugins → Free web search**: paste at least one API key and save (stored in the local credential store; effective immediately).
2. **Test all** or a single **Test**: one real minimal search per provider (costs one quota unit) reporting `Up · xxxms · n hits` or `Down` with a reason.
3. **Use this plugin** points `web.searchProvider` at this bundle. You can also pick `Free search (auto)` or one concrete service in **Plugins → Web search and fetch**.

### Fallback and priority

- With `Free search (auto)` selected, providers are tried in the panel's order; network errors, 401, 429 and response-parsing failures fall through to the next one. **Cancellation never falls back.**
- When every provider fails, one aggregated error lists each reason; with no key at all, it says so.
- ↑ ↓ reorders providers; the order persists in `$DSH_HOME/free-dsh-search/state.json`.
- On first activation, if the search provider is still a native dsh one (`deepseek-search-api` / `deepseek-official`) and at least one key exists, the plugin adopts it once; your later choice is never overridden.

### Where keys live

Resolved through `ctx.credentials`, in this order: credential store (`$DSH_HOME/.credentials.yaml`) › launch environment › project `.env` › `$DSH_HOME/.env`. Env vars such as `TAVILY_API_KEY` work too.

## Compatibility

A DSH "version" and a DSH "surface" are separate things. This bundle has two halves: the Host half (registers providers, needed everywhere) and the Client half (the panel in the Plugins page, Web UI only).

### Versions

| Range | Status |
|---|---|
| `0.2.2-rc.3` | **Verified** (every item below checked) |
| `0.2.2-rc.5` | **Verified**: real searches, fallback chain, source annotation, `lastProvider` persistence and the panel's test RPC all pass |
| Later `0.2.x` releases such as `0.2.2` / `0.2.3-rc.x` | Installs (`engines.dsh: ^0.2.2-rc.3`), unverified |
| `0.3.0` and newer | Refused by `engines.dsh`; a per-profile version exemption is required |

The range is evaluated by dsh itself with `semver.satisfies(..., { includePrerelease: true })`, so prereleases on the 0.2 line are not rejected. It describes the whole 0.2 line, not per-release testing — re-run the checklist below after upgrading.

Since `0.2.2-rc.4` the shipped base composition no longer pins `web.searchProvider` to `deepseek-search-api`; the default is route-based auto-selection (Messages search on DeepSeek model routes). A profile that already pins `free-search` is unaffected. With nothing pinned, the seam silently prefers DeepSeek's providers instead of raising an ambiguity error — exactly the new default (`undefined`) this plugin's one-time adoption covers.

### Surfaces and platforms

| Surface | Search (Host) | Panel (Client) | Status |
|---|---|---|---|
| **Desktop · Windows** (Electron, packed in `app.asar`) | ✅ | ✅ | **Verified** fully on 0.2.2-rc.3 and 0.2.2-rc.5 |
| **Desktop · macOS** | should work | should work | **Not tested**. Same packaging, no platform-specific code; if `@deepseek-ai/dsh-web` cannot be resolved inside the archive, errors degrade to a local class that still carries `code` |
| **Web (`dsh web` / npm install, browser)** | ✅ | ✅ | **Not tested**. Only the install layout differs (no asar); in a nested pnpm layout resolution falls back as above |
| **Headless CLI (headless / ACP / SDK profiles)** | ✅ when a `web` service row exists | ❌ no browser surface | Put keys in `$DSH_HOME/.credentials.yaml` or the environment and pin `searchProvider` in the profile config |

Notes:

- Node: the plugin needs `>=22.19.0`; dsh 0.2.2-rc.3 itself requires `>=24.9.0`, so dsh decides in practice.
- Without a `web` service (minimal headless compositions) the plugin stays inactive through `inject: ['web']` — no error, no half-applied state.
- The only Windows/macOS difference that could matter is how dsh's own packages resolve from `DSH_INSTALL_DIR`; both are supported and failures degrade safely.

### Re-check after upgrading DSH

1. `ctx.web.registerSearchProvider()` and the `WebSearchProvider` contract;
2. exact Fetch routes via `ctx.connection.fetch.register()` plus the `client-request` / `server-response` envelopes (test / order / adopt);
3. the client `plugins.bundle.config` slot and its `view` / `form` props (the panel);
4. `configEditor.configuration()` / `edit()` and `web.searchProvider` still being volatile (the adopt action).

`node scripts/selftest.mjs` cannot detect breakage of items 1–4: also click **Test all** in the panel and run one real search.

## Limitations

- The seam passes only `query` and `maxResults`; recency, domain and depth controls are not available.
- 30 s search timeout (15 s for tests), result cap 20 (default 5), redirects treated as failures.
- One provider serves a request; fallback happens inside `free-search`, with no result merging.
- `available()` is a synchronous check and cannot see the credential store, so a wrong key is only caught by an actual search.
- FreeSerp is not supported (no stable public API docs); Firecrawl's keyless mode is not wired up yet.

## Development

```sh
node scripts/selftest.mjs   # or npm test
```

Offline, no network and no quota: `fetch` and the credential service are stubbed, covering response normalization for all five vendors (including Firecrawl v1/v2 shapes), headers and bodies, result caps, `ready()`, and the missing-key / 401 / network / empty-result / fallback / all-failed / no-key / cancellation paths.

## License

[MIT](LICENSE)
