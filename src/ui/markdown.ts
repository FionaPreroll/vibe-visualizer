/**
 * The user guide (docs/USER-GUIDE.md) as the in-app help shows it (UI-11): split into its
 * sections ("## " headings), each rendered from the little Markdown the guide uses: paragraphs,
 * "### " headings, lists ("- " and "1. "), **bold**, *italic*, `code` and [links](https://…).
 * Everything else is escaped, so the text cannot inject markup.
 */

export interface GuideSection {
  /** From the heading: "Beat grid and tempo" → "beat-grid-and-tempo". */
  id: string;
  title: string;
  /** The section's Markdown, without its heading. */
  markdown: string;
}

/** The sections of a guide; what comes before the first "## " heading is left out. */
export function guideSections(markdown: string): GuideSection[] {
  const sections: GuideSection[] = [];
  let current: GuideSection | null = null;
  for (const line of markdown.split('\n')) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      const title = heading[1]!.trim();
      current = { id: slug(title), title, markdown: '' };
      sections.push(current);
    } else if (current) {
      current.markdown += `${line}\n`;
    }
  }
  for (const section of sections) section.markdown = section.markdown.trim();
  return sections;
}

export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * A document of its own as the help shows it, such as the changelog (CHANGELOG.md, a section for
 * each day) or the privacy policy (PRIVACY.md): without its title, its sections as headings.
 */
export function renderDocument(markdown: string): string {
  return renderMarkdown(markdown.replace(/^# .*\n/, '').replace(/^## /gm, '### '));
}

/** HTML for the Markdown of a section. */
export function renderMarkdown(markdown: string): string {
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length > 0) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    html.push(`<${tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
    list = null;
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const item = /^(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    const heading = /^###\s+(.*)$/.exec(line);
    if (line === '') {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      html.push(`<h3>${inline(heading[1]!)}</h3>`);
    } else if (item) {
      flushParagraph();
      const ordered = item[2] !== undefined;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(item[3]!);
    } else if (list) {
      // A line that continues the last item.
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return html.join('\n');
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline formatting of escaped text; code spans and links keep their content as it is. */
function inline(text: string): string {
  // Code spans and links are set aside first, so nothing inside them is formatted again.
  const kept: string[] = [];
  const keep = (html: string) => `\uE000${kept.push(html) - 1}\uE000`;
  const result = escape(text)
    .replace(/`([^`]+)`/g, (_, code: string) => keep(`<code>${code}</code>`))
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g,
      (_, label: string, url: string) =>
        keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`),
    )
    .replace(/\b([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\b/g, (_, email: string) =>
      keep(`<a href="mailto:${email}">${email}</a>`),
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
  return result.replace(/\uE000(\d+)\uE000/g, (_, index: string) => kept[Number(index)]!);
}
