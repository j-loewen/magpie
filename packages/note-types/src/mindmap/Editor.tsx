import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ActionIcon, Box, Divider, Group, Kbd, Paper, Popover, Stack, Text, Tooltip } from '@mantine/core';
import { useElementSize, useMergedRef } from '@mantine/hooks';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconFocusCentered,
  IconKeyboard,
  IconMinus,
  IconPencil,
  IconPlus,
  IconRowInsertBottom,
  IconSubtask,
  IconTrash,
} from '@tabler/icons-react';
import type { NoteEditorProps } from '../editor-kit/types';
import { newNodeId, type MindmapContent, type MindNode } from './index';
import {
  countDescendants,
  edgePath,
  emptierSide,
  findNode,
  fixSides,
  fontFor,
  insertNode,
  layoutMap,
  LINE_HEIGHT,
  pathTo,
  removeNode,
  sideOf,
  updateNode,
  type Box as NodeBox,
} from './model';

const BRANCH_COLORS = ['blue', 'teal', 'grape', 'orange', 'pink', 'green', 'indigo', 'red', 'cyan', 'lime'];
const branchColor = (b: NodeBox) => (b.branch < 0 ? 'var(--mantine-primary-color-filled)' : `var(--mantine-color-${BRANCH_COLORS[b.branch % BRANCH_COLORS.length]}-6)`);
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const HISTORY_LIMIT = 100;

interface Editing {
  id: string;
  text: string;
  /** Created just now: leaving it empty removes it again. */
  isNew: boolean;
}
interface DropTarget {
  id: string;
  mode: 'child' | 'before' | 'after';
}
interface NodeDrag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  /** Pointer position in map coordinates. */
  x: number;
  y: number;
  target: DropTarget | null;
}

const SHORTCUTS: [string, string][] = [
  ['Tab', 'Add a subtopic'],
  ['Enter', 'Add a topic below (while typing: finish)'],
  ['F2 or double-click', 'Edit the topic'],
  ['Just type', 'Replace the topic text'],
  ['Delete', 'Delete the topic and its subtopics'],
  ['Space', 'Fold or unfold'],
  ['Arrow keys', 'Move between topics'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Drag a topic', 'Onto a topic: make it a subtopic; to its top or bottom edge: reorder'],
  ['Drag the background', 'Pan (Ctrl+wheel or pinch to zoom)'],
];

export default function MindmapEditor({ value, onChange, readOnly }: NoteEditorProps<MindmapContent>) {
  const { ref: sizeRef, width, height } = useElementSize();
  const containerRef = useRef<HTMLDivElement>(null);
  const mergedRef = useMergedRef(sizeRef, containerRef);
  const [fontFamily, setFamily] = useState<string | null>(null);
  const family = fontFamily ?? 'sans-serif';
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState(value.root.id);
  const [editing, setEditingState] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  const setEditing = (e: Editing | null) => {
    editingRef.current = e;
    setEditingState(e);
  };
  // Viewers can fold branches for themselves without changing the note.
  const [localFolds, setLocalFolds] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<NodeDrag | null>(null);
  const dragRef = useRef<NodeDrag | null>(null);
  const valueRef = useRef(value);
  const history = useRef({ past: [] as MindmapContent[], future: [] as MindmapContent[] });
  // Content replaced from outside (someone else's change arrived, or a conflict was resolved):
  // undoing past it would silently throw that change away, so start a fresh history.
  if (value !== valueRef.current) {
    valueRef.current = value;
    history.current = { past: [], future: [] };
  }
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // Measure text with the same font the page uses.
  useLayoutEffect(() => {
    if (containerRef.current) setFamily(getComputedStyle(containerRef.current).fontFamily || 'sans-serif');
  }, []);
  const measure = useMemo(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    const cache = new Map<string, number>();
    return (text: string, font: string) => {
      const key = `${font}|${text}`;
      let w = cache.get(key);
      if (w === undefined) {
        if (ctx) ctx.font = font;
        w = ctx ? ctx.measureText(text).width : text.length * 8;
        cache.set(key, w);
      }
      return w;
    };
  }, []);

  const layout = useMemo(
    () => layoutMap(value.root, family, measure, readOnly ? localFolds : undefined),
    [value.root, family, measure, readOnly, localFolds],
  );
  const rootBox = layout.byId.get(value.root.id)!;
  const selBox = layout.byId.get(selected) ?? rootBox;
  const isFolded = (n: MindNode) => (readOnly && localFolds.has(n.id) ? !n.collapsed : Boolean(n.collapsed));

  // ---- View ------------------------------------------------------------------------------

  const fit = useCallback(() => {
    if (!width || !height) return;
    const { minX, minY, maxX, maxY } = layout.bounds;
    const k = Math.max(MIN_ZOOM, Math.min(1.25, (width - 60) / (maxX - minX), (height - 80) / (maxY - minY)));
    setView({ k, x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k + 16 });
  }, [layout, width, height]);

  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && width && height && fontFamily) {
      fitted.current = true;
      fit();
    }
  }, [width, height, fontFamily, fit]);

  const zoomAt = (factor: number, cx = width / 2, cy = height / 2) =>
    setView((v) => {
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });

  // Wheel: pan; Ctrl+wheel (and trackpad pinch): zoom. Needs a non-passive listener to stop page scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 33 : 1;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * scale * 0.0025), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX * scale, y: v.y - e.deltaY * scale }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Keep the selected topic on screen.
  useEffect(() => {
    if (!width || !height) return;
    const margin = 40;
    const left = view.x + selBox.x * view.k;
    const top = view.y + selBox.y * view.k;
    const right = left + selBox.w * view.k;
    const bottom = top + selBox.h * view.k;
    const dx = left < margin ? margin - left : right > width - margin ? width - margin - right : 0;
    const dy = top < margin + 40 ? margin + 40 - top : bottom > height - margin ? height - margin - bottom : 0;
    if (dx || dy) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, layout]);

  // ---- Changes (with undo) -----------------------------------------------------------------

  const apply = (root: MindNode, opts: { select?: string; edit?: Editing; record?: boolean } = {}) => {
    if (opts.record !== false) {
      const h = history.current;
      h.past.push(valueRef.current);
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
      h.future = [];
    }
    const next = { ...valueRef.current, root };
    valueRef.current = next;
    onChange(next);
    if (opts.select) setSelected(opts.select);
    if (opts.edit) setEditing(opts.edit);
    rerender();
  };

  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(valueRef.current);
    valueRef.current = prev;
    onChange(prev);
    rerender();
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(valueRef.current);
    valueRef.current = next;
    onChange(next);
    rerender();
  };

  const focusMap = () => containerRef.current?.focus({ preventScroll: true });

  const addChild = (parentId: string) => {
    let root = valueRef.current.root;
    if (!findNode(root, parentId)) return;
    const node: MindNode = { id: newNodeId(), text: '', children: [] };
    if (parentId === root.id) {
      root = fixSides(root);
      node.side = emptierSide(root);
    }
    apply(insertNode(root, parentId, node), { select: node.id, edit: { id: node.id, text: '', isNew: true } });
  };

  const addSibling = (id: string) => {
    let root = valueRef.current.root;
    if (id === root.id) return addChild(id);
    root = fixSides(root);
    const path = pathTo(root, id);
    const parent = path[path.length - 2];
    const current = path[path.length - 1];
    if (!parent || !current) return;
    const node: MindNode = { id: newNodeId(), text: '', children: [], ...(parent.id === root.id && { side: current.side }) };
    apply(insertNode(root, parent.id, node, parent.children.indexOf(current) + 1), {
      select: node.id,
      edit: { id: node.id, text: '', isNew: true },
    });
  };

  const remove = (id: string) => {
    const root = valueRef.current.root;
    if (id === root.id) return;
    const path = pathTo(fixSides(root), id);
    const parent = path[path.length - 2];
    if (!parent) return;
    const i = parent.children.findIndex((c) => c.id === id);
    const next = parent.children[i + 1] ?? parent.children[i - 1] ?? parent;
    // Fix sides first so the remaining main branches stay where they are.
    apply(removeNode(fixSides(root), id), { select: next.id });
  };

  const toggleFold = (id: string) => {
    const node = findNode(valueRef.current.root, id);
    if (!node || !node.children.length || id === valueRef.current.root.id) return;
    if (readOnly) {
      setLocalFolds((s) => {
        const next = new Set(s);
        if (!next.delete(id)) next.add(id);
        return next;
      });
      return;
    }
    apply(updateNode(valueRef.current.root, id, ({ collapsed, ...n }) => (collapsed ? n : { ...n, collapsed: true })));
  };

  const startEdit = (id: string, text?: string) => {
    if (readOnly) return;
    const node = findNode(valueRef.current.root, id);
    if (node) setEditing({ id, text: text ?? node.text, isNew: false });
  };

  /** Drop a just-created topic that was left empty (undoing its creation). */
  const dropNew = (id: string) => {
    const prev = history.current.past.pop();
    if (prev && !findNode(prev.root, id)) {
      valueRef.current = prev;
      onChange(prev);
      rerender();
    } else {
      if (prev) history.current.past.push(prev);
      apply(removeNode(valueRef.current.root, id));
    }
  };

  const commitEdit = (then?: (id: string) => void) => {
    const e = editingRef.current;
    if (!e) return;
    setEditing(null);
    const text = e.text.trim();
    if (e.isNew && !text) {
      const parent = pathTo(valueRef.current.root, e.id).at(-2);
      dropNew(e.id);
      if (parent) setSelected(parent.id);
    } else if (text !== findNode(valueRef.current.root, e.id)?.text) {
      // Typing into a new topic belongs to the same undo step as creating it.
      apply(updateNode(valueRef.current.root, e.id, (n) => ({ ...n, text })), { record: !e.isNew });
    }
    if (then) then(e.id);
    else focusMap();
  };

  const cancelEdit = () => {
    const e = editingRef.current;
    if (!e) return;
    setEditing(null);
    if (e.isNew) {
      const parent = pathTo(valueRef.current.root, e.id).at(-2);
      dropNew(e.id);
      if (parent) setSelected(parent.id);
    }
    focusMap();
  };

  // ---- Keyboard ----------------------------------------------------------------------------

  const navigate = (key: string) => {
    const b = selBox;
    const siblings = layout.boxes.filter((x) => x.parent === b.parent && x.side === b.side);
    const kids = layout.boxes.filter((x) => x.parent === b);
    const middle = (list: NodeBox[]) => list[Math.floor((list.length - 1) / 2)];
    let target: NodeBox | undefined | null;
    if (key === 'ArrowUp') target = b.parent && siblings[siblings.indexOf(b) - 1];
    else if (key === 'ArrowDown') target = b.parent && siblings[siblings.indexOf(b) + 1];
    else {
      const outward = key === 'ArrowRight' ? 'right' : 'left';
      if (b.side === 'root') target = middle(kids.filter((k) => k.side === outward));
      else if (b.side === outward) target = kids[0] && middle(kids);
      else target = b.parent;
    }
    if (target) setSelected(target.node.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editingRef.current || e.nativeEvent.isComposing || (e.target as Element).closest('[data-ui]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const id = selBox.node.id;
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      return navigate(e.key);
    }
    if (e.key === ' ') {
      e.preventDefault();
      return toggleFold(id);
    }
    if (readOnly) return;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      return redo();
    }
    if (mod || e.altKey) return;
    switch (e.key) {
      case 'Tab':
      case 'Insert':
        e.preventDefault();
        return addChild(id);
      case 'Enter':
        e.preventDefault();
        return addSibling(id);
      case 'F2':
        e.preventDefault();
        return startEdit(id);
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        return remove(id);
      default:
        if (e.key.length === 1) {
          e.preventDefault();
          startEdit(id, e.key);
        }
    }
  };

  // ---- Pointer: pan / pinch on the background ------------------------------------------------

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onBgDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('[data-node], [data-ui]')) return;
    if (editingRef.current) commitEdit();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    focusMap();
  };
  const onBgMove = (e: PointerEvent<HTMLDivElement>) => {
    const pts = pointers.current;
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    if (pts.size === 1) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      setView((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
      return;
    }
    // Two fingers: zoom around their midpoint.
    const a = [...pts.entries()].find(([id]) => id !== e.pointerId)?.[1];
    const b = prev;
    if (!a) return;
    const before = Math.hypot(a.x - b.x, a.y - b.y);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const after = Math.hypot(a.x - e.clientX, a.y - e.clientY);
    const rect = e.currentTarget.getBoundingClientRect();
    if (before > 0) zoomAt(after / before, (a.x + e.clientX) / 2 - rect.left, (a.y + e.clientY) / 2 - rect.top);
  };
  const onBgUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  // ---- Pointer: drag topics ------------------------------------------------------------------

  const toMap = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  };

  const onNodeDown = (e: PointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (editingRef.current && editingRef.current.id !== id) commitEdit();
    setSelected(id);
    focusMap();
    if (readOnly || id === value.root.id) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toMap(e.clientX, e.clientY);
    dragRef.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false, ...p, target: null };
  };

  const onNodeMove = (e: PointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
    const p = toMap(e.clientX, e.clientY);
    const dragged = findNode(valueRef.current.root, d.id);
    const inside = new Set<string>();
    const mark = (n: MindNode) => {
      inside.add(n.id);
      n.children.forEach(mark);
    };
    if (dragged) mark(dragged);
    let target: DropTarget | null = null;
    for (const b of layout.boxes) {
      if (inside.has(b.node.id)) continue;
      if (p.x < b.x - 4 || p.x > b.x + b.w + 4 || p.y < b.y - 6 || p.y > b.y + b.h + 6) continue;
      const rel = (p.y - b.y) / b.h;
      target = { id: b.node.id, mode: b.depth === 0 ? 'child' : rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'child' };
      break;
    }
    const next = { ...d, active: true, ...p, target };
    dragRef.current = next;
    setDrag(next);
  };

  const onNodeUp = (e: PointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    if (!d.active) return;
    let root = fixSides(valueRef.current.root);
    const node = findNode(root, d.id);
    if (!node) return;
    const isMainBranch = root.children.some((c) => c.id === d.id);
    if (!d.target) {
      // Dropped on empty space: a main branch can switch sides.
      const side = d.x < 0 ? 'left' : 'right';
      if (isMainBranch && node.side !== side) apply(updateNode(root, d.id, (n) => ({ ...n, side })));
      return;
    }
    const { side: _side, ...plain } = node;
    root = removeNode(root, d.id);
    if (d.target.mode === 'child') {
      const moved = d.target.id === root.id ? { ...plain, side: (d.x < 0 ? 'left' : 'right') as MindNode['side'] } : plain;
      root = insertNode(root, d.target.id, moved);
    } else {
      const path = pathTo(root, d.target.id);
      const parent = path[path.length - 2];
      const target = path[path.length - 1];
      if (!parent || !target) return;
      const moved = parent.id === root.id ? { ...plain, side: target.side } : plain;
      root = insertNode(root, parent.id, moved, parent.children.indexOf(target) + (d.target.mode === 'after' ? 1 : 0));
    }
    apply(root, { select: d.id });
  };

  // ---- Editing overlay -----------------------------------------------------------------------

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editBox = editing ? layout.byId.get(editing.id) : undefined;
  const editWidth = editBox ? Math.max(editBox.w, 180) * view.k + 4 : 0;
  const editingId = editing?.id;
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (editingRef.current && !editingRef.current.isNew && editingRef.current.text.length > 1) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [editingId]);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editing?.text, view.k]);

  useEffect(() => {
    if (editing && !layout.byId.has(editing.id)) setEditing(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // ---- Render ----------------------------------------------------------------------------

  const dragged = drag?.active ? findNode(value.root, drag.id) : undefined;
  const draggedIds = new Set<string>();
  if (dragged) {
    const mark = (n: MindNode) => {
      draggedIds.add(n.id);
      n.children.forEach(mark);
    };
    mark(dragged);
  }
  const targetBox = drag?.target ? layout.byId.get(drag.target.id) : undefined;
  const canUndo = history.current.past.length > 0;
  const canRedo = history.current.future.length > 0;

  return (
    <Box
      ref={mergedRef}
      tabIndex={0}
      role="application"
      aria-label="Mind map"
      onKeyDown={onKeyDown}
      onPointerDown={onBgDown}
      onPointerMove={onBgMove}
      onPointerUp={onBgUp}
      onPointerCancel={onBgUp}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 420,
        overflow: 'hidden',
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
        background: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8))',
        touchAction: 'none',
        outline: 'none',
        userSelect: 'none',
      }}
    >
      <svg width={width} height={height} style={{ display: 'block' }}>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {layout.boxes.map(
            (b) =>
              b.parent && (
                <path
                  key={`e-${b.node.id}`}
                  d={edgePath(b.parent, b)}
                  fill="none"
                  opacity={draggedIds.has(b.node.id) ? 0.3 : 1}
                  style={{ stroke: branchColor(b), strokeWidth: b.depth === 1 ? 2.5 : 1.75 }}
                />
              ),
          )}
          {layout.boxes.map((b) => {
            const m = b.metrics;
            const isSel = b === selBox;
            const isRoot = b.depth === 0;
            const folded = b.node.children.length > 0 && isFolded(b.node);
            const showToggle = !isRoot && b.node.children.length > 0 && (folded || isSel);
            const toggleX = b.side === 'left' ? b.x - 12 : b.x + b.w + 12;
            const empty = !b.node.text.trim();
            return (
              <g
                key={b.node.id}
                data-node
                opacity={draggedIds.has(b.node.id) ? 0.35 : 1}
                onPointerDown={(e) => onNodeDown(e, b.node.id)}
                onPointerMove={onNodeMove}
                onPointerUp={onNodeUp}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setDrag(null);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEdit(b.node.id);
                }}
                style={{ cursor: readOnly || isRoot ? 'pointer' : 'grab' }}
              >
                {isSel && (
                  <rect
                    x={b.x - 4}
                    y={b.y - 4}
                    width={b.w + 8}
                    height={b.h + 8}
                    rx={m.radius + 4}
                    fill="none"
                    style={{ stroke: 'var(--mantine-primary-color-filled)', strokeWidth: 2 }}
                  />
                )}
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  rx={m.radius}
                  style={
                    isRoot
                      ? { fill: 'var(--mantine-primary-color-filled)' }
                      : b.depth === 1
                        ? { fill: 'var(--mantine-color-body)', stroke: branchColor(b), strokeWidth: 2 }
                        : { fill: 'var(--mantine-color-body)', stroke: 'var(--mantine-color-default-border)', strokeWidth: 1 }
                  }
                />
                {editing?.id !== b.node.id && (
                  <text
                    style={{
                      font: fontFor(m, family),
                      fill: isRoot ? 'var(--mantine-primary-color-contrast)' : empty ? 'var(--mantine-color-dimmed)' : 'var(--mantine-color-text)',
                      fontStyle: empty ? 'italic' : undefined,
                    }}
                  >
                    {(empty ? ['Topic'] : b.lines).map((line, i) => (
                      <tspan key={i} x={b.x + m.padX} y={b.y + m.padY + m.fontSize * (LINE_HEIGHT * i + 0.98)}>
                        {line || ' '}
                      </tspan>
                    ))}
                  </text>
                )}
                {showToggle && (
                  <g
                    data-ui
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFold(b.node.id);
                    }}
                  >
                    <circle cx={toggleX} cy={b.y + b.h / 2} r={9} style={{ fill: 'var(--mantine-color-body)', stroke: branchColor(b), strokeWidth: 1.5 }} />
                    <text
                      x={toggleX}
                      y={b.y + b.h / 2 + 3.5}
                      textAnchor="middle"
                      style={{ font: `600 10px ${family}`, fill: 'var(--mantine-color-text)' }}
                    >
                      {folded ? Math.min(99, countDescendants(b.node)) : '−'}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          {targetBox && drag?.target && (
            drag.target.mode === 'child' ? (
              <rect
                x={targetBox.x - 5}
                y={targetBox.y - 5}
                width={targetBox.w + 10}
                height={targetBox.h + 10}
                rx={targetBox.metrics.radius + 5}
                fill="none"
                style={{ stroke: 'var(--mantine-color-teal-6)', strokeWidth: 2.5, strokeDasharray: '6 4' }}
              />
            ) : (
              <line
                x1={targetBox.x}
                x2={targetBox.x + targetBox.w}
                y1={drag.target.mode === 'before' ? targetBox.y - 7 : targetBox.y + targetBox.h + 7}
                y2={drag.target.mode === 'before' ? targetBox.y - 7 : targetBox.y + targetBox.h + 7}
                style={{ stroke: 'var(--mantine-color-teal-6)', strokeWidth: 3, strokeLinecap: 'round' }}
              />
            )
          )}
          {dragged && drag && (
            <g opacity={0.85} pointerEvents="none">
              <rect
                x={drag.x + 8}
                y={drag.y + 8}
                width={Math.min(240, Math.max(60, dragged.text.length * 8))}
                height={28}
                rx={7}
                style={{ fill: 'var(--mantine-color-body)', stroke: 'var(--mantine-primary-color-filled)', strokeWidth: 1.5 }}
              />
              <text x={drag.x + 18} y={drag.y + 27} style={{ font: `400 14px ${family}`, fill: 'var(--mantine-color-text)' }}>
                {dragged.text.length > 28 ? `${dragged.text.slice(0, 27)}…` : dragged.text || 'Topic'}
              </text>
            </g>
          )}
        </g>
      </svg>

      {editing && editBox && (
        <textarea
          key={editing.id}
          ref={textareaRef}
          aria-label="Topic text"
          value={editing.text}
          maxLength={5000}
          rows={1}
          onChange={(e) => setEditing({ ...editing, text: e.currentTarget.value })}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === 'Tab') {
              e.preventDefault();
              commitEdit((id) => (e.shiftKey ? addSibling(id) : addChild(id)));
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
          onBlur={() => editingRef.current?.id === editing.id && commitEdit()}
          style={{
            position: 'absolute',
            // Grow away from the root: rightwards on the right, leftwards on the left, both ways for the root.
            left:
              editBox.side === 'left'
                ? view.x + (editBox.x + editBox.w) * view.k + 2 - editWidth
                : editBox.side === 'root'
                  ? view.x + (editBox.x + editBox.w / 2) * view.k - editWidth / 2
                  : view.x + editBox.x * view.k - 2,
            top: view.y + editBox.y * view.k - 2,
            width: editWidth,
            font: fontFor({ ...editBox.metrics, fontSize: editBox.metrics.fontSize * view.k }, family),
            lineHeight: LINE_HEIGHT,
            padding: `${editBox.metrics.padY * view.k}px ${editBox.metrics.padX * view.k}px`,
            border: '2px solid var(--mantine-primary-color-filled)',
            borderRadius: editBox.metrics.radius * view.k,
            background: 'var(--mantine-color-body)',
            color: 'var(--mantine-color-text)',
            resize: 'none',
            outline: 'none',
            overflow: 'hidden',
            zIndex: 3,
            boxShadow: 'var(--mantine-shadow-md)',
          }}
        />
      )}

      {/* Toolbar */}
      <Paper data-ui withBorder shadow="xs" radius="md" p={4} style={{ position: 'absolute', top: 8, left: 8, zIndex: 4 }}>
        <Group gap={2} wrap="nowrap">
          {!readOnly && (
            <>
              <ToolButton label="Add subtopic (Tab)" onClick={() => addChild(selBox.node.id)} icon={<IconSubtask size={18} />} />
              <ToolButton
                label="Add topic below (Enter)"
                onClick={() => addSibling(selBox.node.id)}
                icon={<IconRowInsertBottom size={18} />}
              />
              <ToolButton label="Edit topic (F2)" onClick={() => startEdit(selBox.node.id)} icon={<IconPencil size={18} />} />
              <ToolButton
                label="Delete topic (Delete)"
                disabled={selBox.depth === 0}
                onClick={() => remove(selBox.node.id)}
                icon={<IconTrash size={18} />}
              />
              <Divider orientation="vertical" mx={2} />
              <ToolButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} icon={<IconArrowBackUp size={18} />} />
              <ToolButton label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo} icon={<IconArrowForwardUp size={18} />} />
              <Divider orientation="vertical" mx={2} />
            </>
          )}
          <Popover position="bottom-start" shadow="md" withinPortal>
            <Popover.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Keyboard shortcuts">
                <IconKeyboard size={18} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown data-ui>
              <Stack gap={6}>
                {(readOnly ? SHORTCUTS.filter(([k]) => ['Space', 'Arrow keys', 'Drag the background'].includes(k)) : SHORTCUTS).map(([k, d]) => (
                  <Group key={k} gap="sm" wrap="nowrap" justify="space-between">
                    <Kbd size="xs">{k}</Kbd>
                    <Text size="xs" ta="right">
                      {d}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Paper>

      <Paper data-ui withBorder shadow="xs" radius="md" p={4} style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 4 }}>
        <Group gap={2} wrap="nowrap">
          <ToolButton label="Zoom out" onClick={() => zoomAt(1 / 1.25)} icon={<IconMinus size={16} />} />
          <Text size="xs" w={40} ta="center" c="dimmed">
            {Math.round(view.k * 100)}%
          </Text>
          <ToolButton label="Zoom in" onClick={() => zoomAt(1.25)} icon={<IconPlus size={16} />} />
          <ToolButton label="Fit to screen" onClick={fit} icon={<IconFocusCentered size={16} />} />
        </Group>
      </Paper>
    </Box>
  );
}

function ToolButton({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Tooltip label={label} openDelay={300}>
      <ActionIcon variant="subtle" color="gray" aria-label={label} disabled={disabled} onClick={onClick}>
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}
