import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Code,
  Collapse,
  Group,
  Image,
  Paper,
  Skeleton,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconChevronDown, IconExternalLink, IconLink, IconRefresh } from '@tabler/icons-react';
import type { NoteEditorProps } from '../editor-kit/types';
import { parseHttpUrl, type LinkContent } from './index';
import { Favicon, hostOf, linkMeta, PageFacts } from './Card';
import { cleanUrl } from './clean-url';

/** "example.com/x" → "https://example.com/x" (only for things that look like a host name). */
function withScheme(input: string): string {
  const v = input.trim();
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v) || /\s/.test(v) || !/^[^/]+\.[a-z]{2,}/i.test(v)) return v;
  return `https://${v}`;
}

export default function LinkEditor(props: NoteEditorProps<LinkContent>) {
  return props.readOnly ? <LinkView {...props} /> : <LinkEdit {...props} />;
}

/** View mode: the page to visit first, then its preview and the user's own notes. */
function LinkView({ value, meta, refreshMeta, viewMode }: NoteEditorProps<LinkContent>) {
  const m = linkMeta(meta);
  const valid = parseHttpUrl(value.url);
  return (
    <Stack gap="md" maw={900} pb="xl">
      {valid ? (
        // The address, with the same "open" button at the far right as in edit mode.
        <Group gap="xs" wrap="nowrap">
          <Anchor href={valid.toString()} target="_blank" rel="noopener noreferrer" size="sm" c="dimmed" truncate="end" style={{ flex: 1, minWidth: 0 }}>
            {value.url}
          </Anchor>
          <OpenPageButton url={valid.toString()} />
        </Group>
      ) : (
        <Text c="dimmed" fs="italic">
          No web address.
        </Text>
      )}
      {/* Fetching the page again changes no content, so it is offered in view mode too. */}
      {valid && <Preview meta={m} url={valid.toString()} onRefresh={viewMode ? refreshMeta : undefined} />}
      {value.description.trim() && (
        <Box>
          <Text size="sm" fw={500} mb={4}>
            Your notes
          </Text>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {value.description}
          </Text>
        </Box>
      )}
      {m?.jsonLd && m.jsonLd.length > 0 && <StructuredData items={m.jsonLd} />}
    </Stack>
  );
}

function LinkEdit({ value, onChange, readOnly, meta, refreshMeta }: NoteEditorProps<LinkContent>) {
  const m = linkMeta(meta);
  const valid = parseHttpUrl(value.url);
  const showInvalid = value.url.trim() !== '' && !valid;
  // Tracking parameters are removed from pasted/entered links; "Undo" keeps the original.
  const [cleaned, setCleaned] = useState<{ from: string; to: string } | null>(null);
  const [keepAsIs, setKeepAsIs] = useState<string | null>(null);
  const setUrl = (raw: string) => {
    const tidy = raw === keepAsIs ? raw : cleanUrl(withScheme(raw));
    if (tidy !== raw.trim() && tidy !== withScheme(raw)) setCleaned({ from: raw.trim(), to: tidy });
    if (tidy !== value.url) onChange({ ...value, url: tidy });
  };

  return (
    <Stack gap="md" maw={900} pb="xl">
      <Group gap="xs" align="flex-start" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          label="Web address"
          placeholder="https://example.com/article"
          leftSection={<IconLink size={16} />}
          readOnly={readOnly}
          autoFocus={!readOnly && value.url === ''}
          // Dialogs move focus to the element marked with data-autofocus.
          data-autofocus={(!readOnly && value.url === '') || undefined}
          value={value.url}
          error={showInvalid && 'Enter a full web address, like https://example.com'}
          description={
            cleaned && cleaned.to === value.url ? (
              <>
                Tracking removed from the link ·{' '}
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  onClick={() => {
                    setKeepAsIs(cleaned.from);
                    setCleaned(null);
                    onChange({ ...value, url: cleaned.from });
                  }}
                >
                  Undo
                </Anchor>
              </>
            ) : undefined
          }
          inputWrapperOrder={['label', 'input', 'description', 'error']}
          onChange={(e) => onChange({ ...value, url: e.currentTarget.value })}
          onPaste={(e) => {
            // A link pasted over the whole field is tidied right away.
            const el = e.currentTarget;
            const pasted = e.clipboardData.getData('text/plain').trim();
            if (!pasted || el.selectionStart !== 0 || el.selectionEnd !== el.value.length) return;
            e.preventDefault();
            setUrl(pasted);
          }}
          onBlur={(e) => setUrl(e.currentTarget.value)}
          inputMode="url"
          autoComplete="url"
        />
        <OpenPageButton url={valid?.toString()} mt={25} />
      </Group>

      {valid && <Preview meta={m} url={valid.toString()} onRefresh={readOnly ? undefined : refreshMeta} />}

      <Textarea
        label="Your notes"
        placeholder={readOnly ? '' : 'Why is this link interesting?'}
        autosize
        minRows={4}
        readOnly={readOnly}
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.currentTarget.value })}
      />

      {m?.jsonLd && m.jsonLd.length > 0 && <StructuredData items={m.jsonLd} />}
    </Stack>
  );
}

/** Opens the page in a new tab (disabled while there is no valid address). */
function OpenPageButton({ url, mt }: { url?: string; mt?: number }) {
  return (
    <Tooltip label="Open in new tab">
      <ActionIcon
        component="a"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        size={36}
        mt={mt}
        variant="light"
        disabled={!url}
        aria-label="Open link in new tab"
      >
        <IconExternalLink size={18} />
      </ActionIcon>
    </Tooltip>
  );
}

function Preview({ meta, url, onRefresh }: { meta: ReturnType<typeof linkMeta>; url: string; onRefresh?: () => void }) {
  // The URL was just edited and is not saved/fetched yet.
  const stale = meta && meta.url !== url && meta.status !== 'disabled';
  if (!meta || stale || meta.status === 'pending' && !meta.title) {
    return (
      <Paper withBorder radius="md" p="md">
        <Group wrap="nowrap" align="flex-start">
          <Skeleton w={120} h={80} radius="sm" />
          <Stack gap={8} style={{ flex: 1 }}>
            <Skeleton h={12} w="40%" />
            <Skeleton h={16} w="80%" />
            <Skeleton h={12} w="95%" />
            <Text size="xs" c="dimmed">
              Fetching page information…
            </Text>
          </Stack>
        </Group>
      </Paper>
    );
  }
  if (meta.status === 'disabled') {
    return (
      <Text size="sm" c="dimmed">
        Link previews are turned off on this server.
      </Text>
    );
  }
  if (meta.status === 'error') {
    return (
      <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Could not fetch page information">
        <Text size="sm">{meta.error}</Text>
        {onRefresh && (
          <Button size="xs" variant="light" color="yellow" mt="xs" leftSection={<IconRefresh size={14} />} onClick={onRefresh}>
            Try again
          </Button>
        )}
      </Alert>
    );
  }

  const shown = meta.finalUrl || meta.url;
  return (
    <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
      <Box style={{ display: 'flex', flexWrap: 'wrap' }}>
        {meta.imageUrl && (
          // Full width above the text on phones, a fixed column beside it on wider screens.
          <Box w={{ base: '100%', sm: 260 }} style={{ flex: '0 0 auto', background: 'var(--mantine-color-default-hover)' }}>
            <Image src={meta.imageUrl} alt="" h={{ base: 180, sm: '100%' }} mah={{ base: 180, sm: 200 }} fit="cover" />
          </Box>
        )}
        <Stack gap={6} p="md" style={{ flex: '1 1 280px', minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Favicon src={meta.faviconUrl} />
            <Text size="xs" c="dimmed" truncate="end" style={{ flex: 1 }}>
              {meta.siteName || hostOf(shown)}
            </Text>
            {meta.ogType && (
              <Badge size="xs" variant="light" color="gray">
                {meta.ogType}
              </Badge>
            )}
          </Group>
          {meta.title && (
            <Anchor href={shown} target="_blank" rel="noopener noreferrer" fw={600} c="var(--mantine-color-text)" lineClamp={2}>
              {meta.title}
            </Anchor>
          )}
          <PageFacts jsonLd={meta.jsonLd} />
          {meta.description && (
            <Text size="sm" c="dimmed" lineClamp={4}>
              {meta.description}
            </Text>
          )}
          <Group gap="xs" justify="space-between" wrap="nowrap" mt={2}>
            <Text size="xs" c="dimmed" truncate="end" style={{ flex: 1 }} title={shown}>
              {shown}
            </Text>
            {onRefresh && (
              <Tooltip label={meta.status === 'pending' ? 'Refreshing…' : 'Fetch page information again'}>
                <ActionIcon variant="subtle" color="gray" size="sm" onClick={onRefresh} loading={meta.status === 'pending'} aria-label="Refresh page information">
                  <IconRefresh size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Stack>
      </Box>
    </Paper>
  );
}

type Obj = Record<string, unknown>;

/** Flattens an object to "a.b.c" → primitive pairs (arrays of primitives joined), for a readable table. */
function flatten(obj: Obj, prefix = '', out: [string, string][] = [], depth = 0): [string, string][] {
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith('@') && key !== '@type') continue;
    const name = prefix ? `${prefix}.${key}` : key;
    if (val === null || val === undefined) continue;
    if (typeof val === 'object' && !Array.isArray(val)) {
      if (depth < 2) flatten(val as Obj, name, out, depth + 1);
    } else if (Array.isArray(val)) {
      const prims = val.filter((v) => typeof v !== 'object');
      if (prims.length) out.push([name, prims.slice(0, 5).join(', ')]);
      else if (val[0] && typeof val[0] === 'object' && depth < 2) flatten(val[0] as Obj, name, out, depth + 1);
    } else if (key !== '@type') {
      out.push([name, String(val)]);
    }
  }
  return out;
}

function StructuredData({ items }: { items: unknown[] }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const objects = items.filter((i): i is Obj => typeof i === 'object' && i !== null);
  const types = useMemo(() => [...new Set(objects.flatMap((o) => [o['@type']].flat().map(String)))], [objects]);

  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <Group gap="xs">
          <Text size="sm" fw={500}>
            Structured data
          </Text>
          {types.slice(0, 6).map((t) => (
            <Badge key={t} size="sm" variant="light">
              {t}
            </Badge>
          ))}
        </Group>
        <IconChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
      </Group>
      <Collapse expanded={open}>
        <Stack gap="sm" mt="sm">
          {raw ? (
            <Code block style={{ maxHeight: 400, overflow: 'auto' }}>
              {JSON.stringify(items, null, 2)}
            </Code>
          ) : (
            objects.map((o, i) => {
              const rows = flatten(o).slice(0, 20);
              return (
                <Box key={i}>
                  <Badge size="sm" variant="outline" mb={4}>
                    {[o['@type']].flat().map(String).join(', ') || 'Item'}
                  </Badge>
                  {rows.length > 0 && (
                    <Table withRowBorders={false} verticalSpacing={2} fz="xs">
                      <Table.Tbody>
                        {rows.map(([k, v]) => (
                          <Table.Tr key={k}>
                            <Table.Td c="dimmed" w="35%" style={{ verticalAlign: 'top' }}>
                              {k}
                            </Table.Td>
                            <Table.Td style={{ overflowWrap: 'anywhere' }}>{v.length > 300 ? `${v.slice(0, 300)}…` : v}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Box>
              );
            })
          )}
          <Anchor component="button" size="xs" onClick={() => setRaw((r) => !r)} w="fit-content">
            {raw ? 'Show as table' : 'Show raw JSON'}
          </Anchor>
        </Stack>
      </Collapse>
    </Paper>
  );
}
