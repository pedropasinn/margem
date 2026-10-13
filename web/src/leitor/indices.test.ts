import { expect, test } from 'vitest';
import type { AncoraV1, PalavraGeometria } from '@margem/contratos';
import { agruparPor, consultarQuads, porPaginaDaAncora } from './indices';
import { quadsDaAncora } from '../../../core/src/geometria';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
import { segmentar } from './segmentos';

test('índice por bloco preserva texto e precedência, inclusive marcas sobrepostas', () => {
  const marcas = [...capituloExemplo.marcas, ...capituloExemplo.marcas.map(m => ({ ...m, id: `pessoal-${m.id}`, funcao: 'nenhuma' as const }))];
  const indice = agruparPor(marcas, m => m.ancora.bloco_id);
  for (const bloco of capituloExemplo.blocos) {
    const filtrados = segmentar(bloco, indice.get(bloco.id) ?? []);
    expect(filtrados).toEqual(segmentar(bloco, marcas));
    expect(filtrados.map(s => s.texto).join('')).toBe(bloco.texto);
  }
});
test('marca que atravessa páginas mantém quads, ordem e invalidação ao trocar geometria', () => {
  const a: AncoraV1 = { versao_id: 'V', bloco_id: 'B', inicio_utf16: 0, fim_utf16: 7, citacao: '🧭 teste', prefixo: '', sufixo: '' };
  const palavras: PalavraGeometria[] = [
    { bloco_id: 'B', inicio_utf16: 0, fim_utf16: 2, pagina: 1, quad: [0, 0, 20, 0, 20, 10, 0, 10] },
    { bloco_id: 'B', inicio_utf16: 3, fim_utf16: 7, pagina: 2, quad: [0, 0, 40, 0, 40, 10, 0, 10] },
  ];
  const consulta = consultarQuads('V', agruparPor(palavras, p => p.bloco_id));
  expect(consulta(a)).toEqual(quadsDaAncora(a, { versao_id: 'V', palavras: palavras }));
  expect(consulta(a)).toBe(consulta(a));
  const marcas = [{ id: 'a', ancora: a }, { id: 'b', ancora: { ...a, inicio_utf16: 3, citacao: 'teste' } }];
  const paginas = porPaginaDaAncora(marcas, consulta);
  expect(paginas.get(1)?.map(m => m.id)).toEqual(['a']);
  expect(paginas.get(2)?.map(m => m.id)).toEqual(['a', 'b']);
  const outra = consultarQuads('V', agruparPor(palavras.map(p => ({ ...p, pagina: 3 })), p => p.bloco_id));
  expect(outra(a).map(p => p.pagina)).toEqual([3]);
  expect(consulta(a).map(p => p.pagina)).toEqual([1, 2]);
});

test('cache de quads não reutiliza geometria de outra publicação com o mesmo bloco', () => {
  const a: AncoraV1 = { versao_id: 'V1', bloco_id: 'B', inicio_utf16: 0, fim_utf16: 2, citacao: 'AA', prefixo: '', sufixo: '' };
  const consulta = consultarQuads('V2', new Map([['B', [{ bloco_id: 'B', inicio_utf16: 0, fim_utf16: 2, pagina: 1, quad: [0, 0, 20, 0, 20, 10, 0, 10] }]]]));
  expect(() => consulta(a)).toThrow('outra versão');
  expect(consulta({ ...a, versao_id: 'V2' })).toHaveLength(1);
});
