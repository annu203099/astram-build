/**
 * @astram/mcp-proxy — deterministic HOLD rules for dangerous command strings
 * found in MCP tool-call ARGUMENTS.
 *
 * The gatekeeper's scanShellSnippet keeps `curl | sh` at WARN (contract §2:
 * it also scans READMEs/skills where install one-liners are common). An agent
 * tool call that actually carries such a command is a different matter, so the
 * firewall escalates it here, and adds the rules the gatekeeper does not have.
 *
 *   ARG_DESTRUCTIVE_DELETE     rm -rf / ~ $HOME * C:\ ...; Remove-Item -Recurse -Force C:\;
 *                              rd /s /q C:\; del /s /q C:\; format C:
 *   ARG_ENCODED_POWERSHELL     powershell|pwsh ... -e|-ec|-enc|-EncodedCommand
 *   ARG_PIPE_DOWNLOAD_EXEC     curl|wget piped into a shell, iex(...), Invoke-Expression
 */
import { RiskLevel, type AstCapabilityFact } from '@astram/types';

type Rule = { ruleId: string; category: AstCapabilityFact['category']; test: (line: string) => boolean };

/** Targets that mean "everything": filesystem root, home, drive root, bare glob. */
const ROOT_TARGET = String.raw`(?:/\*?|~/?\*?|\$HOME/?\*?|\$\{HOME\}/?\*?|\*|[A-Za-z]:[\\/]?\*?|%USERPROFILE%[\\/]?\*?|%SYSTEMDRIVE%[\\/]?\*?|\$env:USERPROFILE[\\/]?\*?)`;
const END = String.raw`(?=$|[\s;&|)"'])`;

const RM_RECURSIVE = new RegExp(
  String.raw`(?<!git\s)\brm\s+(?:(?:-[a-zA-Z]+|--[a-z-]+)\s+)*?(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\s+(?:(?:-[a-zA-Z]+|--[a-z-]+)\s+)*["']?${ROOT_TARGET}${END}`
);
const RM_NO_PRESERVE_ROOT = /\brm\b[^\n]*--no-preserve-root/;
const REMOVE_ITEM = new RegExp(
  String.raw`\b(?:remove-item|ri)\b[^\n]*-recurse[^\n]*?\s["']?${ROOT_TARGET}["']?${END}|\b(?:remove-item|ri)\b\s+["']?${ROOT_TARGET}["']?\s[^\n]*-recurse`,
  'i'
);
const CMD_RD = new RegExp(String.raw`\b(?:rd|rmdir|del|erase)\b\s+(?:/[a-z]\s+)*/[sq]\s+(?:/[a-z]\s+)*["']?${ROOT_TARGET}["']?${END}`, 'i');
const FORMAT_DRIVE = /\bformat\s+[a-z]:/i;

const PS_ENCODED = /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*\s-(?:e|ec|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)\b/i;

const CURL_OR_WGET = /\b(?:curl|wget)\b/i;
const PIPE_INTO_SHELL = /\|\s*(?:sudo\s+)?(?:[a-z]{0,2}sh|pwsh|powershell(?:\.exe)?)\b/i;
const IEX = /\biex\b|\binvoke-expression\b/i;

/** A variable / command substitution used AS the command word: `$x -rf /`, `${rm} -rf /`, `$(echo rm) -rf /`. */
const VAR_AS_COMMAND_RM = new RegExp(
  String.raw`(?:^|[;&|(]\s*|\s)(?:\$\{?\w+\}?|\$\([^)]*\)|\x60[^\x60]*\x60)\s+(?:(?:-[a-zA-Z]+|--[a-z-]+)\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+(?:(?:-[a-zA-Z]+|--[a-z-]+)\s+)*["']?${ROOT_TARGET}${END}`
);

/** base64/xxd/openssl-decoded data piped into a shell or interpreter. */
const DECODE_PIPE_EXEC =
  /\b(?:base64\s+(?:-d|-D|--decode)|xxd\s+-r|openssl\s+(?:enc\s+)?-d|certutil\b[^\n]*-decode)\b[^\n]*\|\s*(?:sudo\s+)?(?:[a-z]{0,2}sh|pwsh|powershell(?:\.exe)?|python3?|node|perl|ruby)\b/i;

/** `eval "$(curl ...)"`, `bash -c "$(curl ...)"`, `sh <(curl ...)`, `source <(wget ...)`. */
const FETCH_SUBST_EXEC =
  /\b(?:eval|source|\.|(?:[a-z]{0,2}sh)(?:\s+-[a-z]+)*)\s+(?:-c\s+)?["']?(?:\$\(|<\(|\x60)\s*(?:curl|wget)\b/i;

/**
 * Undo the cheap shell obfuscations that defeat a literal regex: empty quote
 * pairs inside a word (r""m), backslash-escaped letters (r\m), quoted single
 * letters ('r'm), and ${IFS}/$IFS used as whitespace.
 */
export function deobfuscate(line: string): string {
  return line
    .replace(/\$\{IFS[^}]*\}|\$IFS\b/g, ' ')
    .replace(/(?<=\w)(?:""|'')(?=\w)/g, '')
    .replace(/(?<=\w)\\(?=[A-Za-z])/g, '')
    .replace(/(?<![\w\\])\\(?=[A-Za-z])/g, '')
    .replace(/(?<=\s|^)(["'])(\w)\1(?=\w)/g, '$2');
}

const RULES: Rule[] = [
  {
    ruleId: 'ARG_DESTRUCTIVE_DELETE',
    category: 'PROC_EXEC',
    test: (l) =>
      RM_RECURSIVE.test(l) ||
      RM_NO_PRESERVE_ROOT.test(l) ||
      REMOVE_ITEM.test(l) ||
      CMD_RD.test(l) ||
      FORMAT_DRIVE.test(l) ||
      VAR_AS_COMMAND_RM.test(l),
  },
  { ruleId: 'ARG_ENCODED_POWERSHELL', category: 'PROC_EXEC', test: (l) => PS_ENCODED.test(l) },
  {
    ruleId: 'ARG_PIPE_DOWNLOAD_EXEC',
    category: 'PROC_EXEC',
    test: (l) =>
      (CURL_OR_WGET.test(l) && PIPE_INTO_SHELL.test(l)) ||
      IEX.test(l) ||
      FETCH_SUBST_EXEC.test(l) ||
      DECODE_PIPE_EXEC.test(l),
  },
];

/** HOLD facts for every dangerous command line inside one argument string. */
export function scanDangerousCommand(value: string, file: string): AstCapabilityFact[] {
  const facts: AstCapabilityFact[] = [];
  const lines = value.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length > 20000) continue;
    const plain = deobfuscate(line);
    for (const rule of RULES) {
      if (rule.test(line) || (plain !== line && rule.test(plain))) {
        facts.push({
          ruleId: rule.ruleId,
          category: rule.category,
          file,
          line: i + 1,
          snippet: line.trim().slice(0, 200),
          deterministicRisk: RiskLevel.HOLD,
        });
      }
    }
  }
  return facts;
}
