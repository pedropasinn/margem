import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { PlanoPedagogicoV1 } from '@margem/contratos';
import type { TelaDoEink } from '@margem/core';
import { montarEpub, paginasDoEpub, type EntradaDoEpub } from './epub.js';

const id = (n: number): string => String(n).padStart(26, '0');
const plano = {
  id: id(701),
  passos: [{ ordem: 0, bloco_inicio: id(1), bloco_fim: id(1), foco: [id(101)], observar: 'Repare no <inicialmente> & no resto.', explicacao: { curta: 'c', longa: 'l' }, relacoes: [], parada: null }],
} as unknown as PlanoPedagogicoV1;
const telas: TelaDoEink[] = [
  { tipo: 'texto', passo: 0, blocos: [{ id: id(1), tipo: 'paragrafo', texto: 'Admitamos inicialmente que os preços são rígidos.' }], grifos: { [id(1)]: [{ inicio: 0, fim: 22, numero: 1, periferico: false }] } },
  { tipo: 'explicacao', passo: 0, texto: 'A hipótese é provisória.\n\nObserve: o', itens: [{ numero: 1, enunciado: 'Hipótese <provisória>.', periferico: true }],
    ligacoes: [{ tipo: 'pressupoe', explicacao: 'Usa a rigidez.', retrospectiva: true, citacao: 'Logo, cai.', tela: 0 }], parada: { tipo: 'pergunta', texto: 'E se?' } },
];
const entrada: EntradaDoEpub = { id: id(701), titulo: 'Livro & cia', autor: 'F. A. Hayek', capitulo: 'Capítulo 1', idioma: 'pt', plano, telas, gerado_em: '2026-09-26T12:00:00.000Z' };

test('epub: uma página por tela, com grifo numerado, ligação para a tela do outro trecho e texto escapado', () => {
  const [texto, explicacao] = paginasDoEpub(entrada);
  expect(texto).toContain('<span class="grifo">Admitamos inicialmente</span><span class="numero">1</span>');
  expect(explicacao).toContain('<p class="observar">Repare no &lt;inicialmente&gt; &amp; no resto.</p>');
  expect(explicacao).toContain('Hipótese &lt;provisória&gt;.');
  expect(explicacao).toContain('<a href="tela-001.xhtml">tela 1 ›</a>');
  expect(explicacao).toContain('<strong>Pressupõe · volta adiante.</strong>');
});

test('epub: zip válido, mimetype primeiro e sem compressão, XHTML bem formado', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'margem-epub-'));
  const caminho = join(pasta, 'guiada.epub');
  writeFileSync(caminho, montarEpub(entrada));
  const saida = execFileSync('python3', ['-c', `
import sys, zipfile, xml.dom.minidom
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
nomes = z.namelist()
assert nomes[0] == 'mimetype' and z.getinfo('mimetype').compress_type == 0
assert z.read('mimetype') == b'application/epub+zip'
for nome in nomes:
    if nome.endswith(('.xhtml', '.opf', '.ncx', '.xml')): xml.dom.minidom.parseString(z.read(nome))
print(len(nomes))
`, caminho]).toString().trim();
  expect(saida).toBe('8');
});
