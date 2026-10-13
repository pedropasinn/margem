/**
 * Apoio dos testes da compreensão (J29/J30): um livro de dois capítulos e o roteiro do executor
 * falso com as quatro chamadas do capítulo um, na ordem em que a prioridade as põe.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import type { CanonicoV1 } from '@margem/contratos';
import { canonicoDeTeste } from './apoio.js';
import { executorAuditado } from '../src/executor/auditoria.js';
import { criarExecutorFalso, type Roteiro } from '../src/executor/fake.js';
import { FilaPostgres } from '../src/worker/fila-postgres.js';
import { Worker } from '../src/worker/worker.js';
import { manipuladoresDaCompreensao } from '../src/compreensao/manipuladores.js';
import type { ConfiguracaoDaCompreensao } from '../src/compreensao/pipeline.js';

export function livro(): CanonicoV1 {
  return canonicoDeTeste({
    titulo: 'Preços e produto',
    blocos: [
      { tipo: 'capitulo', texto: 'Capítulo um' },
      { tipo: 'paragrafo', texto: 'Admitamos inicialmente que os preços são rígidos.' },
      { tipo: 'paragrafo', texto: 'Um exemplo ilustra: o cardápio impresso não muda todo dia.' },
      { tipo: 'secao', texto: 'Consequência' },
      { tipo: 'paragrafo', texto: 'Logo, somente com preços rígidos o choque reduz o produto.' },
      { tipo: 'capitulo', texto: 'Capítulo dois' },
      { tipo: 'paragrafo', texto: 'Outro capítulo, lido depois.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 4 }, { nivel: 2, inicio: 3, fim: 4 }, { nivel: 1, inicio: 5, fim: 6 }],
  });
}

const cit = (bloco: string, citacao: string) => ({ bloco, citacao, prefixo: '', sufixo: '' });

/** As quatro chamadas do capítulo um, na ordem em que a prioridade as põe. */
export const ROTEIRO: Roteiro = {
  versao: 1,
  passos: [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: {
      elementos: [
        { ref: 'n1', nucleo: 'hipotese', papel: 'conceito', citacoes: [cit('B002', 'Admitamos inicialmente que os preços são rígidos')],
          enunciado: 'O autor supõe, por ora, preços rígidos.', qualificadores: ['inicialmente', 'nunca'], centralidade: 3,
          notas: [{ tipo: 'INVESTIGAR', texto: 'A hipótese será retirada adiante?' }] },
        { ref: 'n2', nucleo: 'exemplo', papel: 'justificativa', citacoes: [cit('B003', 'o cardápio impresso não muda todo dia')],
          enunciado: 'O cardápio impresso ilustra a rigidez.', qualificadores: [], centralidade: 2, notas: [] },
        { ref: 'n3', nucleo: 'afirmacao', papel: 'tese', citacoes: [cit('B005', 'somente com preços rígidos o choque reduz o produto')],
          enunciado: 'O choque só reduz o produto se os preços forem rígidos.', qualificadores: ['somente'], centralidade: 1, notas: [] },
        { ref: 'n4', nucleo: 'afirmacao', papel: 'tese', citacoes: [cit('B005', 'uma frase que não está no texto')],
          enunciado: 'Inventada.', qualificadores: [], centralidade: 1, notas: [] },
      ],
      relacoes: [
        { origem: 'n2', destino: 'n1', tipo: 'exemplifica', explicacao: 'O cardápio exemplifica a rigidez.', confianca: 'alta' },
        { origem: 'n3', destino: 'n4', tipo: 'pressupoe', explicacao: 'Aponta para elemento descartado.', confianca: 'baixa' },
      ],
      dificuldades: [
        { tipo: 'salto_argumentativo', citacoes: [cit('B005', 'o choque reduz o produto')], descricao: 'A passagem do choque ao produto omite o mecanismo.' },
        { tipo: 'premissa_implicita', citacoes: [cit('B005', 'Logo')], descricao: 'O leitor vai se perder aqui.' },
      ],
      resumo_da_parte: 'Fixa a rigidez de preços e tira a consequência.', limites: [], leitura_integral: true,
    } },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: {
      movimento: { texto: 'O capítulo fixa uma hipótese e deriva dela a conclusão.', etapas: [{ unidades: ['U1', 'U2'], descricao: 'Hipótese e consequência.' }] },
      unidades: [
        { ref: 'U1', inicio: 'B001', titulo: 'A hipótese', funcao_no_capitulo: 'Fixa a rigidez.' },
        { ref: 'U2', inicio: 'B004', titulo: 'A consequência', funcao_no_capitulo: 'Tira a conclusão.' },
      ],
      operacoes: [
        { op: 'criar_relacao', ref: 'n1', origem: 'L03', destino: 'L01', tipo: 'pressupoe', explicacao: 'A conclusão usa a rigidez.',
          confianca: 'alta', retrospectiva: true, motivo: 'Só lendo o fim se vê que tudo depende da hipótese.', evidencia: ['L03'] },
        { op: 'rebaixar', alvo: 'L02', para: 3, motivo: 'É só ilustração no conjunto.', evidencia: [] },
        { op: 'promover', alvo: 'L99', para: 1, motivo: 'Alias inventado.', evidencia: [] },
      ],
    } },
    { quando: { ordem: 3 }, tipo: 'ok', conteudo: {
      operacoes: [
        { op: 'promover', alvo: 'L01', para: 1, motivo: 'L03 depende dela; o autor a apresenta como provisória.', evidencia: ['L03'] },
        { op: 'acrescentar_nota', alvo: 'L03', tipo: 'LEITURA', texto: 'Sem rigidez, o choque mudaria só os preços.', motivo: 'Consequência da hipótese.', evidencia: ['L01'] },
      ],
      observacoes: ['Densidade equilibrada.'],
    } },
    { quando: { ordem: 4 }, tipo: 'ok', conteudo: {
      passos: [
        { inicio: 'B001', foco: ['L01'], observar: 'Repare no “inicialmente”.',
          explicacao: { curta: 'A hipótese é provisória.', longa: 'O autor apresenta a rigidez como provisória, mas a conclusão depende dela.' },
          relacoes: ['R02'], parada: { tipo: 'pergunta', texto: 'O que muda se os preços forem flexíveis?' } },
        { inicio: 'B004', foco: ['L03', 'L77'], observar: 'A conclusão.', explicacao: { curta: 'Consequência.', longa: 'A queda do produto sai da rigidez.' },
          relacoes: [], parada: null },
      ],
      apoios: [{ alvo: 'L01', tipo: 'exemplo', texto: 'Pense num cardápio impresso.' }],
    } },
  ],
};

export async function configurar(banco: pg.Pool, temporarios: string[]): Promise<{ config: ConfiguracaoDaCompreensao; artefatos: string; auditoria: string }> {
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-compreensao-art-'));
  const auditoria = await mkdtemp(join(tmpdir(), 'margem-compreensao-aud-'));
  temporarios.push(artefatos, auditoria);
  const falso = criarExecutorFalso(ROTEIRO);
  const executor = executorAuditado((pedido) => falso({ ...pedido, diretorioArtefatos: artefatos }), { commit: () => 'teste' });
  return { config: { banco, executor, modelo: 'modelo-de-teste', esforco: 'alto', esforcoDoPlano: 'medio', prazoMs: 10_000 }, artefatos, auditoria };
}

export async function rodarUm(banco: pg.Pool, config: ConfiguracaoDaCompreensao, auditoria: string, slots: string): Promise<void> {
  const worker = new Worker({
    fila: new FilaPostgres(banco), manipuladores: manipuladoresDaCompreensao(config), auditoria,
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000,
  });
  await worker.rodar();
}

