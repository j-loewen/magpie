import type { MindNode } from './index';

// ---- Immutable tree helpers ---------------------------------------------------------------

/** Nodes from the root down to `id` (empty if not found). */
export function pathTo(root: MindNode, id: string): MindNode[] {
  if (root.id === id) return [root];
  for (const c of root.children) {
    const p = pathTo(c, id);
    if (p.length) return [root, ...p];
  }
  return [];
}

export const findNode = (root: MindNode, id: string) => pathTo(root, id).at(-1);

/** Replace the node `id` with `fn(node)`, copying only the nodes on its path. */
export function updateNode(root: MindNode, id: string, fn: (n: MindNode) => MindNode): MindNode {
  if (root.id === id) return fn(root);
  let changed = false;
  const children = root.children.map((c) => {
    const next = updateNode(c, id, fn);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

export function removeNode(root: MindNode, id: string): MindNode {
  if (!root.children.some((c) => c.id === id)) {
    let changed = false;
    const children = root.children.map((c) => {
      const next = removeNode(c, id);
      if (next !== c) changed = true;
      return next;
    });
    return changed ? { ...root, children } : root;
  }
  return { ...root, children: root.children.filter((c) => c.id !== id) };
}

export function insertNode(root: MindNode, parentId: string, node: MindNode, index?: number): MindNode {
  return updateNode(root, parentId, (p) => {
    const children = [...p.children];
    children.splice(index ?? children.length, 0, node);
    return { ...p, children, collapsed: false };
  });
}

export function countDescendants(node: MindNode): number {
  return node.children.reduce((n, c) => n + 1 + countDescendants(c), 0);
}

/** Side of each main branch: stored, or (for imported maps) the first half right, the rest left. */
export function sideOf(root: MindNode, index: number): 'left' | 'right' {
  return root.children[index]?.side ?? (index < Math.ceil(root.children.length / 2) ? 'right' : 'left');
}

/** Store every main branch's side so adding a branch never flips existing ones. */
export function fixSides(root: MindNode): MindNode {
  if (root.children.every((c) => c.side)) return root;
  return { ...root, children: root.children.map((c, i) => (c.side ? c : { ...c, side: sideOf(root, i) })) };
}

/** The side with fewer topics, for a new main branch. */
export function emptierSide(root: MindNode): 'left' | 'right' {
  let left = 0;
  let right = 0;
  root.children.forEach((c, i) => {
    const size = 1 + countDescendants(c);
    if (sideOf(root, i) === 'left') left += size;
    else right += size;
  });
  return left < right ? 'left' : 'right';
}

// ---- Layout -----------------------------------------------------------------------------

export interface Metrics {
  fontSize: number;
  fontWeight: number;
  padX: number;
  padY: number;
  radius: number;
}

export const metricsFor = (depth: number): Metrics =>
  depth === 0
    ? { fontSize: 18, fontWeight: 700, padX: 16, padY: 10, radius: 12 }
    : depth === 1
      ? { fontSize: 15, fontWeight: 600, padX: 12, padY: 7, radius: 9 }
      : { fontSize: 14, fontWeight: 400, padX: 10, padY: 5, radius: 7 };

export const LINE_HEIGHT = 1.35;
const MAX_TEXT_WIDTH = 240;
const H_GAP = 44;
const V_GAP = 10;
const V_GAP_MAIN = 18;

export interface Box {
  node: MindNode;
  depth: number;
  side: 'left' | 'right' | 'root';
  parent: Box | null;
  /** Index of the main branch, for its colour (-1 for the root). */
  branch: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  metrics: Metrics;
}

export type Measure = (text: string, font: string) => number;

/** Word-wrap text to at most MAX_TEXT_WIDTH, breaking words that are longer than a line. */
function wrap(text: string, font: string, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, font) <= MAX_TEXT_WIDTH) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      while (measure(line, font) > MAX_TEXT_WIDTH && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut), font) > MAX_TEXT_WIDTH) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

export const fontFor = (m: Metrics, family: string) => `${m.fontWeight} ${m.fontSize}px ${family}`;

export interface Layout {
  boxes: Box[];
  byId: Map<string, Box>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Classic two-sided mind map layout: root in the middle, main branches to its right and left. */
export function layoutMap(root: MindNode, family: string, measure: Measure, collapsedOverride?: Set<string>): Layout {
  const boxes: Box[] = [];
  const isCollapsed = (n: MindNode) => (collapsedOverride?.has(n.id) ? !n.collapsed : Boolean(n.collapsed));
  const visibleChildren = (n: MindNode) => (isCollapsed(n) ? [] : n.children);

  const sizeCache = new Map<MindNode, { w: number; h: number; lines: string[] }>();
  const size = (n: MindNode, depth: number) => {
    let s = sizeCache.get(n);
    if (!s) {
      const m = metricsFor(depth);
      const font = fontFor(m, family);
      const lines = wrap(n.text, font, measure);
      const textW = Math.max(...lines.map((l) => measure(l, font)), depth === 0 ? 60 : 28);
      s = { w: Math.ceil(textW + m.padX * 2), h: Math.ceil(lines.length * m.fontSize * LINE_HEIGHT + m.padY * 2), lines };
      sizeCache.set(n, s);
    }
    return s;
  };

  const heightCache = new Map<MindNode, number>();
  const subtreeHeight = (n: MindNode, depth: number): number => {
    let h = heightCache.get(n);
    if (h === undefined) {
      const kids = visibleChildren(n);
      const gap = depth === 0 ? V_GAP_MAIN : V_GAP;
      const kidsH = kids.reduce((sum, c) => sum + subtreeHeight(c, depth + 1), 0) + Math.max(0, kids.length - 1) * gap;
      h = Math.max(size(n, depth).h, kidsH);
      heightCache.set(n, h);
    }
    return h;
  };

  const place = (n: MindNode, depth: number, side: 'left' | 'right', edgeX: number, centerY: number, parent: Box, branch: number) => {
    const s = size(n, depth);
    const box: Box = {
      node: n,
      depth,
      side,
      parent,
      branch,
      x: side === 'right' ? edgeX : edgeX - s.w,
      y: centerY - s.h / 2,
      w: s.w,
      h: s.h,
      lines: s.lines,
      metrics: metricsFor(depth),
    };
    boxes.push(box);
    stack(visibleChildren(n), depth + 1, side, side === 'right' ? box.x + box.w + H_GAP : box.x - H_GAP, centerY, box, () => branch);
  };

  const stack = (
    kids: MindNode[],
    depth: number,
    side: 'left' | 'right',
    edgeX: number,
    centerY: number,
    parent: Box,
    branchOf: (n: MindNode) => number,
  ) => {
    const gap = depth === 1 ? V_GAP_MAIN : V_GAP;
    const total = kids.reduce((sum, c) => sum + subtreeHeight(c, depth), 0) + Math.max(0, kids.length - 1) * gap;
    let y = centerY - total / 2;
    for (const c of kids) {
      const h = subtreeHeight(c, depth);
      place(c, depth, side, edgeX, y + h / 2, parent, branchOf(c));
      y += h + gap;
    }
  };

  const rs = size(root, 0);
  const rootBox: Box = { node: root, depth: 0, side: 'root', parent: null, branch: -1, x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, lines: rs.lines, metrics: metricsFor(0) };
  boxes.push(rootBox);
  const kids = visibleChildren(root);
  const branchIndex = new Map(root.children.map((c, i) => [c, i]));
  const right = kids.filter((c) => sideOf(root, branchIndex.get(c)!) === 'right');
  const left = kids.filter((c) => sideOf(root, branchIndex.get(c)!) === 'left');
  const branchOf = (c: MindNode) => branchIndex.get(c)!;
  stack(right, 1, 'right', rootBox.x + rootBox.w + H_GAP + 12, 0, rootBox, branchOf);
  stack(left, 1, 'left', rootBox.x - H_GAP - 12, 0, rootBox, branchOf);

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const b of boxes) {
    bounds.minX = Math.min(bounds.minX, b.x);
    bounds.minY = Math.min(bounds.minY, b.y);
    bounds.maxX = Math.max(bounds.maxX, b.x + b.w);
    bounds.maxY = Math.max(bounds.maxY, b.y + b.h);
  }
  return { boxes, byId: new Map(boxes.map((b) => [b.node.id, b])), bounds };
}

/** Curved connector from a parent to a child box. */
export function edgePath(parent: Box, child: Box): string {
  const right = child.side === 'right';
  const x1 = parent.depth === 0 ? parent.x + parent.w / 2 + (right ? parent.w / 2 - 6 : -parent.w / 2 + 6) : right ? parent.x + parent.w : parent.x;
  const y1 = parent.y + parent.h / 2;
  const x2 = right ? child.x : child.x + child.w;
  const y2 = child.y + child.h / 2;
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}
