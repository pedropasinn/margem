import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { validarCanonico, validarMarcaGerada, validarMarcasLegado } from '@margem/contratos';
import type { Bloco, MarcasLegadoV1 } from '@margem/contratos';
import { deMarcasLegado } from './legado';
import { blocoPdf, canonicoDe } from '../testes/apoio';

function legado(marcas: MarcasLegadoV1['marcas']): MarcasLegadoV1 {
  return { capitulo: '1 — Teste', leitura_integral: true, limites: [], marcas, recuperacao: [] };
}

function marcaLegada(parcial: Partial<MarcasLegadoV1['marcas'][number]> = {}): MarcasLegadoV1['marcas'][number] {
  return { id: 'm01', pagina_pdf: 13, funcao: 'tese', citacao: 'a hipótese central', sublinhar: [], comentario: null, ...parcial };
}

describe('deMarcasLegado', () => {
  const canonico = canonicoDe([
    blocoPdf('Antes de tudo, a hipótese central precisa ser dita.', 13, 1),
    blocoPdf('Mais adiante, a hipótese central reaparece de outro modo.', 14, 2),
  ]);

  test('o canônico de apoio é válido pelos contratos', () => {
    expect(validarCanonico(canonico)).toBe(true);
  });

  test('citação repetida em dois blocos é desempatada pela página do PDF', () => {
    const { marcas, nao_resolvidas } = deMarcasLegado(canonico, legado([marcaLegada({ pagina_pdf: 14 })]));
    expect(nao_resolvidas).toEqual([]);
    expect(marcas).toHaveLength(1);
    expect(marcas[0]?.bloco_id).toBe(canonico.blocos[1]?.id);
    expect(validarMarcaGerada(marcas[0])).toBe(true);
  });

  test('sem página coincidente a marca fica ambígua, nunca no primeiro bloco', () => {
    const { marcas, nao_resolvidas } = deMarcasLegado(canonico, legado([marcaLegada({ pagina_pdf: 99 })]));
    expect(marcas).toEqual([]);
    expect(nao_resolvidas).toEqual([{ id: 'm01', motivo: 'ambigua' }]);
  });

  test('o mapa de páginas traduz a paginação legada', () => {
    const { marcas } = deMarcasLegado(canonico, legado([marcaLegada({ pagina_pdf: 1 })]), new Map([[1, 13]]));
    expect(marcas[0]?.bloco_id).toBe(canonico.blocos[0]?.id);
  });

  test('citação ausente e citação vazia são registradas com motivo', () => {
    const { marcas, nao_resolvidas } = deMarcasLegado(canonico, legado([
      marcaLegada({ id: 'm01', citacao: 'não existe no texto' }),
      marcaLegada({ id: 'm02', citacao: '' }),
    ]));
    expect(marcas).toEqual([]);
    expect(nao_resolvidas).toEqual([{ id: 'm01', motivo: 'ausente' }, { id: 'm02', motivo: 'vazia' }]);
  });

  test('citação única gera marca com prefixo e sufixo do bloco', () => {
    const unico = canonicoDe([blocoPdf('Um parágrafo com a definição exata aqui.', 13, 1)]);
    const { marcas } = deMarcasLegado(unico, legado([marcaLegada({ citacao: 'a definição exata', sublinhar: ['exata'] })]));
    expect(marcas[0]).toMatchObject({ citacao: 'a definição exata', sublinhar: ['exata'], funcao: 'tese' });
    expect(marcas[0]?.prefixo).toBe('Um parágrafo com ');
    expect(validarMarcaGerada(marcas[0])).toBe(true);
  });

  test('marca que não passa no validador dos contratos é recusada', () => {
    // O canônico não passaria pelos contratos (surrogate isolado); aqui ele só alimenta o mapeamento.
    const solto = { ...canonicoDe([blocoPdf('Nada.', 13, 1)]), blocos: [blocoPdf('Um trecho com \uD800 solto no meio.', 13, 1)] };
    const { marcas, nao_resolvidas } = deMarcasLegado(solto, legado([marcaLegada({ citacao: 'com \uD800 solto' })]));
    expect(marcas).toEqual([]);
    expect(nao_resolvidas).toEqual([{ id: 'm01', motivo: 'invalida' }]);
  });

  test('termo a sublinhar ambíguo é descartado e a conversão vira parcial', () => {
    const unico = canonicoDe([blocoPdf('A regra vale e a regra cai.', 13, 1)]);
    const { marcas, nao_resolvidas } = deMarcasLegado(unico, legado([
      marcaLegada({ citacao: 'A regra vale e a regra cai.', sublinhar: ['regra', 'cai'] }),
    ]));
    expect(marcas[0]?.sublinhar).toEqual(['cai']);
    expect(nao_resolvidas).toEqual([{ id: 'm01', motivo: 'sublinhar_parcial' }]);
  });
});

/**
 * Material do Horarium listado em fixtures/manifest.json: lido de fora do repo, em tempo de
 * teste. O arquivo legado real traz a chave `revisao`, que MarcasLegadoV1 recusa; ela é
 * removida aqui, como o adaptador do J06 terá de fazer.
 */
const manifesto = JSON.parse(readFileSync(new URL('../../fixtures/manifest.json', import.meta.url), 'utf8')) as {
  materiais: { caminho: string; papel: string }[];
};
const caminhoDe = (final: string): string | undefined => manifesto.materiais.find((m) => m.caminho.endsWith(final))?.caminho;
const capitulo = caminhoDe('capitulos/01-introduction.json');
const revisadas = caminhoDe('marcas-revisadas/01-introduction.json');
const presente = !!capitulo && !!revisadas && existsSync(capitulo) && existsSync(revisadas);

describe.skipIf(!presente)('deMarcasLegado sobre o corpus do Horarium', () => {
  test('converte a maioria das marcas de 01-introduction e explica cada perda', () => {
    if (!capitulo || !revisadas) return;
    const extracao = JSON.parse(readFileSync(capitulo, 'utf8')) as {
      paginas: { pdf: number; blocos: { tipo: string; texto: string }[] }[];
    };
    const blocos: Bloco[] = [];
    for (const pagina of extracao.paginas) {
      for (const item of pagina.blocos) {
        blocos.push({
          ...blocoPdf(item.texto, pagina.pdf, blocos.length + 1),
          tipo: item.tipo === 'rodape' ? 'nota_rodape' : 'paragrafo',
        });
      }
    }
    const canonico = canonicoDe(blocos);
    expect(validarCanonico(canonico)).toBe(true);

    const bruto = JSON.parse(readFileSync(revisadas, 'utf8')) as Record<string, unknown> & { marcas: Record<string, unknown>[] };
    const marcasLegado: unknown = {
      capitulo: bruto.capitulo,
      leitura_integral: bruto.leitura_integral,
      limites: bruto.limites,
      recuperacao: bruto.recuperacao,
      marcas: bruto.marcas.map(({ id, pagina_pdf, funcao, citacao, sublinhar, comentario }) =>
        ({ id, pagina_pdf, funcao, citacao, sublinhar, comentario })),
    };
    expect(validarMarcasLegado(marcasLegado)).toBe(true);
    if (!validarMarcasLegado(marcasLegado)) return;

    const { marcas, nao_resolvidas } = deMarcasLegado(canonico, marcasLegado);
    expect(marcasLegado.marcas.length).toBe(20);
    expect(marcas).toHaveLength(20);
    expect(nao_resolvidas).toEqual([]);
    expect(marcas.every((marca) => validarMarcaGerada(marca))).toBe(true);
    expect(marcas.every((marca) => canonico.blocos.some((bloco) => bloco.id === marca.bloco_id))).toBe(true);
  });
});
