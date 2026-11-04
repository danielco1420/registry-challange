/**
 * `Markdown` renders publisher-controlled READMEs (RISKS.md 3.1). The XSS
 * corpus below must come out inert: no script elements, no event handlers,
 * no `javascript:`/`data:` URLs, no embedded documents or SVG.
 */
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MARKDOWN_LINK_REL, Markdown } from './markdown';

function renderMarkdown(source: string) {
  const { container } = render(<Markdown>{source}</Markdown>);
  return container;
}

/** Elements and attributes that must never appear in rendered output. */
const DANGEROUS_ELEMENTS =
  'script, style, iframe, frame, frameset, object, embed, svg, math, form, input:not([type="checkbox"]), textarea, button, link, meta, base, template, video, audio, source';

function expectInert(container: HTMLElement) {
  expect(container.querySelectorAll(DANGEROUS_ELEMENTS)).toHaveLength(0);
  for (const element of container.querySelectorAll('*')) {
    for (const { name, value } of element.attributes) {
      expect(name, `${element.tagName} has ${name}`).not.toMatch(/^on/i);
      expect(name).not.toBe('style');
      expect(name).not.toBe('srcdoc');
      expect(name).not.toBe('formaction');
      if (['href', 'src', 'cite', 'action', 'xlink:href', 'poster'].includes(name)) {
        expect(value, `${element.tagName} ${name}`).toMatch(/^(https?:|mailto:)/i);
      }
    }
  }
}

/** Each entry is a README fragment an attacker controls. */
const XSS_CORPUS: [string, string][] = [
  ['script tag', '<script>alert(1)</script>'],
  ['script tag mid-paragraph', 'Hello <script>alert(1)</script> world'],
  ['uppercase script', '<SCRIPT SRC=https://evil.example/x.js></SCRIPT>'],
  ['img onerror', '<img src=x onerror="alert(1)">'],
  ['img onerror, https src', '<img src="https://example.com/a.png" onerror="alert(1)">'],
  ['svg onload', '<svg onload="alert(1)"><circle r="1"/></svg>'],
  ['svg with script', '<svg><script>alert(1)</script></svg>'],
  ['svg use xlink', '<svg><use xlink:href="data:image/svg+xml,<svg onload=alert(1)>"/></svg>'],
  ['iframe', '<iframe src="https://evil.example"></iframe>'],
  ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['object', '<object data="javascript:alert(1)"></object>'],
  ['embed', '<embed src="javascript:alert(1)">'],
  ['style tag', '<style>body{display:none}</style>'],
  ['style attribute', '<p style="position:fixed;inset:0">overlay</p>'],
  ['form with button', '<form action="https://evil.example"><button>Go</button></form>'],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
  ['base href', '<base href="https://evil.example/">'],
  ['details ontoggle', '<details open ontoggle="alert(1)">x</details>'],
  ['a onclick', '<a href="https://example.com" onclick="alert(1)">x</a>'],
  ['javascript: link', '[click](javascript:alert(1))'],
  ['JaVaScRiPt: link', '[click](JaVaScRiPt:alert(1))'],
  ['entity-encoded javascript: link', '[click](&#106;avascript:alert(1))'],
  ['javascript: with tab', '[click](java\tscript:alert(1))'],
  ['javascript: reference link', '[click][x]\n\n[x]: javascript:alert(1)'],
  ['javascript: autolink', '<javascript:alert(1)>'],
  ['vbscript: link', '[click](vbscript:msgbox(1))'],
  ['data: html link', '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
  ['javascript: image', '![x](javascript:alert(1))'],
  ['data: svg image', '![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)'],
  ['image title breakout', '![x](https://example.com/a.png "a\\" onerror=\\"alert(1)")'],
  ['link title breakout', '[x](https://example.com "a\\" onmouseover=\\"alert(1)")'],
  ['html comment', '<!-- <script>alert(1)</script> -->'],
  ['math', '<math><mtext><script>alert(1)</script></mtext></math>'],
  ['template', '<template><script>alert(1)</script></template>'],
  ['nested in table', '| a |\n|---|\n| <img src=x onerror=alert(1)> |'],
  ['nested in list', '- <script>alert(1)</script>\n- [x](javascript:alert(1))'],
];

describe('Markdown XSS corpus', () => {
  it.each(XSS_CORPUS)('%s is neutralised', (_name, source) => {
    expectInert(renderMarkdown(source));
  });

  it.each(XSS_CORPUS)('%s is neutralised in the server render too', (_name, source) => {
    const html = renderToStaticMarkup(<Markdown>{source}</Markdown>);
    expect(html).not.toMatch(/<(script|iframe|svg|object|embed|style|form|math|template)\b/i);
    expect(html).not.toMatch(/(href|src)="\s*(javascript|vbscript|data):/i);
    // Parse the markup the way a browser would (inert: `innerHTML` never runs scripts).
    const parsed = document.createElement('div');
    parsed.innerHTML = html;
    expectInert(parsed);
  });

  it('never parses raw HTML: tags are dropped, surrounding Markdown still renders', () => {
    const container = renderMarkdown('**bold** <b>raw</b> and <span>more</span>');
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('span')).toBeNull();
    expect(container).toHaveTextContent('bold raw and more');
  });

  it('keeps the text of a link whose URL was dropped', () => {
    const container = renderMarkdown('[click me](javascript:alert(1))');
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('click me');
  });

  it('prefixes ids, so a README cannot clobber DOM globals', () => {
    const container = renderMarkdown('Note[^1]\n\n[^1]: The footnote.');
    for (const element of container.querySelectorAll('[id]')) {
      expect(element.id).toMatch(/^user-content-/);
    }
  });
});

describe('Markdown links', () => {
  it('adds rel="noopener noreferrer nofollow" to every link', () => {
    const container = renderMarkdown(
      '[docs](https://docs.docker.com) <https://example.com> www.example.org [mail](mailto:a@example.com)',
    );
    const links = container.querySelectorAll('a');
    expect(links.length).toBe(4);
    for (const link of links) expect(link).toHaveAttribute('rel', MARKDOWN_LINK_REL);
    expect(MARKDOWN_LINK_REL).toBe('noopener noreferrer nofollow');
  });

  it('keeps http(s) and mailto links; drops relative and protocol-relative ones', () => {
    const container = renderMarkdown(
      [
        '[a](https://a.example/x)',
        '[b](http://b.example/)',
        '[c](mailto:c@example.com)',
        '[d](/r/library/nginx)',
        '[e](docs/README.md)',
        '[f](//evil.example)',
      ].join(' '),
    );
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'https://a.example/x',
      'http://b.example/',
      'mailto:c@example.com',
    ]);
    expect(container).toHaveTextContent('a b c d e f');
  });
});

describe('Markdown images', () => {
  it('constrains images to the column, lazy, with no referrer', () => {
    const container = renderMarkdown('![logo](https://example.com/logo.png)');
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', 'https://example.com/logo.png');
    expect(image).toHaveAttribute('alt', 'logo');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).toHaveClass('max-w-full', 'h-auto');
  });

  it('drops images that are not https', () => {
    const container = renderMarkdown(
      '![a](http://example.com/a.png) ![b](/local.png) ![c](data:image/png;base64,AAAA)',
    );
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});

describe('Markdown structure', () => {
  it('shifts headings down one level, under the page h1', () => {
    const container = renderMarkdown('# One\n\n## Two\n\n###### Six');
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h2')).toHaveTextContent('One');
    expect(container.querySelector('h3')).toHaveTextContent('Two');
    expect(container.querySelector('h6')).toHaveTextContent('Six');
  });

  it('renders GitHub-flavored tables, strikethrough and code blocks', () => {
    const container = renderMarkdown(
      '| a | b |\n|---|---|\n| 1 | 2 |\n\n~~old~~\n\n```console\n$ docker run nginx\n```',
    );
    expect(container.querySelector('table td')).toHaveTextContent('1');
    expect(container.querySelector('del')).toHaveTextContent('old');
    expect(container.querySelector('pre code')).toHaveClass('language-console');
  });
});

describe('Markdown with a very large description', () => {
  const longWord = 'x'.repeat(5000);
  const longLine = `docker run ${'--flag=value '.repeat(400)}nginx`;
  const wideRow = `| ${Array.from({ length: 40 }, (_, i) => `column ${i}`).join(' | ')} |`;
  const separator = `|${'---|'.repeat(40)}`;
  const source = [
    ...Array.from({ length: 300 }, (_, i) => `## Section ${i}\n\nParagraph ${i}. ${longWord}`),
    '```',
    longLine,
    '```',
    [wideRow, separator, wideRow].join('\n'),
  ].join('\n\n');

  it('renders it all', () => {
    const container = renderMarkdown(source);
    expect(container.querySelectorAll('h3')).toHaveLength(300);
    expect(container.querySelector('pre')).toHaveTextContent('--flag=value');
    expect(container.querySelectorAll('th')).toHaveLength(40);
  });

  it('wraps long words, and scrolls code blocks and tables inside their own box', () => {
    const container = renderMarkdown(source);
    const root = container.querySelector('[data-slot="markdown"]');
    expect(root).toHaveClass('min-w-0', 'wrap-anywhere');
    expect(container.querySelector('pre')).toHaveClass('overflow-x-auto', 'max-w-full');
    const table = container.querySelector('table');
    expect(table?.parentElement).toHaveClass('overflow-x-auto', 'max-w-full');
  });
});
