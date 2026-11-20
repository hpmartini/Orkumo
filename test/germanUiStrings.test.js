// The UI is English (i18n comes later): no German string literal or JSX text in app and server code.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const SCAN = [
  'App.tsx',
  'index.tsx',
  'components',
  'hooks',
  'utils',
  'services',
  'electron',
  'server',
];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-server', 'fixtures']);

// Intentional German with the reason: a whole file, or one literal as `file: text`
const ALLOW = {
  'server/services/chatHistoryService.js': 'German stop words for topic detection, data not UI',
  'server/services/projectContexts.js: Alle':
    'old stored default context name, mapped to "All" on read',
};

const GERMAN_WORDS = new Set(
  `und oder nicht nur für ist sind wird werden kein keine keinen bitte neu fehler laden geladen einstellungen
  zugang freigabe einrichten rechner starten beenden schließen öffnen löschen speichern abbrechen ändern datei
  ordner sitzung ansicht jetzt noch schon auch dann wenn über ohne beim vom zum zur eine einen einem einer wurde
  kann konnte muss gibt alle dieser diesem diese heute gestern stunden minuten tage läuft fehlgeschlagen möglich
  unbekannt festgelegt durch scannen kamera oben unten weiter zurück suchen hinzufügen entfernen erneut aktiv
  verbunden getrennt nichts etwas hier dort lädt wählen ausgewählt anzeigen verbergen kopieren kopiert gespeichert`
    .split(/\s+/)
    .filter(Boolean)
);

/** Umlaut or ß, or German function words (one for a short text, two for a longer one) */
export function looksGerman(text) {
  if (/[äöüÄÖÜß]/.test(text)) return true;
  const words = text.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  const hits = words.filter((w) => GERMAN_WORDS.has(w)).length;
  return hits >= (words.length <= 2 ? 1 : 2);
}

function uiStrings(file) {
  const src = fs.readFileSync(file, 'utf8');
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const visit = (node) => {
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (literal && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
      const text = node.text.trim().replace(/\s+/g, ' ');
      if (text && looksGerman(text)) {
        const rel = path.relative(ROOT, file);
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (!ALLOW[`${rel}: ${text}`]) found.push(`${rel}:${line}: ${text.slice(0, 120)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function sourceFiles(p) {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return /\.(tsx?|jsx?|mjs|cjs)$/.test(p) ? [p] : [];
  if (SKIP_DIRS.has(path.basename(p))) return [];
  return fs.readdirSync(p).flatMap((e) => sourceFiles(path.join(p, e)));
}

describe('UI strings', () => {
  it('looksGerman separates German from English', () => {
    expect(looksGerman('Module neu laden')).toBe(true);
    expect(looksGerman('Schließen (Esc)')).toBe(true);
    expect(looksGerman('Keine Treffer')).toBe(true);
    expect(looksGerman('Reload modules')).toBe(false);
    expect(looksGerman('No matches for this filter')).toBe(false);
  });

  it('has no German in app and server code (allowlist for intent)', () => {
    const hits = SCAN.flatMap((p) => sourceFiles(path.join(ROOT, p)))
      .filter((f) => !ALLOW[path.relative(ROOT, f)])
      .flatMap(uiStrings);
    expect(hits).toEqual([]);
  });
});
