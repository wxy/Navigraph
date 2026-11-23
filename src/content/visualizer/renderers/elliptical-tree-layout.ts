import type { ExtendedNavNode, NavLink, NavNode } from '../../types/navigation.js';

const d3: typeof import('d3') = window.d3;
const ROOT_RING_GAP = 128;
const MIN_RING_GAP = 86;
const MIN_FOLDED_PAGES = 3;
const FULL_TURN = Math.PI * 2;
const ROOT_BRANCH_HALF_TURN = 2 * Math.PI / 9;
const FORK_HALF_TURN_LIMIT = Math.PI / 3;

interface ChainFold {
  id: string;
  count: number;
  expanded: boolean;
  endpointId: string;
}

interface TreeEntry {
  data: ExtendedNavNode;
  children: TreeEntry[];
  originalDepth: number;
  continuesOutsidePage: boolean;
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
  children: Placement[];
  arc: number;
  unitX: number;
  unitY: number;
}

export interface EllipticalTreeLink {
  source: EllipticalTreeNode;
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

    const fold = {
      id: first.data.id, count: middle.length, expanded: expanded.has(first.data.id), endpointId: endpoint.data.id,
    };
    const tail = compactChains(endpoint, protectedIds, expanded);
    const visible = fold.expanded
      ? middle.reduceRight((child, page) => ({ ...page, children: [child] }), tail)
      : tail;
    return { ...visible, fold };
  });
  return { ...entry, children };
}

function countLeaves(entry: TreeEntry): number {
  return entry.children.reduce((total, child) => total + countLeaves(child), 0) || 1;
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
  const root: TreeEntry = { data: session, children: [], originalDepth: 0, continuesOutsidePage: false };
  const entries = new Map(nodes.map((node): [string, TreeEntry] => [node.id, {
    data: { ...node },
    children: [],
    originalDepth: 0,
    continuesOutsidePage: false,
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

  // Balance the two sides by leaf count, which tracks the vertical space each
  // subtree needs. Keep the siblings of each subtree together.
  const right = { direction: 1, leaves: 0, children: [] as TreeEntry[] };
  const left = { direction: -1, leaves: 0, children: [] as TreeEntry[] };
  const branches = visibleTree.children.map(entry => ({ entry, leaves: countLeaves(entry) }));
  branches.sort((a, b) => b.leaves - a.leaves || byTime(a.entry, b.entry));
  for (const branch of branches) {
    const side = left.leaves < right.leaves ? left : right;
    side.children.push(branch.entry);
    side.leaves += branch.leaves;
  }

  const tidyTree: d3.TreeLayout<TreeEntry> = d3.tree();
  tidyTree.nodeSize([1, 1]).separation((a, b) => a.parent === b.parent ? 1 : 1.35);
  const sides = [left, right].filter(side => side.children.length > 0).map(side => {
    const hierarchy = d3.hierarchy({ ...visibleTree, children: side.children.sort(byTime) }, entry => entry.children);
    return { direction: side.direction, tree: tidyTree(hierarchy) };
  });
  let verticalExtent = 0;
  for (const { tree } of sides) {
    tree.each(node => { verticalExtent = Math.max(verticalExtent, Math.abs(node.x)); });
  }
  // Leave half a node's spacing at the ends so both halves stay distinct.
  verticalExtent += 0.5;

  const center: Placement = {
    entry: root, children: [], arc: 0, unitX: 0, unitY: 0,
    node: { data: session, x: centerX, y: centerY, depth: 0, originalDepth: 0, continuesOutsidePage: false },
  };
  const positions: Placement[] = [center];
  const levels: Placement[][] = [];
  for (const { direction, tree } of sides) {
    const placed = new Map<d3.HierarchyPointNode<TreeEntry>, Placement>([[tree, center]]);
    tree.eachBefore(node => {
      if (!node.parent) return;
      // Project the tidy tree's vertical order onto this half of each ellipse.
      const arc = (direction === 1 ? 0 : 0.5) + direction * node.x / (4 * verticalExtent);
      const angle = angleAt(arc);
      const entry = node.data;
      const position: Placement = {
        entry, children: [], arc,
        unitX: unitX * Math.cos(angle), unitY: unitY * Math.sin(angle),
        node: {
          data: entry.data, x: centerX, y: centerY, depth: node.depth, originalDepth: entry.originalDepth,
          continuesOutsidePage: entry.continuesOutsidePage,
        },
      };
      placed.get(node.parent)!.children.push(position);
      placed.set(node, position);
      positions.push(position);
      (levels[node.depth - 1] ??= []).push(position);
    });
  }

  let radius = 0;
  const rings = levels.map((level, index) => {
    // Leave enough of the first arc visible outside the date and page circles.
    radius += index === 0 ? ROOT_RING_GAP : MIN_RING_GAP;
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
      position.node.x += position.unitX * radius;
      position.node.y += position.unitY * radius;
    }
    return { depth: index + 1, rx: radius * unitX, ry: radius * unitY };
  });

  const reachBySide = new Map(sides.map(({ direction, tree }) => {
    const ring = rings[tree.height - 1];
    return [direction, Math.max(ring.rx, ring.ry)] as const;
  }));
  const lowerRootBySide = new Map<number, { inclination: number; departure: number }>();
  const links: EllipticalTreeLink[] = [];
  function drawBranch(source: Placement, first: Placement, incomingDirection?: number): void {
    const branch = [first];
    let tip = first;
    while (true) {
      const continuation = tip.children.find(child => child.arc === tip.arc);
      if (!continuation) break;
      branch.push(continuation);
      tip = continuation;
    }

    const anchor = incomingDirection === undefined ? first.node : tip.node;
    const dx = anchor.x - source.node.x;
    const dy = anchor.y - source.node.y;
    const chord = Math.hypot(dx, dy);
    const chordAngle = Math.atan2(dy, dx);
    const side = anchor.x > centerX ? 1 : -1;
    let arcRadius: number;
    let halfTurn: number;
    let bearing: number;
    if (incomingDirection === undefined) {
      // Size the arc to the visible half of the tree, including when a long chain is folded.
      const reach = reachBySide.get(side)!;
      const firstFraction = chord / reach;
      const inclination = Math.atan2(dy, Math.abs(dx));
      const poleMargin = (Math.PI / 2 - Math.abs(inclination)) / 3;
      const startRoom = Math.PI / 2 - poleMargin - inclination;
      const endRoom = Math.PI / 2 - poleMargin + inclination;
      // Constrain the bearings at the root and at maximum reach to stay inside this half.
      const beforeFirst = Math.asin(Math.min(1, Math.sin(Math.min(startRoom, Math.PI / 2)) / firstFraction));
      const afterFirst = Math.atan2(Math.sin(endRoom), Math.cos(endRoom) - firstFraction);
      const turnLimit = Math.min(ROOT_BRANCH_HALF_TURN, beforeFirst, afterFirst);
      arcRadius = reach / (2 * Math.sin(turnLimit));
      for (const target of branch.slice(1)) {
        const level = target.node.depth - 1;
        let clearance = Infinity;
        for (const neighbor of levels[level]) {
          if (neighbor.unitX * side <= 0) continue;
          const angle = Math.atan2(neighbor.unitY, Math.abs(neighbor.unitX));
          if (angle < inclination) clearance = Math.min(clearance, inclination - angle);
        }
        if (!Number.isFinite(clearance)) continue;
        // Keep the moved node near its original angular slot when a branch is above it.
        const turn = clearance / 8;
        const angle = inclination - turn;
        const x = side * Math.cos(angle);
        const y = Math.sin(angle);
        const ring = rings[level];
        const distance = 1 / Math.hypot(x / ring.rx, y / ring.ry);
        const across = Math.hypot(distance * x - dx, distance * y - dy);
        arcRadius = Math.max(arcRadius, across / (2 * Math.sin(turn)));
      }
      const lower = lowerRootBySide.get(side);
      if (lower) {
        // Keep the departure bearings in the same order as the first-level nodes.
        const gap = (lower.inclination - inclination) / 4;
        const limit = Math.min(ROOT_BRANCH_HALF_TURN, lower.departure - inclination - gap);
        arcRadius = Math.max(arcRadius, chord / (2 * Math.sin(limit)));
      }
      const firstTurn = Math.asin(chord / (2 * arcRadius));
      lowerRootBySide.set(side, { inclination, departure: inclination + firstTurn });
      halfTurn = -side * Math.asin(reach / (2 * arcRadius));
      bearing = chordAngle + side * firstTurn;
    } else {
      const delta = chordAngle - incomingDirection;
      const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
      const sign = Math.sign(turn) || -side;
      let limit = FORK_HALF_TURN_LIMIT;
      if (branch.length > 1) {
        // Bound the bow to one eighth of the ring gap when the arc moves intermediate nodes.
        limit = Math.min(limit, 2 * Math.atan(MIN_RING_GAP / (4 * chord)));
      }
      if (side * sign * Math.sin(chordAngle) < 0) {
        // Keep the inward bow of a fork within the same half of the graph.
        const clearance = Math.min(Math.abs(source.node.x - centerX), Math.abs(anchor.x - centerX));
        limit = Math.min(limit, 2 * Math.atan(2 * clearance / Math.abs(dy)));
      }
      halfTurn = sign * Math.min(limit, Math.max(Math.abs(turn), Math.PI / 180));
      arcRadius = chord / (2 * Math.abs(Math.sin(halfTurn)));
      bearing = chordAngle - halfTurn;
    }

    const pointAt = (progress: number) => {
      const turn = halfTurn * progress;
      const distance = 2 * arcRadius * Math.abs(Math.sin(turn));
      return {
        x: source.node.x + distance * Math.cos(bearing + turn),
        y: source.node.y + distance * Math.sin(bearing + turn),
      };
    };
    const sweep = halfTurn > 0 ? 1 : 0;
    let progress = 0;
    let previous = source;
    branch.forEach((target, index) => {
      const start = progress;
      if (target.node === anchor) {
        progress = incomingDirection === undefined ? Math.asin(chord / (2 * arcRadius)) / Math.abs(halfTurn) : 1;
      } else {
        // Intersect the shared arc with this node's level ellipse.
        const ring = rings[target.node.depth - 1];
        let low = start;
        let high = 1;
        for (let step = 0; step < 28; step++) {
          progress = (low + high) / 2;
          const point = pointAt(progress);
          const distance = Math.hypot((point.x - centerX) / ring.rx, (point.y - centerY) / ring.ry);
          if (distance < 1) low = progress;
          else high = progress;
        }
        Object.assign(target.node, pointAt(progress));
      }
      links.push({
        source: previous.node,
        target: target.node,
        path: `M${previous.node.x},${previous.node.y} A${arcRadius},${arcRadius} 0 0 ${sweep} ${target.node.x},${target.node.y}`,
        fold: target.entry.fold,
        ...pointAt((start + progress) / 2),
      });
      previous = target;
      for (const child of target.children) {
        if (child !== branch[index + 1]) drawBranch(target, child, bearing + 2 * halfTurn * progress);
      }
    });
  }
  // Process each side from bottom to top so each root arc can respect its lower neighbor.
  center.children.sort((a, b) => Math.atan2(b.unitY, Math.abs(b.unitX)) - Math.atan2(a.unitY, Math.abs(a.unitX)));
  for (const child of center.children) drawBranch(center, child);
  const fitScale = Math.min(1, viewWidth / (2 * radius * unitX + 108), viewHeight / (2 * radius * unitY + 86));
  return { nodes: positions.map(position => position.node), links, rings, centerX, centerY, fitScale, brokenCycles };
}
