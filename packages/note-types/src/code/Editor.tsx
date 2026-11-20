import { useEffect, useState } from 'react';
import { ActionIcon, Box, CopyButton, Group, Select, Switch, Text, Tooltip } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { CodeMirror } from '../editor-kit/CodeMirror';
import type { NoteEditorProps } from '../editor-kit/types';
import type { CodeContent } from './index';

const PLAIN = 'Plain text';
const languageOptions = [PLAIN, ...languages.map((l) => l.name).sort((a, b) => a.localeCompare(b))];

export default function CodeEditor({ value, onChange, readOnly, colorScheme }: NoteEditorProps<CodeContent>) {
  const [wrap, setWrap] = useLocalStorage({ key: 'notes.code.wrap', defaultValue: false });
  const [support, setSupport] = useState<LanguageSupport | null>(null);

  // Grammars are loaded on demand, so only the languages actually used are downloaded.
  useEffect(() => {
    const desc = value.language ? LanguageDescription.matchLanguageName(languages, value.language, true) : null;
    if (!desc) {
      setSupport(null);
      return;
    }
    let cancelled = false;
    void desc.load().then((s) => !cancelled && setSupport(s));
    return () => {
      cancelled = true;
    };
  }, [value.language]);

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Group justify="space-between" mb="xs" gap="xs">
        {readOnly ? (
          <Text size="xs" c="dimmed">
            {value.language || PLAIN}
          </Text>
        ) : (
          <Select
            size="xs"
            w={200}
            searchable
            allowDeselect={false}
            aria-label="Language"
            data={languageOptions}
            value={value.language || PLAIN}
            onChange={(v) => onChange({ ...value, language: !v || v === PLAIN ? '' : v })}
            comboboxProps={{ withinPortal: true }}
          />
        )}
        <Group gap="sm">
          <Switch size="xs" label="Wrap lines" checked={wrap} onChange={(e) => setWrap(e.currentTarget.checked)} />
          <CopyButton value={value.code}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied' : 'Copy code'}>
                <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy} aria-label="Copy code">
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
      </Group>
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 'var(--mantine-radius-md)',
          overflow: 'hidden',
        }}
      >
        <CodeMirror
          value={value.code}
          onChange={(code) => onChange({ ...value, code })}
          language={support}
          readOnly={readOnly}
          dark={colorScheme === 'dark'}
          lineWrapping={wrap}
        />
      </Box>
    </Box>
  );
}
