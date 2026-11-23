import { _ } from '../../../lib/utils/i18n.js';
import { TREE_LAYOUT_LIMIT, type TreeDayNode } from '../../../lib/graph/tree-day.js';
import type { NavNode } from '../../types/navigation.js';

interface Branch {
  row: TreeDayNode;
  parent?: Branch;
  children: Branch[];
  count: number;
}

export type TreeDayFocus = { kind: 'branches' | 'run'; ids: string[] };

export interface TreeDayFold {
  focus: TreeDayFocus;
  count: number;
  reloads?: number;
}

export function indexTreeDay(rows: TreeDayNode[]) {
  const byId = new Map<string, Branch>();
  // The day query returns newest first. Keep siblings chronological in the tree.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    byId.set(row.id, { row, children: [], count: 1 });
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
    const { parent, count } = ordered[i];
    if (parent) parent.count += count;
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

export function projectTreeDay(tree: ReturnType<typeof indexTreeDay>, focus?: TreeDayFocus) {
  const nodes: NavNode[] = [];
  const folds = new Map<string, TreeDayFold>();
  const roots = focus ? focus.ids.flatMap(id => {
    const branch = tree.byId.get(id);
    return branch ? [branch] : [];
  }) : tree.roots;

  const addGroup = (branches: Branch[], kind: TreeDayFocus['kind'], parentId?: string) => {
    const first = branches[0].row;
    const id = `tree-day:${kind}:${first.id}`;
    const count = kind === 'run' ? branches.length : branches.reduce((sum, branch) => sum + branch.count, 0);
    nodes.push({ id, type: 'unknown', timestamp: first.timestamp, parentId,
      title: new Date(first.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    folds.set(id, { count, focus: { kind, ids: branches.map(branch => branch.row.id) } });
  };

  if (focus?.kind === 'run') {
    if (roots.length <= TREE_LAYOUT_LIMIT) {
      roots.forEach(branch => nodes.push(visibleNode(branch, branch.parent?.row.id)));
    } else {
      const size = Math.ceil(roots.length / TREE_LAYOUT_LIMIT);
      for (let i = 0; i < roots.length; i += size) addGroup(roots.slice(i, i + size), 'run');
    }
    return { nodes, folds };
  }

  const pending: { branches: Branch[]; parentId?: string }[] = [];
  const enqueue = (branches: Branch[], slots: number, parentId?: string) => {
    const size = Math.ceil(branches.length / slots);
    for (let i = 0; i < branches.length; i += size) pending.push({ branches: branches.slice(i, i + size), parentId });
  };
  enqueue(roots, TREE_LAYOUT_LIMIT);
  for (let i = 0; i < pending.length; i++) {
    const { branches, parentId } = pending[i];
    const first = branches[0];
    if (branches.length > 1) {
      addGroup(branches, 'branches', parentId);
      continue;
    }
    const run = [first];
    let tail = first;
    while (tail.children.length === 1) {
      const child = tail.children[0];
      if (!first.row.site || child.row.site !== first.row.site || !sameTab(first, child) ||
          child.row.keep || child.children.length > 1 || child.children.some(next => !sameTab(child, next))) break;
      run.push(child);
      tail = child;
    }
    const remaining = TREE_LAYOUT_LIMIT - nodes.length - (pending.length - i - 1);
    if (remaining === 1 && tail.children.length) {
      // At the viewport budget, give the rest of the subtree one selectable representative.
      addGroup(branches, 'branches', parentId);
      continue;
    }
    const outsideParent = !focus && !tree.byId.has(first.row.parentId ?? '') ? first.row.parentId : undefined;
    nodes.push(visibleNode(first, parentId ?? outsideParent));
    if (run.length > 1) {
      folds.set(first.row.id, { count: run.length - 1,
        reloads: run.slice(1).filter(branch => branch.row.type === 'reload').length,
        focus: { kind: 'run', ids: run.map(branch => branch.row.id) } });
    }
    if (tail.children.length) enqueue(tail.children, remaining - 1, first.row.id);
  }
  return { nodes, folds };
}
