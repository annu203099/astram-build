import { describe, expect, it } from 'vitest';
import { extractMarkdownCodeBlocks } from './markdown.js';

describe('extractMarkdownCodeBlocks', () => {
  it('returns fenced blocks with 1-based opening-fence line numbers', () => {
    const md = ['# Title', '', '```js', 'const a = 1;', 'const b = 2;', '```', '', 'some text', '', '~~~python', 'print(1)', '~~~'].join('\n');
    const blocks = extractMarkdownCodeBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ lang: 'js', code: 'const a = 1;\nconst b = 2;', line: 3 });
    expect(blocks[1]).toEqual({ lang: 'python', code: 'print(1)', line: 10 });
  });

  it('supports ~~~ fences and differentiates them from ``` content', () => {
    const md = ['~~~', '```js inside tilde fence', '~~~'].join('\n');
    const blocks = extractMarkdownCodeBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ lang: '', code: '```js inside tilde fence', line: 1 });
  });

  it('treats 4-space indented code as non-fenced (skipped)', () => {
    const md = ['paragraph', '', '    const notAFence = true;', '', 'next paragraph'].join('\n');
    expect(extractMarkdownCodeBlocks(md)).toEqual([]);
  });

  it('captures the first token of the info string as lang, lowercased', () => {
    const md = ['```JavaScript title="x.js"', 'let x;', '```'].join('\n');
    const blocks = extractMarkdownCodeBlocks(md);
    expect(blocks[0]!.lang).toBe('javascript');
  });

  it('keeps an unterminated fence as a block running to EOF', () => {
    const md = ['```bash', 'echo hi'].join('\n');
    const blocks = extractMarkdownCodeBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ lang: 'bash', code: 'echo hi', line: 1 });
  });

  it('requires the closing fence to match the opening fence char and length', () => {
    // ```` opened, ``` inside is content, ```` closes.
    const md = ['````md', '```js', 'nested', '```', '````'].join('\n');
    const blocks = extractMarkdownCodeBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.code.split('\n')).toEqual(['```js', 'nested', '```']);
  });

  it('returns [] for markdown without fences', () => {
    expect(extractMarkdownCodeBlocks('# just text\n\n- bullet\n')).toEqual([]);
  });
});
