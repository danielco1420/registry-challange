import { describe, expect, it } from 'vitest';
import {
  API_CSP,
  BASE_SECURITY_HEADERS,
  createNonce,
  documentCsp,
  securityHeadersMiddleware,
  setDocumentSecurityHeaders,
  withSecurityHeaders,
} from './securityHeaders.server';

/** Splits a CSP into `{ directive: value }`. */
function directives(csp: string): Record<string, string> {
  return Object.fromEntries(
    csp.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values.join(' ')];
    }),
  );
}

function expectBaseHeaders(headers: Headers) {
  expect(headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
  expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
}

describe('createNonce', () => {
  it('returns 128 random bits in base64, different every call', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
    }
  });
});

describe('documentCsp', () => {
  it('allows scripts only from our origin or with the nonce', () => {
    expect(directives(documentCsp('abc'))).toEqual({
      'default-src': "'self'",
      'script-src': "'self' 'nonce-abc'",
      'img-src': "'self' https://*.cloudfront.net https://www.gravatar.com",
      'object-src': "'none'",
      'base-uri': "'self'",
      'form-action': "'self'",
      'frame-ancestors': "'none'",
    });
  });

  it("never allows 'unsafe-inline' or 'unsafe-eval' scripts", () => {
    for (const dev of [false, true]) {
      expect(directives(documentCsp('abc', { dev }))['script-src']).not.toMatch(/unsafe/);
    }
  });

  it("allows inline styles only in dev, for Vite's injected CSS", () => {
    expect(directives(documentCsp('abc'))['style-src']).toBeUndefined();
    expect(directives(documentCsp('abc', { dev: true }))['style-src']).toBe(
      "'self' 'unsafe-inline'",
    );
  });
});

describe('setDocumentSecurityHeaders', () => {
  it('sets the page CSP with the nonce and the base headers', () => {
    const headers = new Headers({ 'Content-Type': 'text/html' });
    setDocumentSecurityHeaders(headers, 'n0nce');
    expect(headers.get('Content-Security-Policy')).toBe(documentCsp('n0nce'));
    expectBaseHeaders(headers);
    expect(headers.get('Content-Type')).toBe('text/html');
  });
});

describe('withSecurityHeaders', () => {
  it('gives a JSON response the locked-down API CSP and the base headers', async () => {
    const response = withSecurityHeaders(
      Response.json({ ok: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } }),
    );
    expect(response.headers.get('Content-Security-Policy')).toBe(API_CSP);
    expectBaseHeaders(response.headers);
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });
  });

  it("keeps a document's CSP", () => {
    const headers = new Headers({ 'Content-Type': 'text/html' });
    setDocumentSecurityHeaders(headers, 'n0nce');
    const response = withSecurityHeaders(new Response('<p>hi</p>', { headers }));
    expect(response.headers.get('Content-Security-Policy')).toBe(documentCsp('n0nce'));
  });

  it('overrides weaker base headers set by a route', () => {
    const response = withSecurityHeaders(
      new Response('x', { headers: { 'Referrer-Policy': 'unsafe-url' } }),
    );
    expect(response.headers.get('Referrer-Policy')).toBe(BASE_SECURITY_HEADERS['Referrer-Policy']);
  });

  it('copies a response whose headers are immutable', async () => {
    const original = Response.redirect('http://localhost/elsewhere', 302);
    expect(() => original.headers.set('X-Test', '1')).toThrow();

    const response = withSecurityHeaders(original);
    expect(response).not.toBe(original);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('http://localhost/elsewhere');
    expect(response.headers.get('Content-Security-Policy')).toBe(API_CSP);
    expectBaseHeaders(response.headers);
  });
});

describe('securityHeadersMiddleware', () => {
  it('adds the headers to the response from the rest of the chain', async () => {
    const args = {} as Parameters<typeof securityHeadersMiddleware>[0];
    const response = await securityHeadersMiddleware(args, async () =>
      Response.json({ status: 'ok' }),
    );
    expect(response).toBeInstanceOf(Response);
    const headers = (response as Response).headers;
    expect(headers.get('Content-Security-Policy')).toBe(API_CSP);
    expectBaseHeaders(headers);
  });
});
