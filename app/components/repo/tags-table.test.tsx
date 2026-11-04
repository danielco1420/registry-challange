import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '~/i18n/i18next';

import type { Tag } from '~/lib/dto';

import { TagsTable, type TagsTableProps } from './tags-table';

const INDEX_DIGEST = 'sha256:1e1b4b0a62fdb9fdaa832ade335d996c34e86fa29858b2a3e6d20c210c1c497f';
const AMD64_DIGEST = 'sha256:9b6786d8d129fe8e4a2e19a9cb4aebeb44bd31fb52377b7ef1db327f56e0b951';
const ARM64_DIGEST = 'sha256:35100a7cf11943c331f86776db2c9e98766c5210b9608787fb705e0b01dba686';

const MULTI_ARCH: Tag = {
  name: '1.27',
  updatedAt: '2026-10-28T23:49:26.553Z',
  size: 62_592_256,
  digest: INDEX_DIGEST,
  images: [
    { arch: 'amd64', os: 'linux', size: 62_592_256, digest: AMD64_DIGEST },
    { arch: 'arm64', variant: 'v8', os: 'linux', size: 61_709_184, digest: ARM64_DIGEST },
    { arch: 'arm', variant: 'v7', os: 'linux', size: 56_267_351 },
  ],
};

const NO_IMAGES: Tag = {
  name: 'legacy',
  updatedAt: '',
  size: 0,
  images: [],
};

function renderTable(tags: Tag[], props: Partial<TagsTableProps> = {}) {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <TagsTable
          tags={tags}
          namespace="library"
          repo="nginx"
          ordering="last_updated"
          sortHref={(ordering) => `/?ordering=${ordering}`}
          caption="Tags of nginx"
          now={Date.parse('2026-11-04T00:00:00Z')}
          {...props}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

/** Replaces `navigator.clipboard`. */
function mockClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('TagsTable: per-platform breakdown', () => {
  it('starts collapsed, with a toggle that names the hidden region it controls', async () => {
    renderTable([MULTI_ARCH]);

    const toggle = await screen.findByRole('button', { name: 'Platforms of 1.27' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const regionId = toggle.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const region = document.getElementById(regionId ?? '');
    expect(region).not.toBeNull();
    expect(region).not.toBeVisible();
    expect(screen.queryByRole('table', { name: 'Platforms of 1.27' })).not.toBeInTheDocument();
  });

  it('expands into OS/arch(+variant), short digest and size per image, and collapses again', async () => {
    renderTable([MULTI_ARCH]);

    const toggle = await screen.findByRole('button', { name: 'Platforms of 1.27' });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const region = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(region).toBeVisible();

    const platforms = within(region!).getByRole('table', { name: 'Platforms of 1.27' });
    const rows = within(platforms).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'linux/amd64',
      'linux/arm64/v8',
      'linux/arm/v7',
    ]);
    const amd64 = rows[0]!;
    expect(amd64).toHaveTextContent('sha256:9b6786d8d129');
    expect(within(amd64).getByText('sha256:9b6786d8d129')).toHaveAttribute('title', AMD64_DIGEST);
    expect(amd64).toHaveTextContent('62.6 MB');
    // No digest for this image: a dash and no Copy button.
    expect(within(rows[2]!).queryByRole('button')).not.toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('—');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(region).not.toBeVisible();
    expect(screen.queryByRole('table', { name: 'Platforms of 1.27' })).not.toBeInTheDocument();
  });

  it('is keyboard operable: a native, tabbable button, and hidden Copy buttons are out of reach', async () => {
    renderTable([MULTI_ARCH]);

    const toggle = await screen.findByRole('button', { name: 'Platforms of 1.27' });
    // A native, enabled <button type="button"> in the tab order: browsers turn
    // Enter and Space on it into a click, so it needs no key handler of its own.
    // jsdom doesn't do that translation (and user-event isn't a dependency), so
    // the activations below are the clicks a browser would dispatch.
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toBeEnabled();
    expect(toggle.tabIndex).toBe(0);
    toggle.focus();
    expect(toggle).toHaveFocus();
    // Collapsed: only the tag's own Copy button is reachable.
    expect(screen.getAllByRole('button', { name: /^Copy/ })).toHaveLength(1);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Focus stays on the toggle, so a second Enter or Space collapses it again.
    expect(toggle).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Copy docker pull by digest for 1.27 on linux/amd64' }),
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(screen.getAllByRole('button', { name: /^Copy/ })).toHaveLength(1);
  });

  it('a tag without platform images expands into a note, not an empty region', async () => {
    renderTable([NO_IMAGES]);

    const toggle = await screen.findByRole('button', { name: 'Platforms of legacy' });
    fireEvent.click(toggle);

    const region = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(region).toBeVisible();
    expect(region).toHaveTextContent('Docker Hub lists no per-platform images for this tag.');
    expect(within(region!).queryByRole('table')).not.toBeInTheDocument();
    // No tag digest either: nothing to copy.
    expect(within(region!).queryByRole('button')).not.toBeInTheDocument();
  });

  it('a tag whose images[] is missing from the payload still renders and expands', async () => {
    const malformed = { ...NO_IMAGES, digest: INDEX_DIGEST, images: undefined } as unknown as Tag;
    renderTable([malformed]);

    fireEvent.click(await screen.findByRole('button', { name: 'Platforms of legacy' }));

    expect(screen.getByText('Docker Hub lists no per-platform images for this tag.')).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Copy docker pull by digest for legacy, all platforms',
      }),
    ).toBeInTheDocument();
  });

  it('copies a platform’s pull-by-digest command, without library/ for official images', async () => {
    const writeText = mockClipboard();
    renderTable([MULTI_ARCH]);

    fireEvent.click(await screen.findByRole('button', { name: 'Platforms of 1.27' }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Copy docker pull by digest for 1.27 on linux/arm64/v8',
        }),
      );
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith(`docker pull nginx@${ARM64_DIGEST}`);
  });

  it('copies the tag’s own (all platforms) digest command, keeping a non-library namespace', async () => {
    const writeText = mockClipboard();
    renderTable([MULTI_ARCH], { namespace: 'fluent', repo: 'fluent-bit' });

    fireEvent.click(await screen.findByRole('button', { name: 'Platforms of 1.27' }));
    const region = screen.getByText('Tag digest (all platforms):').parentElement!;
    expect(within(region).getByText('sha256:1e1b4b0a62fd')).toHaveAttribute('title', INDEX_DIGEST);
    await act(async () => {
      fireEvent.click(
        within(region).getByRole('button', {
          name: 'Copy docker pull by digest for 1.27, all platforms',
        }),
      );
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      `docker pull fluent/fluent-bit@${INDEX_DIGEST}`,
    );
  });

  it('lists every image, even two that share one digest', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const shared: Tag = {
      ...MULTI_ARCH,
      images: [
        { arch: 'arm64', os: 'linux', size: 1, digest: ARM64_DIGEST },
        { arch: 'arm64', variant: 'v8', os: 'linux', size: 1, digest: ARM64_DIGEST },
      ],
    };
    renderTable([shared]);

    fireEvent.click(await screen.findByRole('button', { name: 'Platforms of 1.27' }));

    const platforms = screen.getByRole('table', { name: 'Platforms of 1.27' });
    expect(
      within(platforms)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['linux/arm64', 'linux/arm64/v8']);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('expands each tag on its own, with distinct controlled regions', async () => {
    renderTable([MULTI_ARCH, NO_IMAGES]);

    const first = await screen.findByRole('button', { name: 'Platforms of 1.27' });
    const second = screen.getByRole('button', { name: 'Platforms of legacy' });
    expect(first.getAttribute('aria-controls')).not.toBe(second.getAttribute('aria-controls'));

    fireEvent.click(second);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
  });
});
