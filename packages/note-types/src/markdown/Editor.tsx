import { useDeferredValue, useMemo } from 'react';
import { Box, Group, SegmentedControl, Text, Typography } from '@mantine/core';
import { useLocalStorage, useMediaQuery } from '@mantine/hooks';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { CodeMirror } from '../editor-kit/CodeMirror';
import { renderMarkdown } from '../editor-kit/markdown-render';
import type { NoteEditorProps } from '../editor-kit/types';
import type { MarkdownContent } from './index';

type Mode = 'edit' | 'split' | 'preview';

const pane = { flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' } as const;

export default function MarkdownEditor({ value, onChange, readOnly, colorScheme }: NoteEditorProps<MarkdownContent>) {
  const [stored, setStored] = useLocalStorage<Mode>({ key: 'notes.markdown.mode', defaultValue: 'split' });
  const wide = useMediaQuery('(min-width: 62em)', true);
  // Read-only notes only make sense as a preview; split needs a wide screen.
  const mode: Mode = readOnly ? 'preview' : stored === 'split' && !wide ? 'edit' : stored;

  // Code fences get highlighting for any language; grammars load on demand.
  const language = useMemo(() => markdown({ base: markdownLanguage, codeLanguages: languages }), []);
  const deferred = useDeferredValue(value.markdown);
  const html = useMemo(() => (mode === 'edit' ? '' : renderMarkdown(deferred)), [deferred, mode]);

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {!readOnly && (
        <Group justify="flex-end" mb="xs">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => setStored(v as Mode)}
            data={[
              { label: 'Edit', value: 'edit' },
              ...(wide ? [{ label: 'Split', value: 'split' }] : []),
              { label: 'Preview', value: 'preview' },
            ]}
          />
        </Group>
      )}
      <Box style={{ display: 'flex', gap: 'var(--mantine-spacing-md)', flex: 1, minHeight: 0 }}>
        {mode !== 'preview' && (
          <Box style={{ ...pane, overflow: 'hidden' }}>
            <CodeMirror
              value={value.markdown}
              onChange={(markdown) => onChange({ markdown })}
              language={language}
              dark={colorScheme === 'dark'}
              lineWrapping
              gutters={false}
            />
          </Box>
        )}
        {mode !== 'edit' && (
          <Box
            style={{
              ...pane,
              ...(mode === 'split' && { borderLeft: '1px solid var(--mantine-color-default-border)', paddingLeft: 'var(--mantine-spacing-md)' }),
            }}
          >
            {deferred.trim() ? (
              <Typography>
                <div dangerouslySetInnerHTML={{ __html: html }} />
              </Typography>
            ) : (
              <Text c="dimmed" fs="italic">
                Nothing to preview yet.
              </Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
