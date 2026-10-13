import { describe, expect, test } from 'vitest';
import type { AncoraV1, LeituraComentadaV1, NarracaoDaLeituraV1 } from '@margem/contratos';
import {
  etapaDaLeituraNoInstante, fimDaPausa, focoDaRelacao, frasesDoTexto, montarSequenciaDaLeitura, palavraNoInstante, pausaAnterior, pausasDasFontes,
  proximaPausa, saltarFrase, textoFalado, trechosDoCapitulo, type FonteAncorada,
} from './leitura-comentada';

const V = '01K0000000000000000000V001';
const frases = (texto: string): string[] => frasesDoTexto(texto).map((f) => texto.slice(f.inicio, f.fim));

describe('frases', () => {
  test('quebra em ponto, interrogação e reticências; não em abreviação, inicial nem número', () => {
    expect(frases('No mundo moderno, tudo é software. Hoje em dia, por exemplo, empresas dependem disso! E agora? Sim…  Fim.'))
      .toEqual(['No mundo moderno, tudo é software.', 'Hoje em dia, por exemplo, empresas dependem disso!', 'E agora?', 'Sim…', 'Fim.']);
    expect(frases('Segundo F. Brooks, o Dr. Silva leu a Seção 1.2 do cap. Um. Robôs, etc. Por fim, outra.')).toEqual(['Segundo F. Brooks, o Dr. Silva leu a Seção 1.2 do cap. Um.', 'Robôs, etc.', 'Por fim, outra.']);
    expect(frases('Ele disse: “Não há bala de prata.” E seguiu.')).toEqual(['Ele disse: “Não há bala de prata.”', 'E seguiu.']);
    expect(frases('   ')).toEqual([]);
  });
  test('frase longa demais quebra em ponto e vírgula', () => {
    const longa = `${'a'.repeat(200)}; ${'b'.repeat(200)}; ${'c'.repeat(100)}.`;
    expect(frasesDoTexto(longa, 420).length).toBe(3);
  });
  test('o capítulo em trechos: código saltado, "(link)" some da fala, lista por item', () => {
    const blocos = [
      { id: 'B1', tipo: 'secao' as const, texto: '1.1 Definições' },
      { id: 'B2', tipo: 'paragrafo' as const, texto: 'O SWEBOK define a área (link). Veja o Waterfall.' },
      { id: 'B3', tipo: 'codigo' as const, texto: 'x = 1' },
      { id: 'B4', tipo: 'lista' as const, texto: 'Primeiro item\nSegundo item' },
      { id: 'B5', tipo: 'paragrafo' as const, texto: '(link)' },
    ];
    const { trechos, saltados } = trechosDoCapitulo(blocos);
    expect(trechos.map((t) => [t.id, t.bloco_id, t.texto, t.falado])).toEqual([
      ['t0001', 'B1', '1.1 Definições', '1 ponto 1 Definições'],
      ['t0002', 'B2', 'O SWEBOK define a área (link).', 'O suíbóqui define a área.'],
      ['t0003', 'B2', 'Veja o Waterfall.', 'Veja o uóter fól.'],
      ['t0004', 'B4', 'Primeiro item', 'Primeiro item'],
      ['t0005', 'B4', 'Segundo item', 'Segundo item'],
    ]);
    expect(trechos[4]!.inicio_utf16).toBe(14);
    expect(saltados).toEqual([{ bloco_id: 'B3', tipo: 'codigo' }, { bloco_id: 'B5', tipo: 'paragrafo' }]);
  });
});

describe('pronúncia', () => {
  test('siglas soletradas, glossário, plural de sigla, etc.', () => {
    expect(textoFalado('A UML e as IDEs do IEEE, etc.')).toBe('A u ême éle e as i dê és do i três é, etcétera');
    expect(textoFalado('Refactoring e frameworks na OTAN')).toBe('rifáctorin e frêimuôrks na Otan');
    expect(textoFalado('Veja https://exemplo.org (link) e a Seção 1.2 de 1.700 páginas.')).toBe('Veja e a Seção 1 ponto 2 de 1.700 páginas.');
    expect(textoFalado('Uma palavra comum.')).toBe('Uma palavra comum.');
  });
});

const ancora = (bloco: string, inicio: number, citacao: string): AncoraV1 => ({ versao_id: V, bloco_id: bloco, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao, prefixo: '', sufixo: '' });

describe('pausas', () => {
  const blocos = [
    { id: 'B1', tipo: 'paragrafo' as const, texto: 'Admitamos que os preços são rígidos. Isto é provisório.' },
    { id: 'B2', tipo: 'codigo' as const, texto: 'codigo()' },
    { id: 'B3', tipo: 'paragrafo' as const, texto: 'O choque reduz o produto. Somente com preços rígidos isso vale.' },
  ];
  const { trechos } = trechosDoCapitulo(blocos);
  const ordem = new Map(blocos.map((b, i) => [b.id, i]));
  const hipotese = ancora('B1', 0, 'Admitamos que os preços são rígidos');
  const conclusao = ancora('B3', 26, 'Somente com preços rígidos isso vale');

  test('a relação é comentada na ponta que aparece depois; a outra é a ponta', () => {
    expect(focoDaRelacao(ordem, hipotese, conclusao)).toEqual({ foco: conclusao, ponta: hipotese });
    expect(focoDaRelacao(ordem, conclusao, hipotese)).toEqual({ foco: conclusao, ponta: hipotese });
    expect(focoDaRelacao(ordem, ancora('BX', 0, 'x'), hipotese)).toEqual({ foco: hipotese, ponta: ancora('BX', 0, 'x') });
  });

  test('todo grifo e toda relação entram; a mesma frase junta grifo e relação numa pausa, na ordem do texto', () => {
    const fontes: FonteAncorada[] = [
      { tipo: 'relacao', id: 'R1', foco: conclusao, ponta: hipotese },
      { tipo: 'grifo', id: 'G2', foco: conclusao, ponta: null },
      { tipo: 'grifo', id: 'G1', foco: hipotese, ponta: null },
      { tipo: 'grifo', id: 'G3', foco: ancora('B2', 0, 'codigo'), ponta: null },
      { tipo: 'grifo', id: 'G9', foco: ancora('BX', 0, 'fora'), ponta: null },
    ];
    const { pausas, fora } = pausasDasFontes(trechos, blocos, fontes);
    expect(pausas.map((p) => [p.depois_de, p.fontes.map((f) => f.id)])).toEqual([
      ['t0001', ['G1']],
      // O grifo no código fica depois da última frase lida antes dele.
      ['t0002', ['G3']],
      ['t0004', ['G2', 'R1']],
    ]);
    expect(fora.map((f) => f.id)).toEqual(['G9']);
  });
});

describe('linha do tempo', () => {
  const leitura = {
    id: '01K0000000000000000000C001',
    trechos: [
      { id: 't0001', bloco_id: 'B1', inicio_utf16: 0, fim_utf16: 10, texto: 'Uma frase.', falado: 'Uma frase.' },
      { id: 't0002', bloco_id: 'B1', inicio_utf16: 11, fim_utf16: 21, texto: 'Outra aqui', falado: 'Outra aqui' },
      { id: 't0003', bloco_id: 'B2', inicio_utf16: 0, fim_utf16: 5, texto: 'Fim d', falado: 'Fim d' },
    ],
    pausas: [
      { id: 'p001', depois_de: 't0001', fontes: [{ tipo: 'grifo' as const, id: 'G1' }], foco: [ancora('B1', 0, 'Uma')], pontas: [], texto: 'Repare nisto.', falado: 'Repare nisto.' },
      { id: 'p002', depois_de: 't0003', fontes: [{ tipo: 'grifo' as const, id: 'G2' }], foco: [ancora('B2', 0, 'Fim')], pontas: [], texto: '', falado: '' },
    ],
  } satisfies Pick<LeituraComentadaV1, 'id' | 'trechos' | 'pausas'>;
  const narracao: NarracaoDaLeituraV1 = {
    versao: 1, id: '01K0000000000000000000N001', leitura_id: leitura.id, sha256_audio: 'a'.repeat(64), voz_sha256: 'b'.repeat(64), jobs_colab: ['job_1'],
    receita: 'r', duracao_s: 12, transicao: { silencio_antes_s: 0.6, silencio_depois_s: 0.4, sinal: true, contraste: false },
    falas: [{ fala_id: 't0001', inicio_s: 0, fim_s: 2 }, { fala_id: 'p001', inicio_s: 3, fim_s: 6 }, { fala_id: 't0002', inicio_s: 6.5, fim_s: 8 }, { fala_id: 't0003', inicio_s: 8.4, fim_s: 11.8 }],
    palavras: [{ bloco_id: 'B1', inicio_utf16: 11, fim_utf16: 16, inicio_s: 6.5, fim_s: 7 }, { bloco_id: 'B1', inicio_utf16: 17, fim_utf16: 21, inicio_s: 7.1, fim_s: 8 }],
    criado_em: '2026-09-29T00:00:00.000Z',
  };

  test('com narração: trechos e pausas com fala, na ordem; a pausa sem fala não entra', () => {
    const s = montarSequenciaDaLeitura(leitura, narracao);
    expect(s.narrada).toBe(true);
    expect(s.etapas.map((e) => e.id)).toEqual(['t0001', 'p001', 't0002', 't0003']);
    expect(etapaDaLeituraNoInstante(s, 2.5)?.id).toBe('t0001');
    expect(etapaDaLeituraNoInstante(s, 3)?.id).toBe('p001');
    expect(palavraNoInstante(s, etapaDaLeituraNoInstante(s, 7.2), 7.2)?.inicio_utf16).toBe(17);
    expect(palavraNoInstante(s, etapaDaLeituraNoInstante(s, 4), 4)).toBeNull();
    // O trecho t0001 não tem palavras alinhadas: é estimado dentro da fala dele (0–2 s).
    expect(palavraNoInstante(s, etapaDaLeituraNoInstante(s, 0.1), 0.1)?.inicio_utf16).toBe(0);
    expect(palavraNoInstante(s, etapaDaLeituraNoInstante(s, 1.9), 1.9)?.inicio_utf16).toBe(4);
    const pausa = etapaDaLeituraNoInstante(s, 4)!;
    expect(fimDaPausa(s, pausa)).toBe(6.5);
    expect(pausaAnterior(s, 9)?.id).toBe('p001');
    expect(pausaAnterior(s, 3.5)).toBeNull();
    expect(proximaPausa(s, 0.5)?.id).toBe('p001');
    expect(proximaPausa(s, 7)).toBeNull();
    expect(saltarFrase(s, 7, 1)).toBe(8.4);
    expect(saltarFrase(s, 8.2, -1)).toBe(6.5);
    expect(saltarFrase(s, 6.6, -1)).toBe(3);
  });

  test('sem narração (ou de outra leitura): tempos estimados no ritmo de leitura', () => {
    const s = montarSequenciaDaLeitura(leitura, { ...narracao, leitura_id: '01K0000000000000000000C009' });
    expect(s.narrada).toBe(false);
    expect(s.etapas).toHaveLength(4);
    expect(s.etapas[1]!.inicio_s).toBeGreaterThan(s.etapas[0]!.fim_s);
    // Sem voz, a palavra também anda: cada palavra dos trechos ganha um tempo dentro da sua frase.
    expect(s.palavras.map((p) => p.inicio_utf16)).toEqual([0, 4, 11, 17, 0, 4]);
    const t2 = s.etapas.find((e) => e.id === 't0002')!;
    expect(palavraNoInstante(s, t2, t2.inicio_s)?.inicio_utf16).toBe(11);
    expect(palavraNoInstante(s, t2, t2.fim_s - 0.01)?.inicio_utf16).toBe(17);
  });
});
