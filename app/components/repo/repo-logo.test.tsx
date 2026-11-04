import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Publisher } from '~/lib/dto';

import { server } from '../../../test/msw/server';
import { RepoLogo } from './repo-logo';
import { clearPublisherAvatarCache } from './use-publisher-avatar';

const LOGO = 'https://d1q6f0aelx0por.cloudfront.net/product-logos/fluent-bit.png';
const AVATAR = 'https://www.gravatar.com/avatar/abc?s=80&r=g&d=mm';

const FLUENT: Publisher = {
  name: 'fluent',
  displayName: 'Fluent',
  kind: 'organization',
  avatarUrl: AVATAR,
  badge: 'open_source',
};

/** Serves `/api/publishers/:name` and records the names asked for. */
function publisherApi(respond: (name: string) => Response = () => HttpResponse.json(FLUENT)) {
  const requested: string[] = [];
  server.use(
    http.get('*/api/publishers/:name', ({ params }) => {
      const name = String(params.name);
      requested.push(name);
      return respond(name);
    }),
  );
  return requested;
}

/** Every `<img>` in the container (they have `alt=""`, so no `img` role). */
function images(container: HTMLElement) {
  return [...container.querySelectorAll('img')];
}

beforeEach(() => clearPublisherAvatarCache());

afterEach(() => vi.restoreAllMocks());

describe('RepoLogo', () => {
  it('shows the logo without a referrer, as a decorative image, and looks nothing up', () => {
    const requested = publisherApi();
    const { container } = render(<RepoLogo namespace="fluent" name="fluent-bit" logoUrl={LOGO} />);

    const [img] = images(container);
    expect(img).toHaveAttribute('src', LOGO);
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveAttribute('alt', '');
    expect(requested).toEqual([]);
  });

  it('falls back to the publisher avatar when the logo fails, then to initials', async () => {
    const requested = publisherApi();
    const { container } = render(<RepoLogo namespace="fluent" name="fluent-bit" logoUrl={LOGO} />);

    fireEvent.error(images(container)[0]!);
    // Initials while the avatar loads, never an empty tile.
    expect(screen.getByText('FB')).toHaveAttribute('aria-hidden', 'true');

    await waitFor(() => expect(images(container)[0]).toHaveAttribute('src', AVATAR));
    expect(images(container)[0]).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(requested).toEqual(['fluent']);

    fireEvent.error(images(container)[0]!);
    expect(images(container)).toHaveLength(0);
    expect(screen.getByText('FB')).toBeInTheDocument();
  });

  it('looks up the avatar when there is no logo', async () => {
    const requested = publisherApi();
    const { container } = render(<RepoLogo namespace="fluent" name="fluent-bit" />);

    expect(screen.getByText('FB')).toBeInTheDocument();
    await waitFor(() => expect(images(container)[0]).toHaveAttribute('src', AVATAR));
    expect(requested).toEqual(['fluent']);
  });

  it.each([
    ['the publisher is not found', () => HttpResponse.json({ error: {} }, { status: 404 })],
    ['Docker Hub is unavailable', () => HttpResponse.json({ error: {} }, { status: 503 })],
    ['the request fails', () => HttpResponse.error()],
    ['the publisher has no avatar', () => HttpResponse.json({ ...FLUENT, avatarUrl: undefined })],
    [
      'the avatar is not https',
      () => HttpResponse.json({ ...FLUENT, avatarUrl: 'http://x.test/a' }),
    ],
  ])('keeps the initials when %s', async (_case, respond) => {
    const requested = publisherApi(respond);
    const { container } = render(<RepoLogo namespace="fluent" name="fluent-bit" />);

    await waitFor(() => expect(requested).toEqual(['fluent']));
    // Let the response settle; the initials must still be there.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(images(container)).toHaveLength(0);
    expect(screen.getByText('FB')).toBeInTheDocument();
  });

  it('asks once per publisher for many logos, and again after a failed lookup', async () => {
    let status = 503;
    const requested = publisherApi(() =>
      status === 200 ? HttpResponse.json(FLUENT) : HttpResponse.json({}, { status }),
    );
    const first = render(
      <>
        <RepoLogo namespace="fluent" name="fluent-bit" />
        <RepoLogo namespace="fluent" name="fluentd" />
      </>,
    );
    await waitFor(() => expect(requested).toEqual(['fluent']));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(images(first.container)).toHaveLength(0);
    first.unmount();

    // The 503 wasn't kept, so the next mount retries; the success is kept.
    status = 200;
    const second = render(<RepoLogo namespace="fluent" name="fluent-bit" />);
    await waitFor(() => expect(images(second.container)).toHaveLength(1));
    second.unmount();
    const third = render(<RepoLogo namespace="fluent" name="fluent-bit" />);
    await waitFor(() => expect(images(third.container)).toHaveLength(1));
    expect(requested).toEqual(['fluent', 'fluent']);
  });

  it('uses an avatar the caller supplies instead of looking it up', () => {
    const requested = publisherApi();
    const { container } = render(
      <RepoLogo namespace="fluent" name="fluent-bit" avatarUrl={AVATAR} />,
    );

    expect(images(container)[0]).toHaveAttribute('src', AVATAR);
    expect(requested).toEqual([]);
  });

  it('shows initials straight away when the caller says there is no avatar', async () => {
    const requested = publisherApi();
    render(<RepoLogo namespace="fluent" name="fluent-bit" avatarUrl={null} />);

    expect(screen.getByText('FB')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requested).toEqual([]);
  });

  it('treats a logo that failed before hydration as failed', async () => {
    const requested = publisherApi();
    // A broken image that finished loading before React attached `onError`.
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
    const { container } = render(<RepoLogo namespace="fluent" name="fluent-bit" logoUrl={LOGO} />);

    // The logo is dropped, so the avatar is looked up; it's "broken" too here,
    // so the initials win.
    await waitFor(() => expect(requested).toEqual(['fluent']));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitFor(() => expect(images(container)).toHaveLength(0));
    expect(screen.getByText('FB')).toBeInTheDocument();
  });

  it.each([
    ['rejects (broken)', () => Promise.reject(new DOMException('Broken', 'EncodingError')), 0],
    ['resolves (an SVG without intrinsic size)', () => Promise.resolve(), 1],
  ])(
    'asks decode() about a 0-width logo when the browser has it: %s',
    async (_case, decode, kept) => {
      const requested = publisherApi(() => HttpResponse.json({ error: {} }, { status: 404 }));
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
      // jsdom has no `decode()`; give it one for this test only.
      Object.defineProperty(HTMLImageElement.prototype, 'decode', {
        value: decode,
        configurable: true,
      });
      try {
        const { container } = render(
          <RepoLogo namespace="fluent" name="fluent-bit" logoUrl={LOGO} />,
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(images(container)).toHaveLength(kept);
        expect(requested).toEqual(kept ? [] : ['fluent']);
      } finally {
        Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
      }
    },
  );

  it('keeps a logo that loaded before hydration', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(48);
    const { container } = render(<RepoLogo namespace="fluent" name="fluent-bit" logoUrl={LOGO} />);

    expect(images(container)[0]).toHaveAttribute('src', LOGO);
  });

  it.each([
    ['sm', '32'],
    ['md', '48'],
    ['lg', '64'],
  ] as const)('sizes the %s image at %spx', (size, px) => {
    const { container } = render(
      <RepoLogo namespace="fluent" name="fluent-bit" logoUrl={LOGO} size={size} />,
    );
    expect(images(container)[0]).toHaveAttribute('width', px);
    expect(images(container)[0]).toHaveAttribute('height', px);
  });
});
