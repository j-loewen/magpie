import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

/** Marks document changes that came from outside (props), so they are not reported as edits. */
const External = Annotation.define<boolean>();

/** The smallest single replacement turning `from` into `to`, so the cursor and scroll position survive. */
function diff(from: string, to: string) {
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let endFrom = from.length;
  let endTo = to.length;
  while (endFrom > start && endTo > start && from.charCodeAt(endFrom - 1) === to.charCodeAt(endTo - 1)) {
    endFrom--;
    endTo--;
  }
  return { from: start, to: endFrom, insert: to.slice(start, endTo) };
}

export interface CodeMirrorProps {
  value: string;
  onChange?: (value: string) => void;
  /** Language support, e.g. markdown() or a loaded LanguageSupport. */
  language?: Extension | null;
  readOnly?: boolean;
  dark: boolean;
  lineWrapping?: boolean;
  /** Show the line number / fold gutter (default true). */
  gutters?: boolean;
  /** Extra static extensions, applied once on mount. */
  extensions?: Extension[];
  autoFocus?: boolean;
  className?: string;
}

// Colours come from Mantine CSS variables so the editor follows the app theme.
const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'transparent', color: 'var(--mantine-color-text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mantine-font-family-monospace)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--mantine-color-text)', paddingBlock: '12px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--mantine-color-text)' },
  '.cm-gutters': {
    backgroundColor: 'var(--mantine-color-body)',
    color: 'var(--mantine-color-dimmed)',
    borderRight: '1px solid var(--mantine-color-default-border)',
  },
  '.cm-activeLine': { backgroundColor: 'light-dark(rgba(0,0,0,0.035), rgba(255,255,255,0.04))' },
  '.cm-activeLineGutter': { backgroundColor: 'light-dark(rgba(0,0,0,0.05), rgba(255,255,255,0.06))' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'light-dark(rgba(76,110,245,0.22), rgba(116,143,252,0.3))' },
  '.cm-panels': { backgroundColor: 'var(--mantine-color-body)', color: 'var(--mantine-color-text)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--mantine-color-body)',
    border: '1px solid var(--mantine-color-default-border)',
  },
});

const schemeExtension = (dark: boolean): Extension =>
  dark ? [EditorView.theme({}, { dark: true }), syntaxHighlighting(oneDarkHighlightStyle)] : EditorView.theme({}, { dark: false });

const readOnlyExtension = (readOnly: boolean): Extension => [
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
];

/** Small controlled wrapper around CodeMirror 6. */
export function CodeMirror({
  value,
  onChange,
  language,
  readOnly = false,
  dark,
  lineWrapping = false,
  gutters = true,
  extensions,
  autoFocus,
  className,
}: CodeMirrorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const compartments = useRef({
    language: new Compartment(),
    scheme: new Compartment(),
    readOnly: new Compartment(),
    wrap: new Compartment(),
  }).current;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          baseTheme,
          gutters ? [] : EditorView.theme({ '.cm-gutters': { display: 'none' } }),
          compartments.language.of(language ?? []),
          compartments.scheme.of(schemeExtension(dark)),
          compartments.readOnly.of(readOnlyExtension(readOnly)),
          compartments.wrap.of(lineWrapping ? EditorView.lineWrapping : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) onChangeRef.current?.(u.state.doc.toString());
          }),
          ...(extensions ?? []),
        ],
      }),
    });
    view.current = v;
    if (autoFocus) v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
    // Created once; later prop changes are applied through compartments below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the value when it changed from outside (live refresh, conflict resolution).
  useEffect(() => {
    const v = view.current;
    const current = v?.state.doc.toString();
    if (v && current !== undefined && value !== current) {
      v.dispatch({ changes: diff(current, value), annotations: External.of(true) });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.language.reconfigure(language ?? []) });
  }, [language, compartments]);
  useEffect(() => {
    view.current?.dispatch({ effects: compartments.scheme.reconfigure(schemeExtension(dark)) });
  }, [dark, compartments]);
  useEffect(() => {
    view.current?.dispatch({ effects: compartments.readOnly.reconfigure(readOnlyExtension(readOnly)) });
  }, [readOnly, compartments]);
  useEffect(() => {
    view.current?.dispatch({ effects: compartments.wrap.reconfigure(lineWrapping ? EditorView.lineWrapping : []) });
  }, [lineWrapping, compartments]);

  return <div ref={host} className={className} style={{ height: '100%', minHeight: 0 }} />;
}
