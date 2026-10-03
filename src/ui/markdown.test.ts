import { describe, expect, it } from 'vitest';
import changelog from '../../CHANGELOG.md?raw';
import guide from '../../docs/USER-GUIDE.md?raw';
import { guideSections, renderChangelog, renderMarkdown, slug } from './markdown';

describe('user guide', () => {
  it('splits the guide into its sections', () => {
    const sections = guideSections(guide);
    expect(sections.map((section) => section.id)).toEqual([
      'getting-started',
      'queue-and-playback',
      'waveforms-cues-and-markers',
      'beat-grid-and-tempo',
      'visuals',
      'sound',
      'live-input',
      'exporting-videos',
      'dj-controller',
      'backup',
      'when-something-goes-wrong',
      'keyboard-shortcuts',
      'about',
    ]);
    expect(sections[0]!.markdown).not.toContain('## ');
    expect(slug('Waveforms, cues and markers')).toBe('waveforms-cues-and-markers');
  });

  it('renders paragraphs, lists and inline formatting', () => {
    const html = renderMarkdown(
      [
        'A *short* intro with **bold** words,',
        'on two lines.',
        '',
        '- one `code`',
        '- two [link](https://example.com) and a@b.com',
        '  continued',
        '',
        '1. first',
        '2. second',
        '### More',
      ].join('\n'),
    );
    expect(html).toBe(
      [
        '<p>A <em>short</em> intro with <strong>bold</strong> words, on two lines.</p>',
        '<ul><li>one <code>code</code></li><li>two <a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a> and <a href="mailto:a@b.com">a@b.com</a> continued</li></ul>',
        '<ol><li>first</li><li>second</li></ol>',
        '<h3>More</h3>',
      ].join('\n'),
    );
  });

  it('escapes markup, and keeps code as it is', () => {
    expect(renderMarkdown('<script>x</script> `**a**`')).toBe(
      '<p>&lt;script&gt;x&lt;/script&gt; <code>**a**</code></p>',
    );
    // Only web and mail links become links, once.
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
    expect(renderMarkdown('[mail me](mailto:a@b.com)')).toBe(
      '<p><a href="mailto:a@b.com" target="_blank" rel="noopener noreferrer">mail me</a></p>',
    );
  });
});

describe('changelog', () => {
  it('shows each day as a heading with its changes, newest first, without the title', () => {
    const html = renderChangelog(changelog);
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('# Changelog');
    const days = [...html.matchAll(/<h3>(\d{1,2} \w+ \d{4})<\/h3>/g)].map((match) => match[1]!);
    expect(days.length).toBeGreaterThanOrEqual(5);
    const dates = days.map((day) => Date.parse(`${day} UTC`));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(html).toContain('<li><strong>A new default look:</strong>');
  });
});
