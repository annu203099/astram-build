/**
 * Tab 4 — Multiverse 3D Fiber Tree (React Three Fiber, Handbook §6.5 Module 5).
 *
 * Renders the Multiverse execution DAG as a 3D tree: nodes are spheres laid
 * out BFS from the roots (parentTxId null or dangling) — x by sibling index,
 * y by depth (root at top), z by small alternating jitter; edges are thin
 * cylinders. Gold branches = canary self-healing forks.
 *
 * No drei / no extra deps: manual mouse-drag orbit + wheel zoom (a ~30-line
 * spherical-camera rig) and a state-driven HTML hover/selection overlay
 * instead of drei <Html>.
 *
 * Data: full-state snapshot from GET /api/dag on mount, then live
 * 'dag-update' events from the SAME /ws/telemetry socket (App fans the event
 * out to every tab via the `dag` prop). Safe with 0/1 nodes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { DagEdge, DagNode } from '@astram/types';
import { api } from '../lib/api';
import { riskName } from '../lib/format';

// ---------------------------------------------------------------------------
// Layout (pure — trivially testable, DOM-free)
// ---------------------------------------------------------------------------

export const SPACING_X = 2.4;
export const SPACING_Y = 2.0;
const SPACING_Z = 0.7;
const MAX_RADIUS = 220;

export interface Dag3dNode {
  node: DagNode;
  x: number;
  y: number;
  z: number;
  depth: number;
}

export interface Dag3dData {
  nodes: Dag3dNode[];
  byId: Map<string, Dag3dNode>;
  edges: { from: Dag3dNode; to: Dag3dNode }[];
}

/**
 * BFS layering. Children within a layer are ordered by txId (the server emits
 * txId-sorted nodes). Unreachable nodes (cycles) land on a guard row so they
 * can never crash the render.
 */
export function layoutDag(nodes: DagNode[], edges: DagEdge[]): Dag3dData {
  const byTx = new Map(nodes.map((n) => [n.txId, n]));
  const childrenOf = new Map<string, DagNode[]>();
  const roots: DagNode[] = [];
  for (const n of nodes) {
    const parent = n.parentTxId !== null && byTx.has(n.parentTxId) ? n.parentTxId : null;
    if (parent === null) {
      roots.push(n);
      continue;
    }
    const arr = childrenOf.get(parent) ?? [];
    arr.push(n);
    childrenOf.set(parent, arr);
  }

  const placed = new Map<string, Dag3dNode>();
  const queue: { node: DagNode; depth: number; parent: string | null }[] = roots.map((node) => ({
    node,
    depth: 0,
    parent: null,
  }));
  let maxDepth = 0;
  for (let guard = 0; queue.length > 0 && guard < 10_000; guard++) {
    const { node, depth, parent } = queue.shift()!;
    if (placed.has(node.txId)) continue; // cycle guard
    placed.set(node.txId, { node, x: 0, y: 0, z: 0, depth });
    maxDepth = Math.max(maxDepth, depth);
    const siblings = parent === null ? roots : (childrenOf.get(parent) ?? []);
    const idx = Math.max(0, siblings.findIndex((s) => s.txId === node.txId));
    const count = Math.max(siblings.length, 1);
    const placedNode = placed.get(node.txId)!;
    placedNode.x = (idx - (count - 1) / 2) * SPACING_X;
    placedNode.z = ((depth + idx) % 2 === 0 ? 1 : -1) * SPACING_Z;
    for (const child of childrenOf.get(node.txId) ?? []) {
      queue.push({ node: child, depth: depth + 1, parent: node.txId });
    }
  }
  // Center the tree vertically on the origin (root at top, y grows downward).
  const yCenter = (maxDepth * SPACING_Y) / 2;
  for (const d of placed.values()) {
    d.y = yCenter - d.depth * SPACING_Y;
  }
  // Cycle leftovers: park them on a guard row in front of the tree.
  let orphan = 0;
  for (const n of nodes) {
    if (!placed.has(n.txId)) {
      placed.set(n.txId, { node: n, x: orphan * SPACING_X, y: yCenter + SPACING_Y, z: -2.5, depth: 0 });
      orphan++;
    }
  }

  const list = nodes.map((n) => placed.get(n.txId)!).filter(Boolean);
  const renderEdges: { from: Dag3dNode; to: Dag3dNode }[] = [];
  for (const e of edges) {
    if (e.from === null) continue;
    const from = placed.get(e.from);
    const to = placed.get(e.to);
    if (from && to) renderEdges.push({ from, to });
  }
  return { nodes: list, byId: placed, edges: renderEdges };
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export function nodeColor(n: DagNode): string {
  if (n.canaryFork || n.disposition === 'CANARY_HEALED') return '#FF9F0A'; // Apple System Orange (canary fork)
  switch (n.disposition) {
    case 'COMMITTED':
      return '#30D158'; // Apple System Green (clean committed)
    case 'ROLLED_BACK':
      return '#FF453A'; // Apple System Red (rolled back)
    case 'BLOCKED_PRE_EXEC':
      return '#FF453A'; // Apple System Red (blocked)
    default:
      return '#8E8E93'; // Apple System Titanium / Slate (neutral)
  }
}

function shortId(txId: string): string {
  if (txId.includes('::canary::')) {
    const [parent, label] = txId.split('::canary::');
    return `${parent.slice(0, 8)}…::${label}`;
  }
  return txId.length <= 12 ? txId : `${txId.slice(0, 10)}…`;
}

// ---------------------------------------------------------------------------
// 3D scene pieces
// ---------------------------------------------------------------------------

interface OrbitState {
  theta: number;
  phi: number;
  radius: number;
}

/** Spherical camera rig: the whole orbit control surface we need, dep-free. */
function OrbitRig({ orbit }: { orbit: React.RefObject<OrbitState> }): null {
  const { camera } = useThree();
  useFrame(() => {
    const { theta, phi, radius } = orbit.current;
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function NodeSphere({
  d,
  color,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  d: Dag3dNode;
  color: string;
  hovered: boolean;
  selected: boolean;
  onHover: (txId: string | null) => void;
  onSelect: (txId: string) => void;
}): JSX.Element {
  const scale = selected ? 1.5 : hovered ? 1.25 : 1;
  return (
    <mesh
      position={[d.x, d.y, d.z]}
      scale={scale}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(d.node.txId);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHover(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(d.node.txId);
      }}
    >
      <sphereGeometry args={[0.42, 24, 24]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={selected ? 0.65 : hovered ? 0.45 : 0.18}
        roughness={0.35}
        metalness={0.1}
      />
    </mesh>
  );
}

/** Thin cylinder aligned from `from` to `to` (more visible than <line>). */
function EdgeCylinder({ from, to }: { from: Dag3dNode; to: Dag3dNode }): JSX.Element {
  const { mid, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(from.x, from.y, from.z);
    const b = new THREE.Vector3(to.x, to.y, to.z);
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = Math.max(dir.length(), 0.001);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize()
    );
    return { mid: new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), quat: q, len: length };
  }, [from, to]);
  return (
    <mesh position={mid} quaternion={quat}>
      <cylinderGeometry args={[0.035, 0.035, len, 6]} />
      <meshStandardMaterial color="#4b5563" roughness={0.8} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

const EMPTY: { nodes: DagNode[]; edges: DagEdge[] } = { nodes: [], edges: [] };

export function Dag3dTab({ dag }: { dag: { nodes: DagNode[]; edges: DagEdge[] } }): JSX.Element {
  // Mount-time snapshot from REST (the WS only pushes on changes).
  const [snapshot, setSnapshot] = useState<{ nodes: DagNode[]; edges: DagEdge[] } | null>(null);
  useEffect(() => {
    let disposed = false;
    api
      .dag()
      .then((d) => {
        if (!disposed) setSnapshot(d);
      })
      .catch(() => {
        /* daemon unreachable — live prop or empty state remains */
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Live WS dag-updates (full-state payloads) win when present; otherwise the
  // REST snapshot; otherwise empty.
  const nodes = dag.nodes.length > 0 ? dag.nodes : (snapshot?.nodes ?? EMPTY.nodes);
  const edges = dag.nodes.length > 0 ? dag.edges : (snapshot?.edges ?? EMPTY.edges);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const layout = useMemo(() => layoutDag(nodes, edges), [nodes, edges]);
  const hovered = hoveredId !== null ? (layout.byId.get(hoveredId)?.node ?? null) : null;
  const selected = selectedId !== null ? (layout.byId.get(selectedId)?.node ?? null) : null;

  // ---- manual orbit controls ------------------------------------------------
  const orbitRef = useRef<OrbitState>({ theta: Math.PI * 0.3, phi: Math.PI / 2.6, radius: 14 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const userZoomed = useRef(false);

  // Auto-fit: frame the whole graph until the user zooms by hand, so a big
  // tree (hundreds of nodes) is never a speck in the corner of the canvas.
  useEffect(() => {
    if (userZoomed.current || layout.nodes.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const d of layout.nodes) {
      minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);
      minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
    }
    const extent = Math.max(maxX - minX, maxY - minY, SPACING_X);
    orbitRef.current.radius = Math.min(MAX_RADIUS, Math.max(10, extent * 1.25 + 6));
  }, [layout]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    const o = orbitRef.current;
    o.theta -= dx * 0.005;
    o.phi = Math.min(Math.PI - 0.15, Math.max(0.15, o.phi - dy * 0.005));
  };
  const endDrag = (): void => {
    dragRef.current = null;
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Native listener: React's onWheel is passive, so preventDefault would warn.
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const o = orbitRef.current;
      userZoomed.current = true;
      o.radius = Math.min(MAX_RADIUS, Math.max(4, o.radius * Math.exp(e.deltaY * 0.0012)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const legend: { color: string; label: string }[] = [
    { color: '#10b981', label: 'COMMITTED' },
    { color: '#ef4444', label: 'ROLLED_BACK' },
    { color: '#f97316', label: 'BLOCKED_PRE_EXEC' },
    { color: '#eab308', label: 'CANARY fork / healed' },
    { color: '#64748b', label: 'unknown' },
  ];

  return (
    <section>
      <p className="mb-3 text-sm text-zinc-400">
        Multiverse execution DAG — {nodes.length} node{nodes.length === 1 ? '' : 's'}, {edges.length}{' '}
        edge{edges.length === 1 ? '' : 's'}. Drag to orbit, scroll to zoom, click a node for details.
      </p>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div
          ref={containerRef}
          className="relative h-[540px] min-h-[540px] shrink-0 lg:shrink lg:flex-1 cursor-grab touch-none overflow-hidden rounded-2xl border border-white/[0.08] bg-black active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={() => {
            endDrag();
            setHoveredId(null);
          }}
        >
          <Canvas
            camera={{ fov: 50, near: 0.1, far: 500, position: [8, 6, 10] }}
            onPointerMissed={() => setSelectedId(null)}
            dpr={[1, 2]}
          >
            <ambientLight intensity={0.55} />
            <directionalLight position={[6, 10, 8]} intensity={1.1} />
            <directionalLight position={[-8, -4, -6]} intensity={0.3} />
            <OrbitRig orbit={orbitRef} />
            {layout.edges.map((e, i) => (
              <EdgeCylinder key={`e${i}`} from={e.from} to={e.to} />
            ))}
            {layout.nodes.map((d) => (
              <NodeSphere
                key={d.node.txId}
                d={d}
                color={nodeColor(d.node)}
                hovered={hoveredId === d.node.txId}
                selected={selectedId === d.node.txId}
                onHover={setHoveredId}
                onSelect={setSelectedId}
              />
            ))}
          </Canvas>

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-xl border border-white/[0.08] bg-[#0D0D0F]/90 backdrop-blur-md px-4 py-3 text-xs text-white/50">
                Multiverse is empty — no transactions recorded yet.
              </p>
            </div>
          )}

          {/* hover tooltip — state-driven HTML overlay (no drei <Html>) */}
          {hovered && (
            <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-xl border border-white/[0.12] bg-[#121214]/95 backdrop-blur-md px-3.5 py-2.5 text-xs shadow-2xl">
              <p className="font-mono text-white font-medium">{shortId(hovered.txId)}</p>
              <p className="mt-1 text-white/50">
                disposition: <span style={{ color: nodeColor(hovered) }}>{hovered.disposition}</span>
              </p>
              <p className="text-white/50">risk: {riskName(hovered.finalRisk)}</p>
              {hovered.label && <p className="text-white/40">label: {hovered.label}</p>}
            </div>
          )}
        </div>

        {/* selected-node side panel */}
        <aside className="w-full shrink-0 rounded-2xl border border-white/[0.08] bg-[#0D0D0F] p-5 text-xs lg:w-80">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">
            Node Inspection
          </h3>
          {!selected ? (
            <p className="text-white/40 text-xs">Click a sphere in the fiber tree to inspect details.</p>
          ) : (
            <dl className="space-y-1.5 text-zinc-300">
              <div>
                <dt className="text-xs text-zinc-500">txId</dt>
                <dd className="break-all font-mono text-xs text-zinc-200">{selected.txId}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-xs text-zinc-500">Disposition</dt>
                <dd className="font-medium" style={{ color: nodeColor(selected) }}>
                  {selected.disposition}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-xs text-zinc-500">Final risk</dt>
                <dd>{riskName(selected.finalRisk)}</dd>
              </div>
              {selected.label !== undefined && (
                <div className="flex items-center gap-2">
                  <dt className="text-xs text-zinc-500">Label</dt>
                  <dd>{selected.label}</dd>
                </div>
              )}
              <div className="flex items-center gap-2">
                <dt className="text-xs text-zinc-500">Canary fork</dt>
                <dd>{selected.canaryFork ? 'yes (gold branch)' : 'no'}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Parent</dt>
                <dd className="break-all font-mono text-xs text-zinc-400">
                  {selected.parentTxId ?? '— (root)'}
                </dd>
              </div>
            </dl>
          )}

          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Legend
          </h3>
          <ul className="space-y-1 text-xs text-zinc-400">
            {legend.map((l) => (
              <li key={l.label} className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
