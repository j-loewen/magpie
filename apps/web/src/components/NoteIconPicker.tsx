import { useState } from 'react';
import {
  ActionIcon,
  Button,
  ColorPicker,
  ColorSwatch,
  Group,
  Popover,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconCheck, IconColorPicker, IconFileUnknown, IconSearch } from '@tabler/icons-react';
import type { NoteDto } from '@notes/shared';
import { getClientNoteType } from '@notes/note-types/client';
import { usePatchNote } from '../data';
import { NOTE_COLORS, NOTE_ICONS, readableOn } from '../lib/note-icons';
import { notifyError } from '../lib/notify';
import { NoteIcon } from './notes-ui';

const SIZE = 32;

/** The note's icon next to its title; click to choose an icon and a background colour. */
export function NoteIconPicker({ note, readOnly }: { note: NoteDto; readOnly: boolean }) {
  const patch = usePatchNote();
  const [query, setQuery] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customColor, setCustomColor] = useState(note.color ?? '#228be6');

  if (readOnly) return <NoteIcon note={note} size={SIZE} />;

  const set = (input: { icon?: string | null; color?: string | null }) =>
    patch.mutate({ id: note.id, ...input }, { onError: notifyError });

  const type = getClientNoteType(note.type);
  const defaultImage = type?.defaultIconImage?.(note.meta);
  const DefaultGlyph = type?.icon ?? IconFileUnknown;
  const defaultLabel = defaultImage ? 'Website icon' : `${type?.def.label ?? 'Note'} icon`;
  const isCustomColor = note.color !== null && !NOTE_COLORS.includes(note.color);
  const q = query.trim().toLowerCase();
  const icons = q ? NOTE_ICONS.filter((i) => i.words.includes(q)) : NOTE_ICONS;

  return (
    <Popover
      position="bottom-start"
      width={320}
      shadow="md"
      radius="md"
      onClose={() => {
        setQuery('');
        setCustomOpen(false);
      }}
    >
      <Popover.Target>
        <UnstyledButton
          aria-label="Change icon and colour"
          title="Change icon and colour"
          style={{ borderRadius: 'var(--mantine-radius-md)', flexShrink: 0, lineHeight: 0 }}
        >
          <NoteIcon note={note} size={SIZE} />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown p="sm">
        <Stack gap="xs">
          <SectionHeader label="Colour" resetLabel="Default" onReset={note.color ? () => set({ color: null }) : undefined} />
          <Group gap={6}>
            {NOTE_COLORS.map((c) => (
              <ColorSwatch
                key={c}
                component="button"
                type="button"
                color={c}
                size={24}
                aria-label={`Colour ${c}`}
                aria-pressed={note.color === c}
                style={{ cursor: 'pointer', color: readableOn(c) }}
                onClick={() => set({ color: c })}
              >
                {note.color === c && <IconCheck size={14} stroke={2.5} />}
              </ColorSwatch>
            ))}
            {isCustomColor ? (
              <ColorSwatch
                component="button"
                type="button"
                color={note.color!}
                size={24}
                aria-label="Custom colour"
                aria-pressed
                style={{ cursor: 'pointer', color: readableOn(note.color!) }}
                onClick={() => setCustomOpen((o) => !o)}
              >
                <IconCheck size={14} stroke={2.5} />
              </ColorSwatch>
            ) : (
              <Tooltip label="Custom colour" openDelay={300}>
                <ActionIcon
                  variant={customOpen ? 'light' : 'default'}
                  size={24}
                  radius="xl"
                  aria-label="Custom colour"
                  onClick={() => setCustomOpen((o) => !o)}
                >
                  <IconColorPicker size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
          {customOpen && (
            <ColorPicker
              format="hex"
              fullWidth
              size="sm"
              value={customColor}
              onChange={setCustomColor}
              onChangeEnd={(c) => set({ color: c })}
            />
          )}

          <SectionHeader
            label="Icon"
            resetLabel={defaultImage ? 'Use website icon' : 'Default'}
            onReset={note.icon ? () => set({ icon: null }) : undefined}
          />
          <TextInput
            size="xs"
            placeholder="Search icons"
            aria-label="Search icons"
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <ScrollArea.Autosize mah={216} type="auto" offsetScrollbars>
            <SimpleGrid cols={8} spacing={4} verticalSpacing={4}>
              {!q && (
                <ActionIcon
                  variant={note.icon === null ? 'light' : 'subtle'}
                  color={note.icon === null ? undefined : 'gray'}
                  size={30}
                  aria-label={defaultLabel}
                  title={defaultLabel}
                  aria-pressed={note.icon === null}
                  onClick={() => set({ icon: null })}
                >
                  {defaultImage ? (
                    <img src={defaultImage} alt="" width={18} height={18} style={{ objectFit: 'contain' }} />
                  ) : (
                    <DefaultGlyph size={18} stroke={1.7} />
                  )}
                </ActionIcon>
              )}
              {icons.map(({ key, Icon }) => (
                <ActionIcon
                  key={key}
                  variant={note.icon === key ? 'light' : 'subtle'}
                  color={note.icon === key ? undefined : 'gray'}
                  size={30}
                  aria-label={key}
                  title={key.replace(/-/g, ' ')}
                  aria-pressed={note.icon === key}
                  onClick={() => set({ icon: key })}
                >
                  <Icon size={18} stroke={1.7} />
                </ActionIcon>
              ))}
            </SimpleGrid>
            {icons.length === 0 && (
              <Text size="xs" c="dimmed" ta="center" py="sm">
                No icons match "{query.trim()}"
              </Text>
            )}
          </ScrollArea.Autosize>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function SectionHeader({ label, resetLabel, onReset }: { label: string; resetLabel: string; onReset?: () => void }) {
  return (
    <Group justify="space-between" gap="xs" mih={22}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
        {label}
      </Text>
      {onReset && (
        <Button variant="subtle" size="compact-xs" color="gray" onClick={onReset}>
          {resetLabel}
        </Button>
      )}
    </Group>
  );
}
