import '@mantine/tiptap/styles.css';
import { useEffect, useRef } from 'react';
import { Text } from '@mantine/core';
import { Link, RichTextEditor } from '@mantine/tiptap';
import { useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import type { NoteEditorProps } from '../editor-kit/types';
import type { TextContent } from './index';
import { docToText } from './rich';
import classes from './Text.module.css';

export default function TextEditor({ value, onChange, readOnly }: NoteEditorProps<TextContent>) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The last document this editor reported, to tell its own edits from changes made elsewhere.
  const reported = useRef<unknown>(value.doc);

  const editor = useEditor({
    extensions: [
      // Mantine's Link adds the Ctrl+K shortcut for its link control.
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    content: value.doc as JSONContent,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const doc = editor.getJSON();
      reported.current = doc;
      onChangeRef.current({ doc: doc as TextContent['doc'] });
    },
  });

  useEffect(() => {
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  // Apply the content when it changed elsewhere (live refresh, conflict resolution).
  useEffect(() => {
    if (!editor || value.doc === reported.current) return;
    reported.current = value.doc;
    if (JSON.stringify(value.doc) !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(value.doc as JSONContent, { emitUpdate: false });
    }
  }, [editor, value.doc]);

  if (readOnly && !docToText(value.doc).trim()) {
    return (
      <Text c="dimmed" fs="italic">
        This note is empty.
      </Text>
    );
  }

  return (
    <RichTextEditor
      editor={editor}
      variant="subtle"
      classNames={{ root: classes.root, toolbar: classes.toolbar, content: classes.content }}
      data-readonly={readOnly || undefined}
    >
      {!readOnly && (
        <RichTextEditor.Toolbar>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Bold />
            <RichTextEditor.Italic />
            <RichTextEditor.Underline />
            <RichTextEditor.Strikethrough />
            <RichTextEditor.Code />
            <RichTextEditor.ClearFormatting />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.H1 />
            <RichTextEditor.H2 />
            <RichTextEditor.H3 />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.BulletList />
            <RichTextEditor.OrderedList />
            <RichTextEditor.Blockquote />
            <RichTextEditor.CodeBlock />
            <RichTextEditor.Hr />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Link />
            <RichTextEditor.Unlink />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Undo />
            <RichTextEditor.Redo />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
      )}
      <RichTextEditor.Content />
    </RichTextEditor>
  );
}
