import { z } from 'zod';
import { defineNoteType } from '../define';

/**
 * File extensions and CodeMirror language names (see @codemirror/language-data), for imports and
 * downloads. Kept here rather than read from language-data so the server bundle stays small.
 */
const EXTENSIONS: Record<string, string> = {
  bash: 'Shell',
  c: 'C',
  cc: 'C++',
  cjs: 'JavaScript',
  clj: 'Clojure',
  conf: 'Properties files',
  cpp: 'C++',
  cs: 'C#',
  css: 'CSS',
  dart: 'Dart',
  diff: 'diff',
  dockerfile: 'Dockerfile',
  erl: 'Erlang',
  fs: 'F#',
  go: 'Go',
  gradle: 'Groovy',
  groovy: 'Groovy',
  h: 'C',
  hpp: 'C++',
  hs: 'Haskell',
  htm: 'HTML',
  html: 'HTML',
  ini: 'Properties files',
  java: 'Java',
  jl: 'Julia',
  js: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  kt: 'Kotlin',
  kts: 'Kotlin',
  less: 'LESS',
  lua: 'Lua',
  mjs: 'JavaScript',
  mts: 'TypeScript',
  patch: 'diff',
  php: 'PHP',
  pl: 'Perl',
  properties: 'Properties files',
  proto: 'ProtoBuf',
  ps1: 'PowerShell',
  psm1: 'PowerShell',
  py: 'Python',
  r: 'R',
  rb: 'Ruby',
  rs: 'Rust',
  sass: 'Sass',
  scala: 'Scala',
  scss: 'SCSS',
  sh: 'Shell',
  sql: 'SQL',
  svelte: 'HTML',
  swift: 'Swift',
  toml: 'TOML',
  ts: 'TypeScript',
  tsx: 'TSX',
  vb: 'VB.NET',
  vue: 'Vue',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
  zsh: 'Shell',
};

/** Preferred extension per language (the first one listed above wins, with a few overrides). */
const PREFERRED: Record<string, string> = { Shell: 'sh', 'C++': 'cpp', JavaScript: 'js', TypeScript: 'ts', YAML: 'yaml', HTML: 'html' };
const LANGUAGE_EXT = new Map<string, string>();
for (const [ext, lang] of Object.entries(EXTENSIONS)) if (!LANGUAGE_EXT.has(lang)) LANGUAGE_EXT.set(lang, PREFERRED[lang] ?? ext);

export const codeType = defineNoteType({
  id: 'code',
  label: 'Code',
  description: 'Source code with syntax highlighting',
  version: 1,
  schema: z.object({
    code: z.string().max(2_000_000),
    /** CodeMirror language name, e.g. "TypeScript"; empty = plain text. */
    language: z.string().max(64),
  }),
  createDefault: () => ({ code: '', language: '' }),
  toSearchText: (c) => c.code,
  toFile: (c) => ({ ext: LANGUAGE_EXT.get(c.language) ?? 'txt', text: c.code }),
  importExtensions: Object.keys(EXTENSIONS),
  fromFile: (text, ext) => ({ code: text, language: EXTENSIONS[ext] ?? '' }),
});

export type CodeContent = { code: string; language: string };
