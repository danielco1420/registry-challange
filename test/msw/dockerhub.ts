/**
 * MSW handlers that answer Docker Hub requests with the recorded responses in
 * `fixtures/dockerhub/` (see its README for the source URL of each file), so
 * tests exercise the real client, schemas and normalizers offline.
 *
 * Add them in a test with `server.use(...dockerHubHandlers)`; requests they
 * don't cover still fail through `failOnUnhandledRemoteRequest`. A repository,
 * tag or publisher without a fixture gets Docker Hub's real 404 body.
 */
import { http, HttpResponse, type JsonBodyType } from 'msw';
import errorNotFound from '../../fixtures/dockerhub/error-not-found.json';
import orgDocker from '../../fixtures/dockerhub/org-docker.json';
import orgFluent from '../../fixtures/dockerhub/org-fluent.json';
import repoFluentBit from '../../fixtures/dockerhub/repo-fluent-fluent-bit.json';
import repoKernel528Archived from '../../fixtures/dockerhub/repo-kernel528-archived.json';
import repoNginx from '../../fixtures/dockerhub/repo-library-nginx.json';
import repoNginxdemosHello from '../../fixtures/dockerhub/repo-nginxdemos-hello.json';
import searchLegacyNginx from '../../fixtures/dockerhub/search-legacy-nginx.json';
import searchV4Hello from '../../fixtures/dockerhub/search-v4-hello.json';
import searchV4Kernel528Archived from '../../fixtures/dockerhub/search-v4-kernel528-archived.json';
import searchV4Nginx from '../../fixtures/dockerhub/search-v4-nginx.json';
import searchV4Popular from '../../fixtures/dockerhub/search-v4-popular.json';
import searchV4SuggestionsNgi from '../../fixtures/dockerhub/search-v4-suggestions-ngi.json';
import tagNginxLatest from '../../fixtures/dockerhub/tag-library-nginx-latest.json';
import tagsFluentBitOldest from '../../fixtures/dockerhub/tags-fluent-fluent-bit-oldest.json';
import tagsFluentBit from '../../fixtures/dockerhub/tags-fluent-fluent-bit.json';
import tagsKernel528Archived from '../../fixtures/dockerhub/tags-kernel528-archived.json';
import tagsNginx from '../../fixtures/dockerhub/tags-library-nginx.json';
import userKernel528 from '../../fixtures/dockerhub/user-kernel528.json';

export const HUB = 'https://hub.docker.com';

/** Every recorded body, by name. Tests may read these but must not mutate them (clone first). */
export const fixtures = {
  errorNotFound,
  orgDocker,
  orgFluent,
  repoFluentBit,
  repoKernel528Archived,
  repoNginx,
  repoNginxdemosHello,
  searchLegacyNginx,
  searchV4Hello,
  searchV4Kernel528Archived,
  searchV4Nginx,
  searchV4Popular,
  searchV4SuggestionsNgi,
  tagNginxLatest,
  tagsFluentBit,
  tagsFluentBitOldest,
  tagsKernel528Archived,
  tagsNginx,
  userKernel528,
};

/** A deep copy, for tests that tweak a fixture to simulate upstream drift. */
export const cloneFixture = <T>(fixture: T): T => structuredClone(fixture);

const notFound = () => HttpResponse.json(errorNotFound, { status: 404 });
const found = (body: JsonBodyType | undefined) => (body ? HttpResponse.json(body) : notFound());

const repositories: Record<string, JsonBodyType> = {
  'library/nginx': repoNginx,
  'fluent/fluent-bit': repoFluentBit,
  'nginxdemos/hello': repoNginxdemosHello,
  'kernel528/archived': repoKernel528Archived,
};

const orgs: Record<string, JsonBodyType> = { docker: orgDocker, fluent: orgFluent };

const v4Searches: Record<string, JsonBodyType> = {
  nginx: searchV4Nginx,
  hello: searchV4Hello,
  'kernel528/archived': searchV4Kernel528Archived,
};

export const dockerHubHandlers = [
  http.get(`${HUB}/api/search/v4`, ({ request }) => {
    const params = new URL(request.url).searchParams;
    const query = params.get('query') ?? '';
    if (query === '' && params.get('badges') === 'official')
      return HttpResponse.json(searchV4Popular);
    return found(v4Searches[query] ?? { ...searchV4Nginx, total: 0, results: [] });
  }),
  http.get(`${HUB}/api/search/v4/suggestions`, () => HttpResponse.json(searchV4SuggestionsNgi)),
  http.get(`${HUB}/v2/search/repositories/`, ({ request }) => {
    const query = new URL(request.url).searchParams.get('query');
    return HttpResponse.json(
      query === 'nginx' ? searchLegacyNginx : { count: 0, next: '', previous: '', results: [] },
    );
  }),
  http.get(`${HUB}/v2/namespaces/:ns/repositories/:repo`, ({ params }) =>
    found(repositories[`${String(params.ns)}/${String(params.repo)}`]),
  ),
  http.get(`${HUB}/v2/namespaces/:ns/repositories/:repo/tags`, ({ params, request }) => {
    const key = `${String(params.ns)}/${String(params.repo)}`;
    const ordering = new URL(request.url).searchParams.get('ordering');
    if (key === 'fluent/fluent-bit') {
      return HttpResponse.json(ordering === '-last_updated' ? tagsFluentBitOldest : tagsFluentBit);
    }
    if (key === 'library/nginx') return HttpResponse.json(tagsNginx);
    if (key === 'kernel528/archived') return HttpResponse.json(tagsKernel528Archived);
    return notFound();
  }),
  http.get(`${HUB}/v2/namespaces/:ns/repositories/:repo/tags/:tag`, ({ params }) =>
    found(
      `${String(params.ns)}/${String(params.repo)}:${String(params.tag)}` === 'library/nginx:latest'
        ? tagNginxLatest
        : undefined,
    ),
  ),
  http.get(`${HUB}/v2/orgs/:name`, ({ params }) => found(orgs[String(params.name)])),
  http.get(`${HUB}/v2/users/:name`, ({ params }) =>
    found(params.name === 'kernel528' ? userKernel528 : undefined),
  ),
];
