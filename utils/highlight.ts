/**
 * Syntax highlighting of fenced code in chat markdown (#19 AK-8). No dependency: the tree has
 * no highlighter, and chats need colour for the common languages only. One regex tokenizer per
 * language family (comments, strings, numbers, keywords); unknown languages stay plain.
 */

export type TokenKind =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'literal'
  | 'type'
  | 'tag'
  | 'attr'
  | 'added'
  | 'removed'
  | 'meta';

export interface Token {
  text: string;
  kind: TokenKind | null;
}

/** Longer code is shown plain: the regexes are linear, but rendering 10k spans is not free */
export const MAX_HIGHLIGHT_CHARS = 100_000;

interface Rule {
  kind: TokenKind | 'word';
  re: RegExp;
}

interface Grammar {
  rules: Rule[];
  keywords: Set<string>;
  literals: Set<string>;
  /** Keywords match in any case (SQL) */
  anyCase?: boolean;
  /** Capitalised identifiers are types (C-like languages) */
  types?: boolean;
}

const set = (words: string) => new Set(words.split(/\s+/).filter(Boolean));

const NUMBER: Rule = {
  kind: 'number',
  re: /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)\b/,
};
const WORD: Rule = { kind: 'word', re: /[A-Za-z_$][\w$]*/ };
const DQ: Rule = { kind: 'string', re: /"(?:\\[\s\S]|[^"\\\n])*"?/ };
const SQ: Rule = { kind: 'string', re: /'(?:\\[\s\S]|[^'\\\n])*'?/ };
const BT: Rule = { kind: 'string', re: /`(?:\\[\s\S]|[^`\\])*`?/ };
const LINE_SLASH: Rule = { kind: 'comment', re: /\/\/[^\n]*/ };
const BLOCK: Rule = { kind: 'comment', re: /\/\*[\s\S]*?(?:\*\/|$)/ };
const HASH: Rule = { kind: 'comment', re: /#[^\n]*/ };
const DASHES: Rule = { kind: 'comment', re: /--[^\n]*/ };

const C_LITERALS = set('true false null undefined nil None NaN Infinity this self super');

const GRAMMARS: Record<string, Grammar> = {
  c: {
    rules: [LINE_SLASH, BLOCK, BT, DQ, SQ, NUMBER, WORD],
    keywords: set(`
      abstract as async await break case catch class const continue debugger declare default
      defer delete do else enum export extends final finally fn for from func function go goto
      if impl implements import in instanceof interface internal is let loop match mod module
      move mut namespace new override package private protected pub public readonly return
      satisfies select static struct switch throw throws trait try type typeof unsafe use using
      val var virtual void when where while with yield char int long short float double bool
      boolean string byte unsigned signed sizeof template typename auto extern inline register
      volatile`),
    literals: C_LITERALS,
    types: true,
  },
  python: {
    rules: [
      HASH,
      { kind: 'string', re: /(?:[rRbBuUfF]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/ },
      DQ,
      SQ,
      { kind: 'meta', re: /@[\w.]+/ },
      NUMBER,
      WORD,
    ],
    keywords: set(`
      and as assert async await break class continue def del elif else except finally for
      from global if import in is lambda match case nonlocal not or pass raise return try while
      with yield print`),
    literals: set('True False None self cls'),
    types: true,
  },
  shell: {
    rules: [
      { kind: 'comment', re: /(?:^|(?<=\s))#[^\n]*/ },
      DQ,
      SQ,
      { kind: 'meta', re: /\$(?:\{[^}\n]*\}|\w+|[@*#?$!-])/ },
      NUMBER,
      { kind: 'word', re: /[A-Za-z_][\w-]*/ },
    ],
    keywords: set(`
      if then else elif fi for while until do done case esac in function return local export
      readonly declare unset shift exit break continue select time source alias cd echo set`),
    literals: set('true false'),
  },
  json: {
    rules: [
      { kind: 'attr', re: /"(?:\\[\s\S]|[^"\\\n])*"(?=\s*:)/ },
      DQ,
      LINE_SLASH,
      BLOCK,
      { kind: 'number', re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
      WORD,
    ],
    keywords: set(''),
    literals: set('true false null'),
  },
  yaml: {
    rules: [
      { kind: 'comment', re: /(?:^|(?<=\s))#[^\n]*/ },
      { kind: 'attr', re: /^[ \t-]*[\w.-]+(?=\s*:(?:\s|$))/m },
      { kind: 'meta', re: /^\s*\[[^\]\n]+\]/m },
      DQ,
      SQ,
      NUMBER,
      WORD,
    ],
    keywords: set(''),
    literals: set('true false null yes no on off True False Null ~'),
  },
  sql: {
    rules: [DASHES, BLOCK, SQ, DQ, NUMBER, WORD],
    keywords: set(`
      select from where and or not insert into values update set delete create table alter drop
      index view join left right inner outer full on as group by order having limit offset union
      all distinct case when then else end is in like between exists primary key foreign
      references default constraint unique with returning begin commit rollback transaction
      asc desc count sum avg min max`),
    literals: set('null true false'),
    anyCase: true,
  },
  css: {
    rules: [
      BLOCK,
      LINE_SLASH,
      DQ,
      SQ,
      { kind: 'meta', re: /@[\w-]+/ },
      { kind: 'attr', re: /[\w-]+(?=\s*:[^:])/ },
      { kind: 'number', re: /-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b/ },
      { kind: 'type', re: /#[\da-fA-F]{3,8}\b/ },
      { kind: 'word', re: /[A-Za-z_-][\w-]*/ },
    ],
    keywords: set('important inherit initial unset auto none'),
    literals: set(''),
  },
  markup: {
    rules: [
      { kind: 'comment', re: /<!--[\s\S]*?(?:-->|$)/ },
      { kind: 'tag', re: /<\/?[A-Za-z][\w:.-]*|\/?>/ },
      { kind: 'attr', re: /[A-Za-z_:][\w:.-]*(?==)/ },
      DQ,
      SQ,
    ],
    keywords: set(''),
    literals: set(''),
  },
  lua: {
    rules: [DASHES, DQ, SQ, NUMBER, WORD],
    keywords: set(`
      and break do else elseif end for function goto if in local not or repeat return then until
      while`),
    literals: set('true false nil self'),
  },
  ruby: {
    rules: [HASH, DQ, SQ, { kind: 'meta', re: /:[A-Za-z_]\w*/ }, NUMBER, WORD],
    keywords: set(`
      alias and begin break case class def defined do else elsif end ensure for if in module next
      not or redo rescue retry return then undef unless until when while yield require attr_reader
      attr_accessor puts`),
    literals: set('true false nil self'),
    types: true,
  },
};

const ALIASES: Record<string, string> = {
  js: 'c', javascript: 'c', jsx: 'c', mjs: 'c', cjs: 'c', ts: 'c', typescript: 'c', tsx: 'c',
  java: 'c', kotlin: 'c', kt: 'c', swift: 'c', go: 'c', golang: 'c', rust: 'c', rs: 'c',
  c: 'c', h: 'c', cpp: 'c', 'c++': 'c', hpp: 'c', cs: 'c', csharp: 'c', scala: 'c', dart: 'c',
  php: 'c', groovy: 'c', zig: 'c',
  py: 'python', python: 'python', python3: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', console: 'shell', fish: 'shell',
  dockerfile: 'shell', docker: 'shell', makefile: 'shell', make: 'shell',
  json: 'json', jsonc: 'json', json5: 'json', jsonl: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml', env: 'yaml', properties: 'yaml',
  sql: 'sql', postgres: 'sql', postgresql: 'sql', mysql: 'sql', sqlite: 'sql', plsql: 'sql',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  html: 'markup', xml: 'markup', svg: 'markup', vue: 'markup', svelte: 'markup', xhtml: 'markup',
  lua: 'lua', rb: 'ruby', ruby: 'ruby',
};

/** Regex of a grammar: one alternative per rule, in order, so earlier rules win */
const compiled = new Map<string, RegExp>();
function regexOf(name: string, grammar: Grammar): RegExp {
  let re = compiled.get(name);
  if (!re) {
    const flags = grammar.rules.some((r) => r.re.flags.includes('m')) ? 'gm' : 'g';
    re = new RegExp(grammar.rules.map((r) => `(${r.re.source})`).join('|'), flags);
    compiled.set(name, re);
  }
  re.lastIndex = 0;
  return re;
}

function wordKind(word: string, grammar: Grammar): TokenKind | null {
  const key = grammar.anyCase ? word.toLowerCase() : word;
  if (grammar.keywords.has(key)) return 'keyword';
  if (grammar.literals.has(key)) return 'literal';
  if (grammar.types && /^[A-Z][a-z0-9]\w*$/.test(word)) return 'type';
  return null;
}

/** Unified diff: whole lines as added / removed / hunk header */
function diffTokens(code: string): Token[] {
  return code.split(/(?<=\n)/).map((line) => ({
    text: line,
    kind: /^(\+\+\+|---)\s/.test(line)
      ? 'meta'
      : line.startsWith('+')
        ? 'added'
        : line.startsWith('-')
          ? 'removed'
          : line.startsWith('@@')
            ? 'meta'
            : null,
  }));
}

/** Tokens of `code` in `language` (a fenced block's info string); plain text when unknown */
export function highlight(code: string, language?: string | null): Token[] {
  const lang = (language ?? '').toLowerCase();
  if (!code || code.length > MAX_HIGHLIGHT_CHARS) return [{ text: code, kind: null }];
  if (lang === 'diff' || lang === 'patch') return diffTokens(code);
  const name = ALIASES[lang];
  const grammar = name ? GRAMMARS[name] : undefined;
  if (!name || !grammar) return [{ text: code, kind: null }];
  const re = regexOf(name, grammar);
  const tokens: Token[] = [];
  const push = (text: string, kind: TokenKind | null) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };
  let at = 0;
  for (let match = re.exec(code); match; match = re.exec(code)) {
    if (match[0] === '') {
      re.lastIndex++;
      continue;
    }
    push(code.slice(at, match.index), null);
    const rule = grammar.rules[match.slice(1).findIndex((group) => group !== undefined)];
    push(match[0], rule.kind === 'word' ? wordKind(match[0], grammar) : rule.kind);
    at = match.index + match[0].length;
  }
  push(code.slice(at), null);
  return tokens;
}

/** Tailwind class per token kind (dark theme, the chat's palette) */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  keyword: 'text-violet-300',
  string: 'text-emerald-300',
  comment: 'text-gray-500 italic',
  number: 'text-amber-300',
  literal: 'text-orange-300',
  type: 'text-sky-300',
  tag: 'text-rose-300',
  attr: 'text-sky-300',
  added: 'text-emerald-300',
  removed: 'text-red-300',
  meta: 'text-cyan-300',
};
