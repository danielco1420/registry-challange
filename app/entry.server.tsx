// Validate the env config first, so a bad config aborts startup when the server
// build loads instead of failing on the first request that needs it.
import './server/config.server';

// The rest is React Router's default Node entry
// (@react-router/dev/dist/config/defaults/entry.server.node.tsx), plus the
// security headers and CSP nonce (see app/server/securityHeaders.server.ts).
import { PassThrough } from 'node:stream';

import type { EntryContext } from 'react-router';
import { createReadableStreamFromReadable } from '@react-router/node';
import { ServerRouter } from 'react-router';
import { isbot } from 'isbot';
import type { RenderToPipeableStreamOptions } from 'react-dom/server';
import { renderToPipeableStream } from 'react-dom/server';
import { createNonce, setDocumentSecurityHeaders } from './server/securityHeaders.server';

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  // A fresh nonce per document. Only inline scripts carrying it can run.
  const nonce = createNonce();
  setDocumentSecurityHeaders(responseHeaders, nonce, { dev: import.meta.env.DEV });
  // The HTML depends on the theme cookie (`<html class>`, app/root.tsx), so a
  // shared cache must never serve one visitor's page to another.
  responseHeaders.append('Vary', 'Cookie');

  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get('user-agent');

    // Bots and SPA Mode renders wait for all content to load before responding.
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? 'onAllReady' : 'onShellReady';

    // Abort the rendering stream after `streamTimeout` so it has time to
    // flush down the rejected boundaries.
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    );

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              // Clear the timeout to avoid retaining the closure.
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set('Content-Type', 'text/html');

          pipe(body);

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming errors from inside the shell. Shell errors reject and
          // are logged by handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );
  });
}
