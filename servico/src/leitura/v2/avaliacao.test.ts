/**
 * Avaliação offline do J17: saídas de modelo gravadas à mão (`avaliacao/*.json`), com os erros típicos,
 * resolvidas sem Codex. Cada fixture declara quantas marcas (ou citações e sugestões) devem ser publicadas
 * e quantos diagnósticos de cada código devem sair.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  AncoraV1, Bloco, ConexaoV2, ConversaV2, Id, MarcaV2, ModoDeLeituraV1, ReferenciaModo, RespostaGeradaV1, Saliencia,
} from '@margem/contratos';
import { obterModo, validarCamadaEditorialV2, validarConversaV2, validarRespostaGerada } from '@margem/contratos';
import { conferirTextoAncora } from '@margem/contratos/regras';
import { ancoraDeSelecao } from '@margem/core';
import { montarPromptDeLeitura, montarPromptDeResposta } from './prompt.js';
import { interpretarSaidaV2, resolverResposta } from './resolver.js';

type BlocoDaFixture = Pick<Bloco, 'id' | 'ordem' | 'tipo' | 'texto'>;
interface FixtureDeLeitura {
  descricao: string;
  tipo: 'leitura';
  modo: ReferenciaModo;
  nivel: Saliencia;
  versao_id: Id;
  camada_id: Id;
  blocos: BlocoDaFixture[];
  responsaveis: Id[];
  saida: unknown;
  esperado: { publicadas: number; indices_publicados: number[]; diagnosticos: Record<string, number> };
}
interface FixtureDeResposta {
  descricao: string;
  tipo: 'resposta';
  modo: ReferenciaModo;
  versao_id: Id;
  conversa_id: Id;
  blocos: BlocoDaFixture[];
  nucleo: Id[];
  ancora: { bloco_id: Id; citacao: string };
  pergunta: string;
  resposta: unknown;
  esperado: { citacoes: number; sugestoes: number; diagnosticos: Record<string, number> };
}
type Fixture = FixtureDeLeitura | FixtureDeResposta;

const PASTA = new URL('./avaliacao/', import.meta.url);
const fixtures: [string, Fixture][] = readdirSync(PASTA).filter((nome) => nome.endsWith('.json')).sort()
  .map((nome) => [nome, JSON.parse(readFileSync(new URL(nome, PASTA), 'utf8')) as Fixture]);

function contagem(codigos: readonly string[]): Record<string, number> {
  const resultado: Record<string, number> = {};
  for (const codigo of codigos) resultado[codigo] = (resultado[codigo] ?? 0) + 1;
  return resultado;
}

/** A porta do J16 (item 5), copiada do SPEC: a resolução mais `modelo`/`esforco` tem de caber nela sem adaptador. */
type Responder = (entrada: {
  conversa: ConversaV2; pergunta: string;
  blocos_nucleo: Bloco[];
  blocos_contexto: Bloco[];
  modo: ModoDeLeituraV1;
}) => Promise<{ texto: string; citacoes: AncoraV1[]; sugestoes: ConexaoV2[]; diagnosticos: { codigo: string; mensagem: string }[]; modelo: string; esforco: string }>;

function completo(bloco: BlocoDaFixture): Bloco { return { ...bloco, inline: [], origens: [] }; }

describe('avaliação offline das saídas gravadas', () => {
  it('há ao menos um soneto em estrofe entre as fixtures', () => {
    const soneto = fixtures.find(([, fixture]) => fixture.tipo === 'leitura' && fixture.modo.id === 'literaria');
    expect(soneto).toBeDefined();
    const estrofes = soneto?.[1].blocos.filter((bloco) => bloco.tipo === 'estrofe') ?? [];
    expect(estrofes).toHaveLength(4);
    expect(estrofes.map((bloco) => bloco.texto.split('\n').length)).toEqual([4, 4, 3, 3]);
  });

  for (const [nome, fixture] of fixtures) {
    if (fixture.tipo === 'leitura') {
      it(`${nome}: ${String(fixture.esperado.publicadas)} marcas publicadas`, () => {
        const modo = obterModo(fixture.modo);
        const responsaveis = fixture.blocos.filter((bloco) => fixture.responsaveis.includes(bloco.id));
        // O prompt dessa mesma parte se monta (a saída foi escrita contra ele).
        const montado = montarPromptDeLeitura({ modo, nivel: fixture.nivel, blocos: fixture.blocos.map(completo), responsaveis: fixture.responsaveis });
        for (const bloco of fixture.blocos) expect(montado.prompt).toContain(bloco.texto);

        const resultado = interpretarSaidaV2(fixture.saida, responsaveis, {
          versao_id: fixture.versao_id, camada_id: fixture.camada_id, modo, nivel_de_atencao_alvo: fixture.nivel,
        });
        expect(resultado.marcas).toHaveLength(fixture.esperado.publicadas);
        expect(contagem(resultado.diagnosticos.map((d) => d.codigo))).toEqual(fixture.esperado.diagnosticos);
        const descartadas = new Set(resultado.diagnosticos.filter((d) => d.efeito === 'descartada').map((d) => d.indice));
        const total = (fixture.saida as { marcas: unknown[] }).marcas.length;
        const publicados = [...Array(total).keys()].filter((indice) => !descartadas.has(indice));
        expect(publicados).toEqual(fixture.esperado.indices_publicados);

        // Toda marca publicada é literal no bloco, da camada e do modo, e a camada não tem sobreposição.
        const porId = new Map(fixture.blocos.map((bloco) => [bloco.id, bloco]));
        for (const marca of resultado.marcas) {
          const bloco = porId.get(marca.ancora.bloco_id);
          expect(bloco && conferirTextoAncora(bloco, marca.ancora)).toBe(true);
          expect(marca.camada_id).toBe(fixture.camada_id);
          expect(marca.saliencia).toBeLessThanOrEqual(fixture.nivel);
        }
        const comIds: MarcaV2[] = resultado.marcas.map((marca, i) => ({
          ...marca, id: `01K5J17M${String(i).padStart(18, '0')}`, criada_em: '2026-09-24T03:00:00Z',
        }));
        expect(validarCamadaEditorialV2(comIds)).toEqual([]);
      });
    } else {
      it(`${nome}: ${String(fixture.esperado.citacoes)} citações e ${String(fixture.esperado.sugestoes)} sugestões`, async () => {
        const modo = obterModo(fixture.modo);
        expect(validarRespostaGerada(fixture.resposta)).toBe(true);
        const resposta = fixture.resposta as RespostaGeradaV1;
        const blocos = fixture.blocos.map(completo);
        const blocoDaAncora = blocos.find((bloco) => bloco.id === fixture.ancora.bloco_id);
        if (!blocoDaAncora) throw new Error('Fixture sem o bloco da âncora.');
        const inicio = blocoDaAncora.texto.indexOf(fixture.ancora.citacao);
        const ancora = ancoraDeSelecao({ ...blocoDaAncora, versao_id: fixture.versao_id }, inicio, inicio + fixture.ancora.citacao.length);
        const blocos_nucleo = blocos.filter((bloco) => fixture.nucleo.includes(bloco.id));
        const blocos_contexto = blocos.filter((bloco) => !fixture.nucleo.includes(bloco.id));
        const conversa: ConversaV2 = {
          versao: 2, id: fixture.conversa_id, versao_id: fixture.versao_id, ancora, estado: 'aberta', criada_em: '2026-09-24T03:00:00Z',
          mensagens: [{ id: '01K5J17P000000000000000001', autor: 'leitor', texto: fixture.pergunta, criada_em: '2026-09-24T03:00:00Z' }],
        };
        let n = 0;
        // Implementação da porta do J16 com o prompt e a resolução do J17; só o executor é trocado por uma saída gravada.
        const responder: Responder = (entrada) => {
          const montado = montarPromptDeResposta({
            pergunta: entrada.pergunta, ancora: entrada.conversa.ancora, historico: entrada.conversa.mensagens,
            blocos_nucleo: entrada.blocos_nucleo, blocos_contexto: entrada.blocos_contexto, modo: entrada.modo,
          });
          expect(montado.prompt).toContain(entrada.pergunta);
          const resolvida = resolverResposta(resposta, [...entrada.blocos_nucleo, ...entrada.blocos_contexto], entrada.conversa.versao_id, {
            origem: entrada.conversa.ancora, conversa_id: entrada.conversa.id,
            novoId: () => `01K5J17X${String(++n).padStart(18, '0')}`, agora: () => new Date('2026-09-24T03:01:00Z'),
          });
          return Promise.resolve({ ...resolvida, modelo: 'saida-gravada', esforco: 'nenhum' });
        };
        const resultado = await responder({ conversa, pergunta: fixture.pergunta, blocos_nucleo, blocos_contexto, modo });

        expect(resultado.texto).toBe(resposta.texto);
        expect(resultado.citacoes).toHaveLength(fixture.esperado.citacoes);
        expect(resultado.sugestoes).toHaveLength(fixture.esperado.sugestoes);
        expect(contagem(resultado.diagnosticos.map((d) => d.codigo))).toEqual(fixture.esperado.diagnosticos);
        for (const sugestao of resultado.sugestoes) {
          expect(sugestao).toMatchObject({ autor: 'ia', estado: 'sugerida', conversa_id: fixture.conversa_id, origem: ancora });
        }
        // A mensagem da IA que o J16 publicaria com essa resolução é uma ConversaV2 válida.
        const publicada: ConversaV2 = {
          ...conversa,
          mensagens: [...conversa.mensagens, {
            id: '01K5J17P000000000000000002', autor: 'ia', texto: resultado.texto, citacoes: resultado.citacoes,
            contexto: { snapshot_hash: '0'.repeat(64), blocos: blocos.map((bloco) => bloco.id) },
            execucao: { modelo: resultado.modelo, esforco: resultado.esforco }, criada_em: '2026-09-24T03:01:00Z',
          }],
        };
        expect(validarConversaV2(publicada)).toBe(true);
      });
    }
  }
});
