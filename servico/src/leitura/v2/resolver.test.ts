import { describe, expect, it } from 'vitest';
import type { AncoraV1, Bloco, MarcaGeradaV2, RespostaGeradaV1 } from '@margem/contratos';
import { obterModo } from '@margem/contratos';
import { ancoraDeSelecao } from '@margem/core';
import { interpretarSaidaV2, lerSaidaDoLeitorV2, resolverMarcasGeradas, resolverResposta, SaidaInvalidaV2 } from './resolver.js';

const id = (n: number): string => `01K5J17R${String(n).padStart(18, '0')}`;
const VERSAO = id(900);
const CAMADA = id(800);
const LITERARIA = obterModo({ id: 'literaria', revisao: 1 });
const FILOSOFICA = obterModo({ id: 'filosofica', revisao: 1 });

const ESTROFE: Pick<Bloco, 'id' | 'texto'> = { id: id(1), texto: 'Mas a estrela, fitando a lua, com ciúme:\n— “Pudesse eu copiar o transparente lume,' };
const PARAGRAFO: Pick<Bloco, 'id' | 'texto'> = { id: id(2), texto: 'O ser é; o não ser não é. O ser é uno.' };

function marca(parcial: Partial<MarcaGeradaV2>): MarcaGeradaV2 {
  return { bloco_id: ESTROFE.id, citacao: 'fitando a lua', prefixo: '', sufixo: '', funcao: 'imagem', saliencia: 2, sublinhar: [], comentario: null, ...parcial };
}
const contexto = { versao_id: VERSAO, camada_id: CAMADA, modo: LITERARIA };

describe('resolverMarcasGeradas', () => {
  it('resolve citação atravessando versos e devolve MarcaV2 sem id nem criada_em', () => {
    const { marcas, diagnosticos } = resolverMarcasGeradas([marca({
      citacao: 'com ciúme:\n— “Pudesse', funcao: 'forma', saliencia: 1, sublinhar: [':\n—'],
    })], [ESTROFE], { ...contexto, job_id: id(700) });
    expect(diagnosticos).toEqual([]);
    expect(marcas).toEqual([{
      ancora: { versao_id: VERSAO, bloco_id: ESTROFE.id, citacao: 'com ciúme:\n— “Pudesse', prefixo: '', sufixo: '', inicio_utf16: 30, fim_utf16: 51 },
      funcao: 'forma', saliencia: 1, subfaixas: [{ inicio_utf16: 39, fim_utf16: 42 }], comentario: null,
      origem: 'parte', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada',
      camada_id: CAMADA, modo: { id: 'literaria', revisao: 1 }, execucao_id: CAMADA, job_id: id(700),
    }]);
    expect(marcas[0]).not.toHaveProperty('id');
    expect(marcas[0]).not.toHaveProperty('criada_em');
  });

  it('citação ambígua nunca vira a primeira ocorrência; o prefixo desfaz a ambiguidade', () => {
    const ambigua = resolverMarcasGeradas([marca({ bloco_id: PARAGRAFO.id, citacao: 'O ser é', funcao: 'tese' })], [PARAGRAFO], { ...contexto, modo: FILOSOFICA });
    expect(ambigua.marcas).toEqual([]);
    expect(ambigua.diagnosticos).toMatchObject([{ indice: 0, codigo: 'citacao_ambigua', efeito: 'descartada', mensagem: expect.stringContaining('2 ocorrências') as unknown }]);
    const unica = resolverMarcasGeradas([marca({ bloco_id: PARAGRAFO.id, citacao: 'O ser é', sufixo: ' uno', funcao: 'tese' })], [PARAGRAFO], { ...contexto, modo: FILOSOFICA });
    expect(unica.marcas.map((m) => m.ancora.inicio_utf16)).toEqual([26]);
  });

  it('sobreposição: fica a mais essencial; no empate, a primeira; `nenhuma` não disputa intervalo', () => {
    const { marcas, diagnosticos } = resolverMarcasGeradas([
      marca({ citacao: 'a estrela, fitando', funcao: 'voz', saliencia: 3 }),
      marca({ citacao: 'fitando a lua', funcao: 'imagem', saliencia: 1 }),
      marca({ citacao: 'a lua, com', funcao: 'forma', saliencia: 1 }),
      marca({ citacao: 'estrela', funcao: 'nenhuma', saliencia: 3, comentario: { tipo: 'INVESTIGAR', rotulo: '? INVESTIGAR', texto: 'Que estrela?' } }),
    ], [ESTROFE], contexto);
    expect(marcas.map((m) => m.funcao)).toEqual(['imagem', 'nenhuma']);
    expect(diagnosticos.map((d) => [d.indice, d.codigo, d.mensagem])).toEqual([
      [0, 'sobreposicao_na_camada', 'Sobrepõe a marca 1 (saliência 1), que fica.'],
      [2, 'sobreposicao_na_camada', 'Sobrepõe a marca 1 (saliência 1), que fica.'],
    ]);
  });

  it('modo, comentário, nível e bloco fora da parte viram diagnóstico', () => {
    const { marcas, diagnosticos } = resolverMarcasGeradas([
      marca({ funcao: 'tese' }),
      marca({ comentario: { tipo: 'PREREQUISITO', rotulo: 'PRÉ-REQUISITO', texto: 'Saber astronomia.' } }),
      marca({ saliencia: 3 }),
      marca({ bloco_id: PARAGRAFO.id, citacao: 'O ser é uno' }),
      { bloco_id: ESTROFE.id, citacao: 'lume' },
      'lixo',
    ], [ESTROFE], { ...contexto, nivel_de_atencao_alvo: 2 });
    expect(marcas).toEqual([]);
    expect(diagnosticos.map((d) => d.codigo)).toEqual([
      'funcao_fora_do_modo', 'comentario_fora_do_modo', 'saliencia_acima_do_alvo', 'bloco_fora_da_parte', 'marca_invalida', 'marca_invalida',
    ]);
    expect(diagnosticos[4]).toMatchObject({ bloco_id: ESTROFE.id, citacao: 'lume' });
  });

  it('sublinhado não encontrado é aviso e a marca fica; o aviso some se a marca cair por sobreposição', () => {
    const { marcas, diagnosticos } = resolverMarcasGeradas([
      marca({ citacao: 'fitando a lua', sublinhar: ['lua', 'sol'], saliencia: 1 }),
      marca({ citacao: 'a lua, com ciúme', funcao: 'voz', sublinhar: ['inveja'], saliencia: 2 }),
    ], [ESTROFE], contexto);
    expect(marcas).toHaveLength(1);
    expect(marcas[0]?.subfaixas).toEqual([{ inicio_utf16: 25, fim_utf16: 28 }]);
    expect(diagnosticos.map((d) => [d.indice, d.codigo, d.efeito])).toEqual([
      [0, 'sublinhar_nao_resolvido', 'mantida'],
      [1, 'sobreposicao_na_camada', 'descartada'],
    ]);
  });
});

describe('lerSaidaDoLeitorV2 e interpretarSaidaV2', () => {
  const envelope = { marcas: [], resumo_da_parte: 'Resumo.', limites: [], leitura_integral: true };

  it('o envelope é conferido; marca ruim não derruba a parte', () => {
    expect(() => lerSaidaDoLeitorV2({ ...envelope, extra: 1 })).toThrow(SaidaInvalidaV2);
    expect(() => lerSaidaDoLeitorV2({ ...envelope, leitura_integral: 'sim' })).toThrow(SaidaInvalidaV2);
    const parte = interpretarSaidaV2({ ...envelope, marcas: [{ quebrada: true }, marca({})] }, [ESTROFE], contexto);
    expect(parte.marcas).toHaveLength(1);
    expect(parte.diagnosticos.map((d) => d.codigo)).toEqual(['marca_invalida']);
    expect(parte).toMatchObject({ resumo_da_parte: 'Resumo.', limites: [], leitura_integral: true });
  });
});

describe('resolverResposta', () => {
  const origem: AncoraV1 = ancoraDeSelecao({ ...ESTROFE, versao_id: VERSAO }, 15, 28);
  let n = 0;
  const opcoes = { origem, conversa_id: id(600), novoId: () => id(100 + ++n), agora: () => new Date('2026-09-24T03:00:00Z') };

  function resposta(parcial: Partial<RespostaGeradaV1>): RespostaGeradaV1 {
    return { texto: 'O texto não diz.', pontos: [], sugestoes_de_conexao: [], ...parcial };
  }

  it('apoios viram âncoras com contexto calculado, sem repetição; o texto não muda', () => {
    const r = resolverResposta(resposta({
      texto: 'Resposta com “aspas” e **nada** alterado.',
      pontos: [
        { tipo: 'explicacao', texto: 'A estrela olha a lua.', apoios: [{ bloco_id: ESTROFE.id, citacao: 'fitando a lua' }, { bloco_id: PARAGRAFO.id, citacao: 'o não ser não é' }] },
        { tipo: 'estrutura', texto: 'De novo.', apoios: [{ bloco_id: ESTROFE.id, citacao: 'fitando a lua' }] },
      ],
    }), [ESTROFE, PARAGRAFO], VERSAO, opcoes);
    expect(r.texto).toBe('Resposta com “aspas” e **nada** alterado.');
    expect(r.diagnosticos).toEqual([]);
    expect(r.citacoes).toHaveLength(2);
    expect(r.citacoes[0]).toMatchObject({ versao_id: VERSAO, bloco_id: ESTROFE.id, citacao: 'fitando a lua', inicio_utf16: 15, fim_utf16: 28, prefixo: 'Mas a estrela, ' });
  });

  it('apoio não resolvido sai das citações e o ponto sem apoio é diagnosticado; pergunta não precisa de apoio', () => {
    const r = resolverResposta(resposta({
      pontos: [
        { tipo: 'objecao', texto: 'Objeção.', apoios: [{ bloco_id: PARAGRAFO.id, citacao: 'O ser é' }, { bloco_id: id(99), citacao: 'x' }] },
        { tipo: 'pergunta', texto: 'E você?', apoios: [] },
      ],
    }), [ESTROFE, PARAGRAFO], VERSAO, opcoes);
    expect(r.citacoes).toEqual([]);
    expect(r.diagnosticos).toEqual([
      { caminho: '/pontos/0/apoios/0', codigo: 'citacao_ambigua', mensagem: 'A citação aparece 2 vezes no bloco.' },
      { caminho: '/pontos/0/apoios/1', codigo: 'bloco_fora_do_contexto', mensagem: `O bloco ${id(99)} não estava no contexto da resposta.` },
      { caminho: '/pontos/0', codigo: 'ponto_sem_apoio', mensagem: 'O ponto (objecao) ficou sem nenhum apoio resolvido.' },
    ]);
  });

  it('sugestões viram ConexaoV2 da IA, sugeridas, com id do serviço; repetida, para a origem e excedente saem', () => {
    const sugestao = (citacao: string, relacao: RespostaGeradaV1['sugestoes_de_conexao'][number]['relacao'], bloco = PARAGRAFO.id) =>
      ({ destino_bloco_id: bloco, citacao, relacao, justificativa: 'Porque sim, no texto.' });
    const r = resolverResposta(resposta({
      sugestoes_de_conexao: [
        sugestao('O ser é uno', 'contraste'),
        sugestao('O ser é uno', 'contraste'),
        sugestao('fitando a lua', 'semelhanca', ESTROFE.id),
        sugestao('o não ser não é', 'tensao'),
      ],
    }), [ESTROFE, PARAGRAFO], VERSAO, opcoes);
    expect(r.sugestoes).toHaveLength(1);
    expect(r.sugestoes[0]).toMatchObject({
      versao: 2, autor: 'ia', estado: 'sugerida', relacao: 'contraste', conversa_id: id(600), origem, criada_em: '2026-09-24T03:00:00.000Z',
      destino: { tipo: 'trecho', ancora: { bloco_id: PARAGRAFO.id, citacao: 'O ser é uno' } },
    });
    expect(r.sugestoes[0]?.id).toMatch(/^01K5J17R/u);
    expect(r.diagnosticos.map((d) => [d.caminho, d.codigo])).toEqual([
      ['/sugestoes_de_conexao/1', 'conexao_repetida'],
      ['/sugestoes_de_conexao/2', 'conexao_para_a_origem'],
      ['/sugestoes_de_conexao/3', 'sugestoes_excedentes'],
    ]);
  });

  it('recusa origem de outra versão', () => {
    expect(() => resolverResposta(resposta({}), [ESTROFE], id(901), opcoes)).toThrow(/mesma versão/u);
  });
});
