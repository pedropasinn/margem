import { readFileSync } from 'node:fs';
import type { CanonicoV1 } from '../src/tipos';
import { hashEstrutural, sha256 } from '../src/serializacao';

/** Somente fixture: divide por linhas em branco, preservando Unicode sem NFC. */
export function canonicoDaFixture(): CanonicoV1 {
  const fonte = readFileSync(new URL('../../fixtures/unicode-dificil.md', import.meta.url), 'utf8');
  const blocos: CanonicoV1['blocos'] = fonte.replace(/\r\n?/g, '\n').trimEnd().split(/\n\n+/).map((texto, ordem) => ({
    id: String(100 + ordem).padStart(26, '0'), ordem, tipo: 'paragrafo', texto, inline: [],
    origens: [{ tipo: 'texto', linha_inicio: 1, linha_fim: fonte.split('\n').length }],
  }));
  return {
    versao: 1, documento: { titulo: 'Fixture Unicode', idioma: 'pt-BR', formato: 'md', sha256_original: sha256(fonte) },
    canonizacao: { motor: 'fixture-paragrafos-v1', gerado_em: '2026-09-20T18:00:00Z' },
    hash_estrutural: hashEstrutural(blocos), secoes: [], blocos, assets: [], limites: [],
  };
}
