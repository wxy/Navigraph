import type { ExtendedNavNode, NavLink, NavNode } from '../../types/navigation.js';

const MIN_RING_GAP = 86;
const MIN_FOLDED_PAGES = 3;
const FULL_TURN = Math.PI * 2;

interface ChainFold {
  id: string;
  count: number;
  expanded: boolean;
}

interface TreeEntry {
  data: ExtendedNavNode;
  children: TreeEntry[];
  originalDepth: number;
  continuesOutsidePage: boolean;
  leaves: number;
  fold?: ChainFold;
}

export interface EllipticalTreeNode {
  data: ExtendedNavNode;
  x: number;
  y: number;
  depth: number;
  originalDepth: number;
  continuesOutsidePage: boolean;
}

interface Placement {
  entry: TreeEntry;
  node: EllipticalTreeNode;
  parent?: Placement;
  arc: number;
  unitX: number;
  unitY: number;
  radius: number;
}

export interface EllipticalTreeLink {
  target: EllipticalTreeNode;
  path: string;
  fold?: ChainFold;
  x: number;
  y: number;
}

function byTime(a: TreeEntry, b: TreeEntry): number {
  return a.data.timestamp - b.data.timestamp || a.data.id.localeCompare(b.data.id);
}

function compactChains(entry: TreeEntry, protectedIds: ReadonlySet<string>, expanded: ReadonlySet<string>): TreeEntry {
  const children = entry.children.map(first => {
    const tabId = entry.data.tabId;
    const middle: TreeEntry[] = [];
    let endpoint = first;
    while (typeof tabId === 'number' && endpoint.data.tabId === tabId &&
      endpoint.children.length === 1 && endpoint.children[0].data.tabId === tabId &&
      !protectedIds.has(endpoint.data.id)) {
      middle.push(endpoint);
      endpoint = endpoint.children[0];
    }

    if (middle.length < MIN_FOLDED_PAGES) return compactChains(first, protectedIds, expanded);

    const fold = { id: first.data.id, count: middle.length, expanded: expanded.has(first.data.id) };
    const tail = compactChains(endpoint, protectedIds, expanded);
    const visible = fold.expanded
      ? middle.reduceRight((child, page) => ({ ...page, children: [child] }), tail)
      : tail;
    return { ...visible, fold };
  });
  return { ...entry, children };
}

function measureBranch(entry: TreeEntry, counts: number[], depth = 0): number {
  counts[depth] = (counts[depth] ?? 0) + 1;
  entry.leaves = entry.children.reduce((total, child) => total + measureBranch(child, counts, depth + 1), 0) || 1;
  return entry.leaves;
}

// The parameter angle advances at different speeds around an ellipse.
// Sample the perimeter once so branch sectors can be sized in arc lengths.
function ellipseArc(unitX: number, unitY: number): (fraction: number) => number {
  const samples = 256;
  const step = FULL_TURN / samples;
  const lengths = [0];
  let previousX = unitX;
  let previousY = 0;
  for (let index = 1; index <= samples; index++) {
    const x = unitX * Math.cos(index * step);
    const y = unitY * Math.sin(index * step);
    lengths.push(lengths[index - 1] + Math.hypot(x - previousX, y - previousY));
    previousX = x;
    previousY = y;
  }
  return fraction => {
    const distance = ((fraction % 1 + 1) % 1) * lengths[samples];
    const index = lengths.findIndex(length => length > distance);
    const previous = lengths[index - 1];
    return step * (index - 1 + (distance - previous) / (lengths[index] - previous));
  };
}

export function layoutEllipticalTree(
  nodes: NavNode[],
  edges: NavLink[],
  session: ExtendedNavNode,
  expanded: ReadonlySet<string>,
  width: number,
  height: number
) {
  const root: TreeEntry = { data: session, children: [], originalDepth: 0, continuesOutsidePage: false, leaves: 0 };
  const entries = new Map(nodes.map((node): [string, TreeEntry] => [node.id, {
    data: { ...node },
    children: [],
    originalDepth: 0,
    continuesOutsidePage: false,
    leaves: 1,
  }]));
  const visiting = new Set<TreeEntry>();
  let brokenCycles = 0;
  function attach(entry: TreeEntry): void {
    if (entry.originalDepth > 0) return;
    visiting.add(entry);
    const originalParent = entry.data.parentId;
    const parent = entries.get(originalParent ?? '');
    const isCycle = parent !== undefined && visiting.has(parent);
    if (parent && !isCycle) attach(parent);
    const destination = parent && !isCycle ? parent : root;
    entry.originalDepth = destination.originalDepth + 1;
    entry.continuesOutsidePage = Boolean(originalParent && !parent);
    entry.data.isRoot = destination === root;
    entry.data.isSelfLoop = parent === entry || entry.data.isSelfLoop;
    if (isCycle && parent !== entry) brokenCycles++;
    destination.children.push(entry);
    visiting.delete(entry);
  }
  for (const entry of entries.values()) attach(entry);
  for (const entry of [root, ...entries.values()]) entry.children.sort(byTime);

  // Preserve endpoints of links that leave the parent-child chain.
  const protectedIds = new Set<string>();
  for (const edge of edges) {
    const source = entries.get(edge.source);
    const target = entries.get(edge.target);
    if (source && target && (target.data.parentId !== source.data.id ||
      source.data.tabId !== target.data.tabId || source === target)) {
      protectedIds.add(source.data.id);
      protectedIds.add(target.data.id);
    }
  }
  for (const entry of entries.values()) {
    if (entry.data.isSelfLoop || entry.data.hasFilteredChildren) protectedIds.add(entry.data.id);
  }

  const visibleTree = compactChains(root, protectedIds, expanded);
  const viewWidth = Math.max(1, width - 52);
  const viewHeight = Math.max(1, height - 60);
  const aspect = Math.max(0.45, Math.min(2.5, viewWidth / viewHeight));
  const unitX = Math.max(1, aspect);
  const unitY = Math.max(1, 1 / aspect);
  const angleAt = ellipseArc(unitX, unitY);
  const centerX = width / 2;
  const centerY = height / 2;

  const branches = visibleTree.children.map(entry => {
    const counts: number[] = [];
    measureBranch(entry, counts);
    const breadth = Math.max(...counts);
    return { entry, breadth, height: counts.length };
  });
  branches.sort((a, b) => b.breadth - a.breadth || b.height - a.height || byTime(a.entry, b.entry));
  const sectors = [0, 0.5, 0.75, 0.25].map(center => ({
    center, vertical: center === 0.25 || center === 0.75, used: 0, branches: [] as typeof branches,
  }));
  for (const branch of branches) {
    const shortAxis = branch.breadth > 1;
    const vertical = shortAxis === (aspect >= 1);
    let chosen = sectors[0];
    let bestScore = Infinity;
    for (const sector of sectors) {
      const penalty = sector.vertical === vertical ? 0 : branch.breadth * (shortAxis ? 1 : 0.5);
      const score = sector.used + penalty;
      if (score < bestScore) {
        chosen = sector;
        bestScore = score;
      }
    }
    chosen.used += branch.breadth;
    chosen.branches.push(branch);
  }

  const center: Placement = {
    entry: root, arc: 0, radius: 0, unitX: 0, unitY: 0,
    node: { data: session, x: centerX, y: centerY, depth: 0, originalDepth: 0, continuesOutsidePage: false },
  };
  const positions: Placement[] = [center];
  const levels: Placement[][] = [];
  function place(entry: TreeEntry, parent: Placement, start: number, end: number): void {
    const arc = (start + end) / 2;
    const angle = angleAt(arc);
    const depth = parent.node.depth + 1;
    const position: Placement = {
      entry, parent, arc, radius: 0, unitX: unitX * Math.cos(angle), unitY: unitY * Math.sin(angle),
      node: {
        data: entry.data, x: centerX, y: centerY, depth, originalDepth: entry.originalDepth,
        continuesOutsidePage: entry.continuesOutsidePage,
      },
    };
    positions.push(position);
    (levels[depth - 1] ??= []).push(position);
    let childStart = start;
    for (const child of entry.children) {
      const childEnd = childStart + (end - start) * child.leaves / entry.leaves;
      place(child, position, childStart, childEnd);
      childStart = childEnd;
    }
  }
  for (const sector of sectors) {
    if (!sector.branches.length) continue;
    // Keep the widest branch on the short axis and the deepest on the long axis,
    // even after more roots fill the rest of the sector.
    if (sector.vertical !== (aspect >= 1)) {
      sector.branches.sort((a, b) => b.height - a.height || byTime(a.entry, b.entry));
    }
    const [primary, ...neighbors] = sector.branches;
    const halfWidth = 0.125 * primary.breadth / sector.used;
    place(primary.entry, center, sector.center - halfWidth, sector.center + halfWidth);

    const before = { used: 0, branches: [] as typeof branches };
    const after = { used: 0, branches: [] as typeof branches };
    for (const branch of neighbors) {
      const half = before.used <= after.used ? before : after;
      half.used += branch.breadth;
      half.branches.push(branch);
    }
    function placeHalf(half: typeof before, start: number): void {
      half.branches.sort((a, b) => byTime(a.entry, b.entry));
      for (const branch of half.branches) {
        const end = start + (0.125 - halfWidth) * branch.breadth / half.used;
        place(branch.entry, center, start, end);
        start = end;
      }
    }
    placeHalf(before, sector.center - 0.125);
    placeHalf(after, sector.center + halfWidth);
  }

  let radius = 0;
  const rings = levels.map((level, index) => {
    radius += MIN_RING_GAP;
    if (level.length > 1) {
      level.sort((a, b) => a.arc - b.arc);
      level.forEach((position, slot) => {
        const next = level[(slot + 1) % level.length];
        const separation = Math.max(Math.abs(position.unitX - next.unitX) / 84,
          Math.abs(position.unitY - next.unitY) / 63);
        radius = Math.max(radius, 1 / separation);
      });
    }
    for (const position of level) {
      position.radius = radius;
      position.node.x += position.unitX * radius;
      position.node.y += position.unitY * radius;
    }
    return { depth: index + 1, rx: radius * unitX, ry: radius * unitY };
  });

  const links: EllipticalTreeLink[] = [];
  for (const target of positions) {
    const source = target.parent;
    if (!source) continue;
    const middle = (source.radius + target.radius) / 2;
    const start = source.node.depth === 0 ? target : source;
    const firstX = centerX + start.unitX * middle;
    const firstY = centerY + start.unitY * middle;
    const secondX = centerX + target.unitX * middle;
    const secondY = centerY + target.unitY * middle;
    links.push({
      target: target.node,
      path: `M${source.node.x},${source.node.y} C${firstX},${firstY} ${secondX},${secondY} ${target.node.x},${target.node.y}`,
      fold: target.entry.fold,
      x: (source.node.x + 3 * (firstX + secondX) + target.node.x) / 8,
      y: (source.node.y + 3 * (firstY + secondY) + target.node.y) / 8,
    });
  }
  const fitScale = Math.min(1, viewWidth / (2 * radius * unitX + 108), viewHeight / (2 * radius * unitY + 86));
  return { nodes: positions.map(position => position.node), links, rings, centerX, centerY, fitScale, brokenCycles };
}
