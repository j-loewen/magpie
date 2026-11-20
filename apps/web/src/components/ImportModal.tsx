import { useEffect, useState, type DragEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  FileButton,
  Group,
  List,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconFileImport, IconUpload, IconX } from '@tabler/icons-react';
import { IMPORT_MAX_BYTES, type ImportResultDto } from '@notes/shared';
import { errorMessage } from '../api';
import { useFolderIndex, useImport } from '../data';

export interface ImportTarget {
  folderId: string | null;
  /** Files dropped onto a folder: shown ready to import. */
  files?: File[];
}

interface Outcome {
  file: File;
  result?: ImportResultDto;
  error?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export function ImportModal({ target, onClose }: { target: ImportTarget | null; onClose: () => void }) {
  const index = useFolderIndex();
  const navigate = useNavigate();
  const importFile = useImport();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState(true);
  const [running, setRunning] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!target) return;
    setFiles(target.files ?? []);
    setOutcomes(null);
    setRunning(null);
  }, [target]);

  const folderName = target?.folderId ? (index.byId.get(target.folderId)?.name ?? 'folder') : 'Home';
  const addFiles = (more: File[]) =>
    setFiles((current) => [...current, ...more.filter((f) => !current.some((c) => c.name === f.name && c.size === f.size))]);
  const tooBig = files.filter((f) => f.size > IMPORT_MAX_BYTES);

  const start = async () => {
    if (!target) return;
    const done: Outcome[] = [];
    for (const [i, file] of files.entries()) {
      setRunning(i);
      try {
        done.push({ file, result: await importFile.mutateAsync({ file, folderId: target.folderId, previews }) });
      } catch (err) {
        done.push({ file, error: errorMessage(err) });
      }
    }
    setRunning(null);
    setOutcomes(done);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles([...e.dataTransfer.files]);
  };

  const busy = running !== null;
  const opened = target !== null;
  const firstFolder = outcomes?.find((o) => o.result?.folderId)?.result?.folderId;

  return (
    <Modal opened={opened} onClose={busy ? () => {} : onClose} title={`Import into "${folderName}"`} size="lg" closeOnClickOutside={!busy}>
      {outcomes ? (
        <Stack>
          {outcomes.map((o) => (
            <Paper key={o.file.name} withBorder p="sm" radius="md">
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <ThemeIcon variant="light" color={o.error ? 'red' : o.result?.skippedCount ? 'yellow' : 'teal'} radius="xl">
                  {o.error ? <IconX size={16} /> : o.result?.skippedCount ? <IconAlertTriangle size={16} /> : <IconCheck size={16} />}
                </ThemeIcon>
                <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                  <Text fw={500} size="sm" style={{ overflowWrap: 'anywhere' }}>
                    {o.file.name}
                  </Text>
                  {o.error ? (
                    <Text size="sm" c="red">
                      {o.error}
                    </Text>
                  ) : (
                    o.result && (
                      <>
                        <Text size="sm" c="dimmed">
                          {plural(o.result.notes, 'note')}
                          {o.result.folders > 0 && `, ${plural(o.result.folders, 'folder')}`}
                          {o.result.skippedCount > 0 && ` · ${o.result.skippedCount} skipped`}
                        </Text>
                        {o.result.skipped.length > 0 && (
                          <ScrollArea.Autosize mah={140}>
                            <List size="xs" c="dimmed" spacing={2}>
                              {o.result.skipped.map((s, i) => (
                                <List.Item key={i} style={{ overflowWrap: 'anywhere' }}>
                                  {s.name}: {s.reason}
                                </List.Item>
                              ))}
                              {o.result.skippedCount > o.result.skipped.length && (
                                <List.Item>… and {o.result.skippedCount - o.result.skipped.length} more</List.Item>
                              )}
                            </List>
                          </ScrollArea.Autosize>
                        )}
                      </>
                    )
                  )}
                </Stack>
              </Group>
            </Paper>
          ))}
          {previews && outcomes.some((o) => o.result?.notes) && (
            <Text size="xs" c="dimmed">
              Page previews for imported links are fetched in the background.
            </Text>
          )}
          <Group justify="flex-end">
            {firstFolder && (
              <Button
                variant="default"
                onClick={() => {
                  onClose();
                  void navigate({ to: '/f/$folderId', params: { folderId: firstFolder } });
                }}
              >
                Open imported folder
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Paper
            withBorder
            radius="md"
            p="lg"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              borderStyle: 'dashed',
              borderWidth: 2,
              borderColor: dragOver ? 'var(--mantine-primary-color-filled)' : undefined,
              background: dragOver ? 'var(--mantine-primary-color-light)' : undefined,
            }}
          >
            <Stack align="center" gap="xs">
              <IconUpload size={32} stroke={1.5} color="var(--mantine-color-dimmed)" />
              <Text size="sm">Drop files here, or</Text>
              <FileButton multiple onChange={addFiles} disabled={busy}>
                {(props) => (
                  <Button {...props} variant="light" size="xs">
                    Choose files
                  </Button>
                )}
              </FileButton>
            </Stack>
          </Paper>

          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              You can import:
            </Text>
            <List size="xs" c="dimmed" spacing={2}>
              <List.Item>Exports from this app (.zip): folders and notes are restored exactly</List.Item>
              <List.Item>Browser bookmarks (.html) from Chrome, Firefox, Edge or Safari: become link notes</List.Item>
              <List.Item>Markdown, text and code files, or a .zip of them (e.g. from another notes app): folders are kept</List.Item>
              <List.Item>Mind maps from OPML or FreeMind (.opml, .mm), and shortcuts (.url, .webloc)</List.Item>
            </List>
          </Stack>

          {files.length > 0 && (
            <Stack gap={4}>
              {files.map((f, i) => (
                <Group key={`${f.name}-${f.size}`} gap="xs" wrap="nowrap">
                  {running === i ? <Loader size={14} /> : <IconFileImport size={16} color="var(--mantine-color-dimmed)" />}
                  <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>
                    {f.name}
                  </Text>
                  <Text size="xs" c={f.size > IMPORT_MAX_BYTES ? 'red' : 'dimmed'}>
                    {f.size < 1024 * 1024 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : megabytes(f.size)}
                  </Text>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    disabled={busy}
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles(files.filter((x) => x !== f))}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )}
          {tooBig.length > 0 && (
            <Alert color="red" icon={<IconAlertTriangle size={18} />}>
              Files larger than {megabytes(IMPORT_MAX_BYTES)} cannot be imported.
            </Alert>
          )}

          <Checkbox
            label="Fetch page previews for imported links"
            description="Turn off for large bookmark collections if you don't need images and descriptions."
            checked={previews}
            disabled={busy}
            onChange={(e) => setPreviews(e.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void start()} loading={busy} disabled={files.length === 0 || tooBig.length > 0}>
              Import {files.length > 1 ? `${files.length} files` : ''}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
