/**
 * @astram/gatekeeper — markdown fence extraction + README injection patterns.
 *
 * Contract docs/CONTRACTS.md §2:
 *   extractMarkdownCodeBlocks(md) — fenced blocks (``` and ~~~), `line` is the
 *   1-based line of the OPENING fence. 4-space indented code is not a fence
 *   (skipped as a code block; treated as ordinary text).
 */

export interface MarkdownCodeBlock {
  lang: string; // first token of the fence info string, lowercased
  code: string; // block body without the fences, lines joined by \n
  line: number; // 1-based line of the opening fence in `md`
}

export interface OutsideLine {
  line: number; // 1-based line in `md`
  text: string; // the raw line outside any code fence
}

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Single pass over the markdown lines classifying every line as either inside
 * a fenced code block or outside. Unterminated fences are treated as code up
 * to EOF (CommonMark behavior).
 */
export function tokenizeMarkdown(md: string): {
  blocks: MarkdownCodeBlock[];
  outsideLines: OutsideLine[];
} {
  const lines = md.split('\n');
  const blocks: MarkdownCodeBlock[] = [];
  const outsideLines: OutsideLine[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let lang = '';
  let openLine = 0;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (!inFence) {
      const m = OPEN_FENCE.exec(line);
      if (m) {
        const fence = m[1];
        inFence = true;
        fenceChar = fence[0];
        fenceLen = fence.length;
        const info = (m[2] ?? '').trim();
        lang = info.length > 0 ? info.split(/\s+/)[0].toLowerCase() : '';
        openLine = lineNo;
        codeLines = [];
        continue;
      }
      outsideLines.push({ line: lineNo, text: line });
    } else {
      const m = CLOSE_FENCE.exec(line);
      if (m && m[1][0] === fenceChar && m[1].length >= fenceLen) {
        blocks.push({ lang, code: codeLines.join('\n'), line: openLine });
        inFence = false;
        continue;
      }
      codeLines.push(line);
    }
  }
  if (inFence) {
    blocks.push({ lang, code: codeLines.join('\n'), line: openLine });
  }
  return { blocks, outsideLines };
}

export function extractMarkdownCodeBlocks(md: string): MarkdownCodeBlock[] {
  return tokenizeMarkdown(md).blocks;
}

/** README_INJECTION_OVERRIDE patterns (contract rule table). */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (all )?previous (rules|instructions)/i,
  /score this (as )?PASS/i,
  /disregard (all )?(previous|above)/i,
  /[\u{E0000}-\u{E007F}]/u, // invisible Unicode tag characters
];

export function matchesInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}
