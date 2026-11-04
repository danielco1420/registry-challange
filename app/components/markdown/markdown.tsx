import type * as React from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { safeUrl } from '~/lib/safe-url';
import { cn } from '~/lib/utils';

/** `rel` of every link: no `window.opener`, no referrer, and no SEO credit for publisher links. */
export const MARKDOWN_LINK_REL = 'noopener noreferrer nofollow';

/**
 * The URL attributes `urlTransform` sees: `src` is an image, everything else
 * (`href`, `cite`) is a link.
 */
function transformUrl(url: string, key: string): string | null {
  return safeUrl(url, key === 'src' ? 'image' : 'link');
}

type Props<Tag extends keyof React.JSX.IntrinsicElements> = React.JSX.IntrinsicElements[Tag] &
  ExtraProps;

/** One level below the page's `h1`: a README's `#` becomes an `h2`. */
function heading(Tag: 'h2' | 'h3' | 'h4' | 'h5' | 'h6', className: string) {
  return function Heading({ node: _node, className: _className, ...props }: Props<typeof Tag>) {
    return <Tag className={className} {...props} />;
  };
}

/**
 * Element overrides. Each drops the hast `node` prop (it isn't a DOM
 * attribute) and any `className` the sanitizer let through, except on `code`,
 * where `language-*` is kept.
 */
const components: Components = {
  h1: heading('h2', 'mt-8 mb-3 border-b border-border pb-1 text-2xl font-semibold first:mt-0'),
  h2: heading('h3', 'mt-6 mb-3 text-xl font-semibold first:mt-0'),
  h3: heading('h4', 'mt-5 mb-2 text-lg font-semibold first:mt-0'),
  h4: heading('h5', 'mt-4 mb-2 text-base font-semibold first:mt-0'),
  h5: heading('h6', 'mt-4 mb-2 text-sm font-semibold first:mt-0'),
  h6: heading('h6', 'mt-4 mb-2 text-sm font-semibold text-muted-foreground first:mt-0'),

  a({ node: _node, className: _className, href, children, ...props }: Props<'a'>) {
    // `urlTransform` already removed an unsafe or relative `href`: keep the text only.
    if (!href) return <span>{children}</span>;
    return (
      <a
        {...props}
        href={href}
        rel={MARKDOWN_LINK_REL}
        className="text-brand underline underline-offset-2 hover:no-underline"
      >
        {children}
      </a>
    );
  },

  img({ node: _node, className: _className, src, alt, ...props }: Props<'img'>) {
    // No (safe) `src`: render nothing rather than a broken image.
    if (typeof src !== 'string' || src === '') return null;
    return (
      <img
        {...props}
        src={src}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="inline-block h-auto max-w-full align-middle"
      />
    );
  },

  p: ({ node: _node, className: _className, ...props }) => <p className="my-3" {...props} />,
  ul: ({ node: _node, className: _className, ...props }) => (
    <ul className="my-3 list-disc space-y-1 pl-6" {...props} />
  ),
  ol: ({ node: _node, className: _className, ...props }) => (
    <ol className="my-3 list-decimal space-y-1 pl-6" {...props} />
  ),
  blockquote: ({ node: _node, className: _className, ...props }) => (
    <blockquote className="my-4 border-l-4 border-border pl-4 text-muted-foreground" {...props} />
  ),
  hr: ({ node: _node, className: _className, ...props }) => (
    <hr className="my-6 border-border" {...props} />
  ),
  // Long lines scroll inside the block instead of widening the page.
  pre: ({ node: _node, className: _className, ...props }) => (
    <pre
      className="my-4 max-w-full overflow-x-auto rounded-md bg-muted p-4 font-mono text-sm wrap-normal whitespace-pre"
      {...props}
    />
  ),
  code: ({ node: _node, className, ...props }) => (
    <code
      className={cn(
        'rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]',
        // Inside a `pre`, the block already has the background.
        'in-[pre]:bg-transparent in-[pre]:p-0 in-[pre]:text-[1em]',
        className,
      )}
      {...props}
    />
  ),
  // Wide tables scroll inside their own box.
  table: ({ node: _node, className: _className, ...props }) => (
    <div className="my-4 max-w-full overflow-x-auto">
      <table className="w-max min-w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({ node: _node, className: _className, ...props }) => (
    <th className="border border-border bg-muted px-3 py-1.5 text-left font-semibold" {...props} />
  ),
  td: ({ node: _node, className: _className, ...props }) => (
    <td className="border border-border px-3 py-1.5 align-top" {...props} />
  ),
};

/**
 * Sanitizer schema: GitHub's (`defaultSchema`), which already drops `script`,
 * `style`, `iframe`, `svg`, event handlers and `style` attributes, and only
 * allows `http(s)`/`mailto` URLs. Raw HTML never reaches it (`skipHtml`), so
 * this is the second line of defense.
 */
const sanitizeSchema = defaultSchema;

export interface MarkdownProps {
  /** Untrusted Markdown, e.g. `RepoDetails.fullDescriptionMd`. */
  children: string;
  className?: string;
}

/**
 * Renders publisher-controlled Markdown safely (RISKS.md 3.1, CLAUDE.md hard
 * rule 5):
 *
 * - **No raw HTML.** HTML in the source is skipped, never parsed, so
 *   `<script>`, `<iframe>`, `<svg onload>` and `<img onerror>` can't run.
 * - **Sanitized.** The tree goes through `rehype-sanitize` (GitHub's schema)
 *   as well, so nothing outside its allowlist of elements and attributes
 *   reaches React, and DOM-clobbering `id`/`name` values are prefixed.
 * - **URL allowlist** (`safeUrl`): links keep only `https:`, `http:` and
 *   `mailto:`; images only `https:`. `javascript:`, `data:`, relative and
 *   protocol-relative URLs are dropped (a link becomes plain text, an image
 *   disappears).
 * - **Links** get `rel="noopener noreferrer nofollow"`. **Images** are sent
 *   no referrer, load lazily and never grow wider than the column. The CSP's
 *   `img-src` still decides which hosts actually load.
 * - **Headings** shift down one level, so the page keeps a single `h1`.
 * - **Layout:** long words wrap anywhere, and code blocks and tables scroll
 *   inside their own box, so a huge README can't widen the page.
 *
 * GitHub-flavored Markdown (tables, strikethrough, task lists, autolinks) is
 * supported through `remark-gfm`, since most READMEs are written for GitHub.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div
      data-slot="markdown"
      className={cn('min-w-0 text-sm leading-relaxed wrap-anywhere text-foreground', className)}
    >
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        urlTransform={transformUrl}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
