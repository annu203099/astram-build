/**
 * @astram/db unit tests — MultiverseDag (order-insensitive rebuild, forks,
 * traversal). Pure in-memory; no database, no filesystem.
 */
import { describe, expect, it } from 'vitest';
import { MultiverseDag } from './index.js';
import { RiskLevel, type AtomicAuditTx } from '@astram/types';

let counter = 0;
function makeTx(overrides: Partial<AtomicAuditTx> = {}): AtomicAuditTx {
  counter += 1;
  return {
    txId: `tx-${counter}`,
    sessionId: 'session-alpha',
    fiberId: 'fiber-1',
    parentTxId: null,
    agentHost: 'cursor',
    timestampMs: 1_000 + counter,
    policyCharterId: 'astram-policy-charter-v1',
    statedExplanation: 'run tool',
    mcpServerId: 'mcp-x',
    toolName: 'shell.exec',
    redactedArgumentsJson: '{}',
    deterministicRisk: RiskLevel.WARN,
    decisionApiDelta: 0,
    finalMonotonicRisk: RiskLevel.WARN,
    fsModifiedFilesJson: '[]',
    turboquantSlabIndex: null,
    anomalyScore: 0,
    violationDetected: 0,
    disposition: 'COMMITTED',
    ...overrides,
  };
}

function chain(): AtomicAuditTx[] {
  // genesis -> a -> b -> c linear chain
  return [
    makeTx({ txId: 'genesis', timestampMs: 1_000 }),
    makeTx({ txId: 'a', parentTxId: 'genesis', timestampMs: 2_000 }),
    makeTx({ txId: 'b', parentTxId: 'a', timestampMs: 3_000 }),
    makeTx({ txId: 'c', parentTxId: 'b', timestampMs: 4_000, disposition: 'ROLLED_BACK' }),
  ];
}

describe('MultiverseDag.fromTxs — order insensitivity', () => {
  it('shuffled input produces the exact same canonical toJSON as ordered input', () => {
    const ordered = chain();
    // Deterministic shuffle: children interleaved before/after parents,
    // including a parent appearing AFTER its child.
    const shuffled = [ordered[2], ordered[0], ordered[3], ordered[1]];
    expect(MultiverseDag.fromTxs(shuffled).toJSON()).toEqual(MultiverseDag.fromTxs(ordered).toJSON());
  });

  it('toJSON emits every node plus one edge per node (null-from for genesis)', () => {
    const dag = MultiverseDag.fromTxs(chain());
    const json = dag.toJSON();
    expect(json.nodes.map((n) => n.txId).sort()).toEqual(['a', 'b', 'c', 'genesis']);
    expect(json.edges).toEqual([
      { from: 'genesis', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: null, to: 'genesis' },
    ]);
    const c = json.nodes.find((n) => n.txId === 'c');
    expect(c?.disposition).toBe('ROLLED_BACK');
    expect(c?.canaryFork).toBe(false);
  });

  it('maps CANARY_HEALED rows to canaryFork nodes', () => {
    const dag = MultiverseDag.fromTxs([
      makeTx({ txId: 'h', parentTxId: 'genesis', disposition: 'CANARY_HEALED' }),
      makeTx({ txId: 'genesis' }),
    ]);
    const healed = dag.toJSON().nodes.find((n) => n.txId === 'h');
    expect(healed?.canaryFork).toBe(true);
  });

  it('preserves a dangling parentTxId (tx whose parent is not in the input)', () => {
    const dag = MultiverseDag.fromTxs([makeTx({ txId: 'orphan', parentTxId: 'never-inserted' })]);
    expect(dag.toJSON().edges).toEqual([{ from: 'never-inserted', to: 'orphan' }]);
  });
});

describe('MultiverseDag — mutation & traversal', () => {
  it('forkNode creates a child marked canaryFork and links it to its parent', () => {
    const dag = MultiverseDag.fromTxs(chain());
    const fork = dag.forkNode('b', 'heal-1');
    expect(fork.canaryFork).toBe(true);
    expect(fork.parentTxId).toBe('b');
    expect(fork.label).toBe('heal-1');
    expect(fork.finalRisk).toBe(RiskLevel.WARN);
    const children = dag.getChildren('b');
    expect(children.map((n) => n.txId)).toEqual([fork.txId, 'c'].sort());
    expect(dag.toJSON().nodes.find((n) => n.txId === fork.txId)?.canaryFork).toBe(true);
  });

  it('forkNode throws on an unknown parent', () => {
    const dag = new MultiverseDag();
    expect(() => dag.forkNode('ghost', 'heal')).toThrow(/unknown parent/);
  });

  it('pathToRoot walks [node, ..., genesis] and throws on unknown txId', () => {
    const dag = MultiverseDag.fromTxs(chain());
    expect(dag.pathToRoot('c').map((n) => n.txId)).toEqual(['c', 'b', 'a', 'genesis']);
    expect(dag.pathToRoot('genesis').map((n) => n.txId)).toEqual(['genesis']);
    expect(() => dag.pathToRoot('ghost')).toThrow(/unknown tx/);
  });

  it('markDisposition updates the node and throws on unknown txId', () => {
    const dag = MultiverseDag.fromTxs(chain());
    dag.markDisposition('c', 'CANARY_HEALED');
    expect(dag.toJSON().nodes.find((n) => n.txId === 'c')?.disposition).toBe('CANARY_HEALED');
    expect(() => dag.markDisposition('ghost', 'COMMITTED')).toThrow(/unknown tx/);
  });

  it('getChildren returns [] for a leaf', () => {
    const dag = MultiverseDag.fromTxs(chain());
    expect(dag.getChildren('c')).toEqual([]);
  });
});
