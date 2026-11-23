import type { TreeDayNode } from '../../../lib/graph/tree-day.js';
import type { NavNode } from '../../types/navigation.js';

interface Branch {
  row: TreeDayNode;
  parent?: Branch;
  children: Branch[];
  count: number;
  commonSite: string;
}

export interface TreeDayFold {
  count: number;
  expanded: boolean;
  summary: boolean;
  reloads?: number;
  faviconPageId?: string;
}

export function indexTreeDay(rows: TreeDayNode[]) {
  const byId = new Map<string, Branch>();
  // The day query returns newest first. Keep siblings chronological in the tree.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    byId.set(row.id, { row, children: [], count: 1, commonSite: row.site });
  }
  for (const branch of byId.values()) branch.parent = byId.get(branch.row.parentId ?? '');

  const visited = new Set<Branch>();
  let brokenCycles = 0;
  for (const branch of byId.values()) {
    const path = new Set<Branch>();
    for (let cursor: Branch | undefined = branch; cursor && !visited.has(cursor); cursor = cursor.parent) {
      if (path.has(cursor)) {
        if (cursor.parent !== cursor) brokenCycles++;
        cursor.parent = undefined;
        break;
      }
      path.add(cursor);
    }
    for (const ancestor of path) visited.add(ancestor);
  }

  const roots: Branch[] = [];
  for (const branch of byId.values()) {
    if (branch.parent) branch.parent.children.push(branch);
    else roots.push(branch);
  }
  const ordered = roots.slice();
  for (let i = 0; i < ordered.length; i++) {
    for (const child of ordered[i].children) ordered.push(child);
  }
  for (let i = ordered.length - 1; i >= 0; i--) {
    const { parent, count, commonSite } = ordered[i];
    if (parent) {
      parent.count += count;
      if (parent.commonSite !== commonSite) parent.commonSite = '';
    }
  }
  return { roots, byId, brokenCycles };
}

function sameTab(a: Branch, b: Branch): boolean {
  return a.row.sessionId === b.row.sessionId && a.row.tabId === b.row.tabId;
}

function visibleNode({ row }: Branch, parentId?: string): NavNode {
  return { id: row.id, type: row.type, timestamp: row.timestamp, title: row.site,
    parentId, tabId: row.tabId, sessionId: row.sessionId, isClosed: row.isClosed,
    isSelfLoop: row.parentId === row.id };
}

function partition(branches: Branch[], slots: number): Branch[][] {
  const size = Math.min(branches.length, slots);
  return Array.from({ length: size }, (_, i) =>
    branches.slice(Math.floor(i * branches.length / size), Math.floor((i + 1) * branches.length / size)));
}

export function projectTreeDay(
  tree: ReturnType<typeof indexTreeDay>,
  width: number,
  height: number,
  opened: ReadonlySet<string>,
) {
  const nodes: NavNode[] = [];
  const folds = new Map<string, TreeDayFold>();
  const candidates = new Map<string, { kind: 'branches' | 'run'; branches: Branch[] }>();
  const span = Math.min(width - 52, height - 60);
  const siblingSlots = Math.max(2, Math.floor(span / 6));
  // Summary controls keep their screen size when the rings shrink to fit.
  const summarySlots = Math.max(2, Math.floor(span / 48));
  const depthSlots = Math.max(2, Math.floor((width - 52) / 28));
  const overviewBudget = 2 * siblingSlots;

  const addFold = (id: string, kind: 'branches' | 'run', branches: Branch[], summary: boolean, faviconPageId?: string) => {
    const count = kind === 'run' ? branches.length : branches.reduce((sum, branch) => sum + branch.count, 0);
    folds.set(id, { count, expanded: false, summary, faviconPageId,
      reloads: kind === 'run' ? branches.filter(branch => branch.row.type === 'reload').length : undefined });
    if (opened.has(id)) candidates.set(id, { kind, branches });
  };

  const addGroup = (branches: Branch[], kind: 'branches' | 'run', parentId?: string, faviconPageId?: string): string => {
    const first = branches[0].row;
    const last = branches[branches.length - 1].row;
    const id = `tree-day:${kind}:${first.id}:${last.id}`;
    const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const title = first.id === last.id ? first.site || time(first.timestamp) : `${time(first.timestamp)}–${time(last.timestamp)}`;
    nodes.push({ id, type: 'unknown', timestamp: first.timestamp, parentId, title });
    const site = branches[0].commonSite;
    if (kind === 'branches' && site && branches.every(branch => branch.commonSite === site)) {
      faviconPageId = first.id;
    }
    addFold(id, kind, branches, true, faviconPageId);
    return id;
  };

  const projectBranches = (roots: Branch[], budget: number, parentId?: string) => {
    const pending: { branches: Branch[]; parentId?: string; depth: number }[] = [];
    const enqueue = (branches: Branch[], available: number, depth: number, parent?: string) => {
      const slots = Math.min(available, siblingSlots);
      const limit = branches.length >= 2 * slots ? Math.min(slots, summarySlots) : slots;
      for (const bucket of partition(branches, limit)) pending.push({ branches: bucket, parentId: parent, depth });
    };
    enqueue(roots, budget, 1, parentId);
    const start = nodes.length;
    for (let i = 0; i < pending.length; i++) {
      const { branches, parentId, depth } = pending[i];
      const first = branches[0];
      if (branches.length > 1) {
        addGroup(branches, 'branches', parentId);
        continue;
      }
      const middle: Branch[] = [];
      let tail = first;
      while (tail.children.length === 1) {
        const child = tail.children[0];
        if (!first.row.site || child.row.site !== first.row.site || !sameTab(first, child) ||
            child.row.keep || child.children.length > 1 || child.children.some(next => !sameTab(child, next))) break;
        middle.push(child);
        tail = child;
      }
      const remaining = budget - (nodes.length - start) - (pending.length - i - 1);
      if ((remaining === 1 || depth >= depthSlots) && tail.children.length) {
        addGroup(branches, 'branches', parentId);
        continue;
      }
      const outsideParent = !tree.byId.has(first.row.parentId ?? '') ? first.row.parentId : undefined;
      nodes.push(visibleNode(first, parentId ?? outsideParent));
      if (middle.length) addFold(first.row.id, 'run', middle, false, first.row.id);
      if (tail.children.length) enqueue(tail.children, remaining - 1, depth + 1, first.row.id);
    }
  };

  projectBranches(tree.roots, overviewBudget);
  // Materialize requested details after placing the overview. An open group cannot evict its neighbors.
  for (const id of opened) {
    const candidate = candidates.get(id);
    if (!candidate) continue;
    const remaining = overviewBudget + siblingSlots - nodes.length;
    const { kind, branches } = candidate;
    if (remaining < 2 && !(remaining === 1 && kind === 'run' && branches.length === 1)) continue;
    const fold = folds.get(id)!;
    fold.expanded = true;
    if (kind === 'branches') {
      projectBranches(branches, Math.min(siblingSlots, remaining), id);
      continue;
    }

    const successors = nodes.filter(node => node.parentId === id);
    let parentId = id;
    const runSlots = Math.max(2, Math.floor((width - 52) / 96));
    // Short runs use the actual pages. Large runs reveal selectable ranges on the same branch.
    const parts = branches.length <= Math.min(depthSlots, remaining)
      ? partition(branches, branches.length) : partition(branches, Math.min(runSlots, remaining));
    for (const part of parts) {
      if (part.length === 1) {
        nodes.push(visibleNode(part[0], parentId));
        parentId = part[0].row.id;
      } else {
        parentId = addGroup(part, 'run', parentId, fold.faviconPageId);
      }
    }
    for (const successor of successors) successor.parentId = parentId;
  }
  return { nodes, folds };
}
