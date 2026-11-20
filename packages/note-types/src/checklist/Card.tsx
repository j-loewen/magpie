import { Group, Progress, Stack, Text } from '@mantine/core';
import { IconSquare, IconSquareCheck } from '@tabler/icons-react';
import type { NoteCardProps } from '../editor-kit/types';
import { CHECKED, UNCHECKED } from './index';

/** Server meta for checklists (see the checklist hooks on the server). */
export interface ChecklistMeta {
  total: number;
  done: number;
}

/** Items shown on a card (masonry cards take the height they need). */
const PREVIEW_ITEMS = 5;
const EXPANDED_ITEMS = 12;

/** The card excerpt is the start of the search text: "☐ milk ☑ eggs …". */
function previewItems(excerpt: string, max: number) {
  return excerpt
    .split(new RegExp(`(?=[${CHECKED}${UNCHECKED}])`))
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && (s[0] === CHECKED || s[0] === UNCHECKED))
    .slice(0, max)
    .map((s) => ({ done: s[0] === CHECKED, text: s.slice(1).trim() }));
}

export function ChecklistCardBody({ excerpt, meta, expanded }: NoteCardProps) {
  const progress = meta as ChecklistMeta | undefined;
  const items = previewItems(excerpt, expanded ? EXPANDED_ITEMS : PREVIEW_ITEMS);
  if (!items.length) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        Empty list
      </Text>
    );
  }
  return (
    <Stack gap={4} mt={6}>
      {items.map((item, i) => (
        <Group key={i} gap={6} wrap="nowrap" c={item.done ? 'dimmed' : undefined}>
          {item.done ? <IconSquareCheck size={15} style={{ flexShrink: 0 }} /> : <IconSquare size={15} style={{ flexShrink: 0 }} />}
          <Text size="sm" truncate td={item.done ? 'line-through' : undefined}>
            {item.text || ' '}
          </Text>
        </Group>
      ))}
      {progress && progress.total > 0 && (
        <Group gap="xs" wrap="nowrap" mt={4}>
          <Progress value={(progress.done / progress.total) * 100} size="xs" style={{ flex: 1 }} aria-label="Progress" />
          <Text size="xs" c="dimmed">
            {progress.done}/{progress.total}
          </Text>
        </Group>
      )}
    </Stack>
  );
}
