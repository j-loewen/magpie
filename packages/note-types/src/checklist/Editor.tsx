import { useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { ActionIcon, Box, Checkbox, Group, Menu, Progress, Switch, Text, Textarea, UnstyledButton } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { IconDots, IconGripVertical, IconPlus, IconSquare, IconTrash, IconX } from '@tabler/icons-react';
import { cleanText } from '../define';
import type { NoteEditorProps } from '../editor-kit/types';
import { MAX_INDENT, newItemId, parseChecklistLines, type ChecklistContent, type ChecklistItem } from './index';
import classes from './Checklist.module.css';

const INDENT_PX = 26;
type Focus = { id: string; at: number | 'end' };
interface Drag {
  id: string;
  startY: number;
  dy: number;
  /** Drop before this item; null = at the end. */
  beforeId: string | null;
}

const textStyle = { padding: '2px 0', minHeight: 0, lineHeight: 1.5, fontSize: 'var(--mantine-font-size-md)' };
const doneStyle = { textDecoration: 'line-through', color: 'var(--mantine-color-dimmed)' };

const ind = (i: ChecklistItem) => i.indent ?? 0;
const clampIndent = (n: number) => Math.max(0, Math.min(MAX_INDENT, n));

/** End (exclusive) of the item at `index` together with its sub-items. */
function blockEnd(items: ChecklistItem[], index: number) {
  const base = ind(items[index]!);
  let end = index + 1;
  while (end < items.length && ind(items[end]!) > base) end++;
  return end;
}

/** Move items [from, end) so they start before `beforeId` (null = end), fixing their indent to fit there. */
function moveBlock(items: ChecklistItem[], from: number, end: number, beforeId: string | null): ChecklistItem[] {
  const block = items.slice(from, end);
  const rest = [...items.slice(0, from), ...items.slice(end)];
  let at = beforeId === null ? rest.length : rest.findIndex((i) => i.id === beforeId);
  if (at < 0) at = rest.length;
  const maxBase = at === 0 ? 0 : ind(rest[at - 1]!) + 1;
  const shift = Math.min(ind(block[0]!), maxBase) - ind(block[0]!);
  const moved = shift ? block.map((i) => ({ ...i, indent: clampIndent(ind(i) + shift) })) : block;
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

/** Whether the caret can leave the field upwards/downwards (single visual line, or at the very start/end). */
function atEdge(el: HTMLTextAreaElement, dir: 'up' | 'down') {
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
  if (el.scrollHeight < lineHeight * 1.8) return true;
  return dir === 'up' ? el.selectionStart === 0 : el.selectionEnd === el.value.length;
}

export default function ChecklistEditor({ value, onChange, readOnly, viewMode }: NoteEditorProps<ChecklistContent>) {
  const items = value.items;
  // Ticking items off is using the list, not editing it: allowed in view mode too.
  const canTick = !readOnly || Boolean(viewMode);
  const [hideDone, setHideDone] = useLocalStorage({ key: 'notes.checklist.hideDone', defaultValue: false });
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const rows = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<Focus | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const visible = hideDone ? items.filter((i) => !i.done) : items;
  const doneCount = items.filter((i) => i.done).length;

  // Focus the item an action asked for once it is rendered.
  useLayoutEffect(() => {
    const f = pendingFocus.current;
    const el = f && inputs.current.get(f.id);
    if (!f || !el) return;
    pendingFocus.current = null;
    el.focus();
    const pos = f.at === 'end' ? el.value.length : Math.min(f.at, el.value.length);
    el.setSelectionRange(pos, pos);
  });

  const commit = (next: ChecklistItem[], focus?: Focus) => {
    pendingFocus.current = focus ?? null;
    onChange({ ...value, items: next });
  };
  const indexOf = (id: string) => items.findIndex((i) => i.id === id);

  /** Checking an item also checks its sub-items (and unchecking unchecks them). */
  const toggle = (id: string) => {
    const idx = indexOf(id);
    const done = !items[idx]!.done;
    const end = blockEnd(items, idx);
    commit(items.map((it, k) => (k >= idx && k < end ? { ...it, done } : it)));
  };

  const setIndent = (idx: number, indent: number, caret: number) => {
    const shift = clampIndent(indent) - ind(items[idx]!);
    if (!shift) return;
    const end = blockEnd(items, idx);
    commit(
      items.map((it, k) => (k >= idx && k < end ? { ...it, indent: clampIndent(ind(it) + shift) } : it)),
      { id: items[idx]!.id, at: caret },
    );
  };

  const append = (text: string) => {
    const item: ChecklistItem = { id: newItemId(), text, done: false, indent: 0 };
    commit([...items, item], { id: item.id, at: 'end' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, item: ChecklistItem) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const idx = indexOf(item.id);
    const vIdx = visible.findIndex((i) => i.id === item.id);
    const prev = visible[vIdx - 1];
    const next = visible[vIdx + 1];
    const { selectionStart: start, selectionEnd: end } = el;
    const collapsed = start === end;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return toggle(item.id);
      // Enter on an empty sub-item moves it out one level, like in most outliners.
      if (item.text === '' && ind(item) > 0) return setIndent(idx, ind(item) - 1, 0);
      const created: ChecklistItem = { id: newItemId(), text: item.text.slice(end), done: false, indent: ind(item) };
      const out = [...items];
      out[idx] = { ...item, text: item.text.slice(0, start) };
      out.splice(idx + 1, 0, created);
      return commit(out, { id: created.id, at: 0 });
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) return setIndent(idx, ind(item) - 1, start);
      if (prev) setIndent(idx, Math.min(ind(item) + 1, ind(prev) + 1), start);
      return;
    }
    if (e.key === 'Backspace' && collapsed && start === 0) {
      if (ind(item) > 0) {
        e.preventDefault();
        return setIndent(idx, ind(item) - 1, 0);
      }
      if (prev) {
        // Join this item onto the end of the previous one.
        e.preventDefault();
        const out = items.filter((i) => i.id !== item.id).map((i) => (i.id === prev.id ? { ...i, text: i.text + item.text } : i));
        return commit(out, { id: prev.id, at: prev.text.length });
      }
      if (item.text === '' && next) {
        e.preventDefault();
        return commit(items.filter((i) => i.id !== item.id), { id: next.id, at: 0 });
      }
      return;
    }
    if (e.key === 'Delete' && collapsed && start === el.value.length && next) {
      e.preventDefault();
      const out = items.filter((i) => i.id !== next.id).map((i) => (i.id === item.id ? { ...i, text: i.text + next.text } : i));
      return commit(out, { id: item.id, at: start });
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const bEnd = blockEnd(items, idx);
      if (e.key === 'ArrowUp') {
        // Before the previous item at the same level or above.
        let p = idx - 1;
        while (p > 0 && ind(items[p]!) > ind(item)) p--;
        if (p >= 0) commit(moveBlock(items, idx, bEnd, items[p]!.id), { id: item.id, at: start });
      } else if (bEnd < items.length) {
        const after = blockEnd(items, bEnd);
        commit(moveBlock(items, idx, bEnd, items[after]?.id ?? null), { id: item.id, at: start });
      }
      return;
    }
    if (e.key === 'ArrowUp' && prev && atEdge(el, 'up')) {
      e.preventDefault();
      inputs.current.get(prev.id)?.focus();
      inputs.current.get(prev.id)?.setSelectionRange(start, start);
      return;
    }
    if (e.key === 'ArrowDown' && next && atEdge(el, 'down')) {
      e.preventDefault();
      const target = inputs.current.get(next.id);
      target?.focus();
      target?.setSelectionRange(start, start);
    }
  };

  /** Pasting several lines creates one item per line ("- [x] …" task syntax is understood). */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>, item: ChecklistItem | null) => {
    const text = cleanText(e.clipboardData.getData('text/plain'));
    if (!text.includes('\n')) return;
    e.preventDefault();
    const parsed = parseChecklistLines(text);
    if (!parsed.length) return;
    if (!item) {
      const last = parsed[parsed.length - 1]!;
      return commit([...items, ...parsed], { id: last.id, at: 'end' });
    }
    const el = e.currentTarget;
    const idx = indexOf(item.id);
    const before = item.text.slice(0, el.selectionStart);
    const after = item.text.slice(el.selectionEnd);
    const first = parsed[0]!;
    const rest = parsed.slice(1);
    const added = rest.map((r) => ({ ...r, indent: clampIndent(ind(item) + ind(r)) }));
    const out = [...items];
    out[idx] = { ...item, text: before + first.text + (added.length ? '' : after) };
    const tail = added[added.length - 1];
    if (tail) added[added.length - 1] = { ...tail, text: tail.text + after };
    out.splice(idx + 1, 0, ...added);
    const last = added[added.length - 1] ?? out[idx];
    commit(out, { id: last.id, at: last.text.length - after.length });
  };

  // ---- Drag to reorder (pointer events, so it works with mouse and touch) ----------------

  const dragBlockIds = (id: string) => {
    const idx = indexOf(id);
    return new Set(items.slice(idx, blockEnd(items, idx)).map((i) => i.id));
  };

  const onHandleDown = (e: PointerEvent<HTMLDivElement>, id: string) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, startY: e.clientY, dy: 0, beforeId: id });
  };

  const onHandleMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const moving = dragBlockIds(drag.id);
    // Drop before the first (not dragged) row whose middle is below the pointer.
    let beforeId: string | null = null;
    for (const item of visible) {
      if (moving.has(item.id)) continue;
      const rect = rows.current.get(item.id)?.getBoundingClientRect();
      if (rect && e.clientY < rect.top + rect.height / 2) {
        beforeId = item.id;
        break;
      }
    }
    setDrag({ ...drag, dy: e.clientY - drag.startY, beforeId });
  };

  const onHandleUp = () => {
    if (!drag) return;
    setDrag(null);
    const idx = indexOf(drag.id);
    const end = blockEnd(items, idx);
    // Dropping right after itself changes nothing.
    if (drag.beforeId === drag.id || drag.beforeId === (items[end]?.id ?? null)) return;
    if (drag.beforeId === null && end === items.length) return;
    commit(moveBlock(items, idx, end, drag.beforeId));
  };

  const moving = drag ? dragBlockIds(drag.id) : null;
  const lastVisible = visible[visible.length - 1];
  const showDropMarker = drag && drag.beforeId !== drag.id;

  return (
    <Box style={{ maxWidth: 820 }}>
      <Group justify="space-between" mb="sm" gap="sm">
        {items.length > 0 ? (
          <Group gap="sm" wrap="nowrap" style={{ flex: 1, maxWidth: 360 }}>
            <Progress value={(doneCount / items.length) * 100} size="sm" style={{ flex: 1 }} aria-label="Progress" />
            <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {doneCount} of {items.length} done
            </Text>
          </Group>
        ) : (
          <span />
        )}
        <Group gap="xs" wrap="nowrap">
          <Switch size="xs" label="Hide done" checked={hideDone} onChange={(e) => setHideDone(e.currentTarget.checked)} />
          {!readOnly && (
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Checklist actions">
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconSquare size={16} />}
                  disabled={doneCount === 0}
                  onClick={() => commit(items.map((i) => (i.done ? { ...i, done: false } : i)))}
                >
                  Uncheck all
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  disabled={doneCount === 0}
                  onClick={() => commit(items.filter((i) => !i.done))}
                >
                  Delete done items
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>

      {visible.map((item) => {
        const isMoving = moving?.has(item.id);
        const cls = [
          classes.row,
          item.done && classes.done,
          isMoving && classes.dragging,
          showDropMarker && drag.beforeId === item.id && classes.dropBefore,
          showDropMarker && drag.beforeId === null && item === lastVisible && classes.dropAfter,
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={item.id}
            ref={(el) => {
              if (el) rows.current.set(item.id, el);
              else rows.current.delete(item.id);
            }}
            className={cls}
            style={{ marginLeft: ind(item) * INDENT_PX, ...(isMoving && { transform: `translateY(${drag!.dy}px)` }) }}
          >
            {!readOnly && (
              <div
                className={classes.handle}
                aria-label="Drag to reorder"
                onPointerDown={(e) => onHandleDown(e, item.id)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={() => setDrag(null)}
              >
                <IconGripVertical size={16} />
              </div>
            )}
            <Checkbox
              className={classes.checkbox}
              checked={item.done}
              disabled={!canTick}
              aria-label="Done"
              onChange={() => toggle(item.id)}
            />
            <Textarea
              className={classes.input}
              variant="unstyled"
              autosize
              minRows={1}
              styles={{ input: { ...textStyle, ...(item.done && doneStyle) } }}
              readOnly={readOnly}
              aria-label="Checklist item"
              placeholder={readOnly ? '' : 'List item'}
              ref={(el) => {
                if (el) inputs.current.set(item.id, el);
                else inputs.current.delete(item.id);
              }}
              value={item.text}
              onChange={(e) => {
                const text = e.currentTarget.value.replace(/\n/g, ' ');
                commit(items.map((i) => (i.id === item.id ? { ...i, text } : i)));
              }}
              onKeyDown={(e) => onKeyDown(e, item)}
              onPaste={(e) => onPaste(e, item)}
            />
            {!readOnly && (
              <ActionIcon
                className={classes.remove}
                variant="subtle"
                color="gray"
                size="sm"
                mt={2}
                aria-label="Delete item"
                onClick={() => {
                  const vIdx = visible.findIndex((i) => i.id === item.id);
                  const neighbour = visible[vIdx + 1] ?? visible[vIdx - 1];
                  commit(
                    items.filter((i) => i.id !== item.id),
                    neighbour ? { id: neighbour.id, at: 'end' } : undefined,
                  );
                }}
              >
                <IconX size={14} />
              </ActionIcon>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <div className={classes.row}>
          <div className={classes.handle} style={{ opacity: 0 }}>
            <IconGripVertical size={16} />
          </div>
          <Box className={classes.checkbox} c="dimmed" style={{ display: 'flex' }}>
            <IconPlus size={20} />
          </Box>
          <Textarea
            className={classes.input}
            variant="unstyled"
            styles={{ input: textStyle }}
            autosize
            minRows={1}
            aria-label="Add item"
            placeholder="Add item"
            value=""
            onChange={(e) => e.currentTarget.value.trim() && append(e.currentTarget.value.replace(/\n/g, ' '))}
            onPaste={(e) => onPaste(e, null)}
          />
        </div>
      )}

      {hideDone && doneCount > 0 && (
        <UnstyledButton mt="xs" onClick={() => setHideDone(false)}>
          <Text size="sm" c="dimmed">
            {doneCount} done {doneCount === 1 ? 'item' : 'items'} hidden · Show
          </Text>
        </UnstyledButton>
      )}
      {readOnly && items.length === 0 && (
        <Text c="dimmed" fs="italic">
          This list is empty.
        </Text>
      )}
    </Box>
  );
}
