import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ActionIcon, Center, Group, Loader, Mark, Paper, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconFileText, IconSearch } from '@tabler/icons-react';
import { useFolderIndex, useSearch } from '../data';
import { NoteIcon, NoteTitleLink, noteOpenUrl } from '../components/notes-ui';
import { StatusBar, StatusText, countLabel } from '../components/StatusBar';
import { noteTitle, relativeTime } from '../lib/format';
import { useNoteDialog } from '../lib/note-dialog';

/** Server snippets mark matches with \u0001 … \u0002; render those as highlights (never as HTML). */
function Snippet({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let marked = false;
  text.split(/([\u0001\u0002])/).forEach((chunk, i) => {
    if (chunk === '\u0001') marked = true;
    else if (chunk === '\u0002') marked = false;
    else if (chunk) parts.push(marked ? <Mark key={i}>{chunk}</Mark> : chunk);
  });
  return <>{parts}</>;
}

export function SearchPage({ q }: { q: string }) {
  const navigate = useNavigate();
  const dialog = useNoteDialog();
  const index = useFolderIndex();
  const [input, setInput] = useState(q);
  const [debounced] = useDebouncedValue(input, 250);
  const results = useSearch(debounced);

  useEffect(() => setInput(q), [q]);
  // Keep the URL in sync so searches can be bookmarked and survive reloads.
  useEffect(() => {
    if (debounced !== q) void navigate({ to: '/search', search: { q: debounced }, replace: true });
  }, [debounced, q, navigate]);

  return (
    <Stack maw={860}>
      {debounced.trim() && results.data && (
        <StatusBar>
          <StatusText>{countLabel(results.data.length, 'result')}</StatusText>
        </StatusBar>
      )}
      <Title order={2}>Search</Title>
      <TextInput
        size="md"
        autoFocus
        placeholder="Search titles and content"
        leftSection={<IconSearch size={18} />}
        rightSection={results.isFetching ? <Loader size="xs" /> : null}
        value={input}
        onChange={(e) => setInput(e.currentTarget.value)}
      />
      {!debounced.trim() ? (
        <Text c="dimmed" size="sm">
          Type to search all your notes. Words are matched by prefix, so "plan" also finds "planning".
        </Text>
      ) : results.data && results.data.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">No notes match "{debounced}".</Text>
        </Center>
      ) : (
        <Stack gap="xs">
          {results.data?.map((r) => {
            const path = index.path(r.folderId).map((f) => f.name);
            return (
              <Paper key={r.id} withBorder radius="md" p="sm">
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <NoteIcon note={r} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <NoteTitleLink note={r} fw={600} size="sm">
                      {noteTitle(r.title)}
                    </NoteTitleLink>
                    <Text size="xs" c="dimmed">
                      {/* ownerName is only set for other people's notes. */}
                      {[r.ownerName ? 'Shared with me' : 'Home', ...path].join(' / ')}
                      {r.ownerName && ` · shared by ${r.ownerName}`} · edited {relativeTime(r.updatedAt)}
                    </Text>
                    {r.snippet && (
                      <Text size="sm" mt={4} ff={r.type === 'code' ? 'monospace' : undefined} style={{ overflowWrap: 'anywhere' }}>
                        <Snippet text={r.snippet} />
                      </Text>
                    )}
                  </div>
                  {/* Link notes: the name opens the web page; this opens the note. */}
                  {noteOpenUrl(r) && (
                    <Tooltip label="Open note">
                      <ActionIcon variant="subtle" color="gray" aria-label="Open note" onClick={() => dialog.open(r.id)}>
                        <IconFileText size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
