import type { ExtendedNavNode, NavNode } from '../../types/navigation.js';

const ROOT_RING_GAP = 128;
const MIN_RING_GAP = 86;
const TRACK_GAP = 80;
const NODE_BOX_HEIGHT = 66;
const BEND_LENGTH = 72;

interface TreeEntry {
  data: ExtendedNavNode;
  children: TreeEntry[];
  originalDepth: number;
  continuesOutsidePage: boolean;
}

export interface EllipticalTreeNode {
  data: ExtendedNavNode;
  x: number;
  y: number;
  depth: number;
  originalDepth: number;
  continuesOutsidePage: boolean;
}

interface Track {
  side: 1 | -1;
  y: number;
  halfWidth: number;
}

interface Guide {
  startX: number;
  startY: number;
  targetY: number;
}

interface Placement {
  entry: TreeEntry;
  track: Track;
  guide: Guide;
  parent?: Placement;
  x: number;
  y: number;
  depth: number;
}

interface Subtree {
  entry: TreeEntry;
  leaves: number;
}

export interface EllipticalTreeLink {
  source: EllipticalTreeNode;
  target: EllipticalTreeNode;
  path: string;
  x: number;
  y: number;
}

function byTime(a: TreeEntry, b: TreeEntry): number {
  return a.data.timestamp - b.data.timestamp || a.data.id.localeCompare(b.data.id);
}

function countLeaves(entry: TreeEntry): number {
  return entry.children.reduce((total, child) => total + countLeaves(child), 0) || 1;
}

export function treeNodeTitle(data: ExtendedNavNode): string {
  const title = data.title || '';
  return title.length > 15 ? title.substring(0, 12) + '...' : title;
}

function balance(subtrees: Subtree[]): [Subtree[], Subtree[]] {
  const first: Subtree[] = [];
  const second: Subtree[] = [];
  let firstLeaves = 0;
  let secondLeaves = 0;
  for (const subtree of subtrees) {
    if (firstLeaves <= secondLeaves) {
      first.push(subtree);
      firstLeaves += subtree.leaves;
    } else {
      second.push(subtree);
      secondLeaves += subtree.leaves;
    }
  }
  return [first, second];
}

function allocateTracks(root: TreeEntry): Map<string, Track> {
  const subtrees = root.children.map(entry => ({ entry, leaves: countLeaves(entry) }));
  subtrees.sort((a, b) => b.leaves - a.leaves || byTime(a.entry, b.entry));
  const tracks = new Map<string, Track>();
  const [right, left] = balance(subtrees);
  for (const { side, branches } of [{ side: 1, branches: right }, { side: -1, branches: left }] as const) {
    const [upper, lower] = balance(branches);
    for (const { group, above } of [{ group: upper, above: true }, { group: lower, above: false }]) {
      const leaves = group.reduce((total, branch) => total + branch.leaves, 0);
      let lane = above ? -(TRACK_GAP + (leaves - 1) * TRACK_GAP) : TRACK_GAP;
      function assign(entry: TreeEntry): number {
        const children = entry.children.map(assign);
        const middle = Math.floor(children.length / 2);
        let y: number;
        if (children.length === 0) {
          y = lane;
          lane += TRACK_GAP;
        } else {
          y = children.length % 2 ? children[middle] : (children[middle - 1] + children[middle]) / 2;
        }
        const halfWidth = Math.max(27, 6 * treeNodeTitle(entry.data).length + 4);
        tracks.set(entry.data.id, { side, y, halfWidth });
        return y;
      }
      group.sort((a, b) => byTime(a.entry, b.entry)).forEach(({ entry }) => assign(entry));
    }
  }
  return tracks;
}

function guideY(guide: Guide, x: number): number {
  return guide.targetY + (guide.startY - guide.targetY) * Math.exp((guide.startX - x) / BEND_LENGTH);
}

function reachRadius(guide: Guide, aspect: number, tolerance: number, minimumX = 0): number {
  const difference = Math.abs(guide.targetY - guide.startY);
  const reach = guide.startX + BEND_LENGTH * Math.max(0, Math.log(difference / tolerance));
  const x = Math.max(minimumX, reach);
  return Math.hypot(x / aspect, guideY(guide, x));
}

function placeOnRing(position: Placement, radius: number, aspect: number): void {
  let low = position.parent!.x;
  let high = radius * aspect;
  for (let iteration = 0; iteration < 29; iteration++) {
    const x = (low + high) / 2;
    if (Math.hypot(x / aspect, guideY(position.guide, x)) < radius) low = x;
    else high = x;
  }
  position.x = (low + high) / 2;
  position.y = guideY(position.guide, position.x);
}

function overlaps(placements: Placement[]): boolean {
  const sorted = [...placements].sort((a, b) => a.y - b.y);
  for (const [index, a] of sorted.entries()) {
    for (let next = index + 1; next < sorted.length; next++) {
      const b = sorted[next];
      if (b.y - a.y >= NODE_BOX_HEIGHT) break;
      if (Math.abs(a.x * a.track.side - b.x * b.track.side) < a.track.halfWidth + b.track.halfWidth) return true;
    }
  }
  return false;
}

function placeTree(root: TreeEntry, tracks: ReadonlyMap<string, Track>, aspect: number) {
  const center: Placement = {
    entry: root, track: { side: 1, y: 0, halfWidth: 36 }, guide: { startX: 0, startY: 0, targetY: 0 },
    depth: 0, x: 0, y: 0,
  };
  const placements = [center];
  const radii: number[] = [];
  const largestBox = Math.max(36, ...Array.from(tracks.values(), track => track.halfWidth));
  const boxDiagonal = Math.hypot(2 * largestBox / aspect, NODE_BOX_HEIGHT);
  // Boxes two rings apart already clear each other. Check the adjacent ring when placing nodes.
  const gap = Math.max(MIN_RING_GAP, boxDiagonal / 2);
  let parents = [center];
  let radius = 0;
  for (let depth = 1; parents.length > 0; depth++) {
    const level = parents.flatMap(parent => parent.entry.children.map((entry): Placement => {
      const track = tracks.get(entry.data.id)!;
      // A unary child or the middle child of an odd fork stays on the parent curve.
      const guide = parent.guide.targetY === track.y
        ? parent.guide
        : { startX: parent.x, startY: parent.y, targetY: track.y };
      return { entry, track, guide, parent, depth, x: 0, y: 0 };
    }));
    if (!level.length) break;
    radius += depth === 1 ? ROOT_RING_GAP : gap;
    for (const placement of level) {
      if (placement.entry.children.length > 1) {
        // Reach the middle of the reserved track before splitting in opposite directions.
        radius = Math.max(radius, reachRadius(placement.guide, aspect, TRACK_GAP / 4));
      }
    }
    const placeLevel = (distance: number) => level.forEach(position => placeOnRing(position, distance, aspect));
    placeLevel(radius);
    const neighboringNodes = [...parents, ...level];
    if (overlaps(neighboringNodes)) {
      // Widen this ring until its visible node and title boxes have space.
      let low = radius;
      let high = Math.max(radius, (radii[depth - 2] ?? 0) + boxDiagonal, ...level.map(({ guide, track }) =>
        reachRadius(guide, aspect, (TRACK_GAP - NODE_BOX_HEIGHT) / 2, track.halfWidth)));
      for (let attempt = 0; attempt < 12; attempt++) {
        const candidate = (low + high) / 2;
        placeLevel(candidate);
        if (overlaps(neighboringNodes)) low = candidate;
        else high = candidate;
      }
      radius = high;
      placeLevel(radius);
    }
    radii.push(radius);
    placements.push(...level);
    parents = level;
  }
  return { placements, radii };
}

function branchPath(source: Placement, target: Placement, centerX: number, centerY: number): string {
  const { guide, track } = target;
  const length = target.x - source.x;
  const steps = Math.ceil(length / BEND_LENGTH);
  const step = length / steps;
  // Short cubic spans share the analytic curve's tangents at every junction.
  let path = `M${centerX + track.side * source.x},${centerY + source.y}`;
  let x = source.x;
  let y = source.y;
  for (let index = 1; index <= steps; index++) {
    const endX = index === steps ? target.x : source.x + index * step;
    const endY = guideY(guide, endX);
    const handle = (endX - x) / 3;
    const firstY = y + (guide.targetY - y) * handle / BEND_LENGTH;
    const secondY = endY - (guide.targetY - endY) * handle / BEND_LENGTH;
    path += ` C${centerX + track.side * (x + handle)},${centerY + firstY} ${centerX + track.side * (endX - handle)},${centerY + secondY} ${centerX + track.side * endX},${centerY + endY}`;
    x = endX;
    y = endY;
  }
  return path;
}

export function layoutEllipticalTree(
  nodes: NavNode[],
  session: ExtendedNavNode,
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

  const viewWidth = Math.max(1, width - 52);
  const viewHeight = Math.max(1, height - 60);
  const aspect = Math.max(1.2, Math.min(2.5, viewWidth / viewHeight));
  const centerX = width / 2;
  const centerY = height / 2;
  const tracks = allocateTracks(root);
  const { placements, radii } = placeTree(root, tracks, aspect);
  const treeNodes = new Map<Placement, EllipticalTreeNode>(placements.map(placement => [
    placement, {
      data: placement.entry.data,
      x: centerX + placement.track.side * placement.x,
      y: centerY + placement.y,
      depth: placement.depth,
      originalDepth: placement.entry.originalDepth,
      continuesOutsidePage: placement.entry.continuesOutsidePage,
    },
  ]));
  const links: EllipticalTreeLink[] = [];
  for (const target of placements) {
    const source = target.parent;
    if (!source) continue;
    const middle = (source.x + target.x) / 2;
    links.push({
      source: treeNodes.get(source)!,
      target: treeNodes.get(target)!,
      path: branchPath(source, target, centerX, centerY),
      x: centerX + target.track.side * middle,
      y: centerY + guideY(target.guide, middle),
    });
  }
  const rings = radii.map((radius, index) => ({ depth: index + 1, rx: radius * aspect, ry: radius }));
  const outer = radii[radii.length - 1] ?? 0;
  const fitScale = Math.min(1, viewWidth / (2 * outer * aspect + 108), viewHeight / (2 * outer + 86));
  return { nodes: [...treeNodes.values()], links, rings, centerX, centerY, fitScale, brokenCycles };
}
