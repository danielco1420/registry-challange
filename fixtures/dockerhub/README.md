# Docker Hub fixtures

Real Docker Hub response bodies, recorded live on **2026-11-02** without authentication, with our client's `User-Agent` (`registry-ui (+https://github.com/danielco1420/registry-challange)`) and `Accept: application/json`. Each body is saved as received, only pretty-printed by Prettier (no fields added, removed or edited).

Tests use them in two ways, so no test calls the real Docker Hub:

- **Contract tests** (RISKS.md 1.3): `app/server/dockerhub.schemas.server.test.ts` checks every file against its Valibot schema, and `app/server/normalize.server.test.ts` checks the DTOs we build from them.
- **MSW**: `test/msw/dockerhub.ts` imports them as `fixtures` and serves them from `dockerHubHandlers` (`server.use(...dockerHubHandlers)`), so the real client runs against them offline.

| File | Recorded from (`https://hub.docker.com` + …) | Why |
|---|---|---|
| `search-v4-popular.json` | `/api/search/v4?query=&from=0&size=10&sort=pull_count&order=desc&badges=official` | Popular 10 (`/api/popular`) |
| `search-v4-nginx.json` | `/api/search/v4?query=nginx&from=0&size=25` | A search; includes `dhi` and `extension` entries, `logo_url: {}`, empty descriptions |
| `search-v4-hello.json` | `/api/search/v4?query=hello&from=0&size=10` | Repos without a logo (`nginxdemos/hello`) |
| `search-v4-kernel528-archived.json` | `/api/search/v4?query=kernel528%2Farchived&from=0&size=5` | An archived repo (`archived: true`) |
| `search-v4-suggestions-ngi.json` | `/api/search/v4/suggestions?query=ngi` | Autocomplete |
| `search-legacy-nginx.json` | `/v2/search/repositories/?query=nginx&page=1&page_size=25` | Search fallback |
| `repo-library-nginx.json` | `/v2/namespaces/library/repositories/nginx` | Official image details |
| `repo-fluent-fluent-bit.json` | `/v2/namespaces/fluent/repositories/fluent-bit` | Non-official repo details |
| `repo-nginxdemos-hello.json` | `/v2/namespaces/nginxdemos/repositories/hello` | Repo without a logo |
| `repo-kernel528-archived.json` | `/v2/namespaces/kernel528/repositories/archived` | Archived repo (`status: 6`, `status_description: "archived"`) |
| `tags-library-nginx.json` | `/v2/namespaces/library/repositories/nginx/tags?page=1&page_size=10` | Multi-arch tags with attestation (`unknown`) entries |
| `tag-library-nginx-latest.json` | `/v2/namespaces/library/repositories/nginx/tags/latest` | Single tag |
| `tags-fluent-fluent-bit.json` | `/v2/namespaces/fluent/repositories/fluent-bit/tags?page=1&page_size=25&ordering=last_updated` | A repo with many tags (2,189), newest first, Windows images |
| `tags-fluent-fluent-bit-oldest.json` | `/v2/namespaces/fluent/repositories/fluent-bit/tags?page=1&page_size=25&ordering=-last_updated` | Oldest tags, `inactive` images |
| `tags-kernel528-archived.json` | `/v2/namespaces/kernel528/repositories/archived/tags?page=1&page_size=25` | Tags of an archived repo |
| `org-docker.json` | `/v2/orgs/docker` | Publisher (org) with avatar |
| `org-fluent.json` | `/v2/orgs/fluent` | Publisher (org); `/v2/users/fluent` answers `308` to here |
| `user-kernel528.json` | `/v2/users/kernel528` | Publisher (user) without avatar |
| `error-not-found.json` | `/v2/namespaces/library/repositories/this-repo-does-not-exist-t08` (HTTP 404) | Docker Hub's error body |

None of the recorded tags has `full_size: 0`; tests cover it (RISKS.md 4.3) by tweaking a copy of a real tag.

## Re-recording

When Docker Hub changes and a contract test fails, re-record the affected file with the URL above (keep requests few: the ~180 req/min limit is per IP), then run `pnpm format` and `pnpm test`, and update expectations, schemas and `docs/API.md` to match:

```bash
curl -s -A 'registry-ui (+https://github.com/danielco1420/registry-challange)' \
  -H 'Accept: application/json' \
  'https://hub.docker.com/v2/namespaces/library/repositories/nginx' \
  -o fixtures/dockerhub/repo-library-nginx.json
```
