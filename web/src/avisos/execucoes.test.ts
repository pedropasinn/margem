import { describe, expect, test } from 'vitest';
import type { ExecucaoDoCodexV1, ExecucoesDoCodexV1 } from '@margem/contratos';
import {
  AUTO_DISPENSA_MS, ESTADO_INICIAL, anuncioDaMudanca, formatarDuracao, organizarPilha, pareceLista, reduzirAvisos, tempoDoAviso,
  type EstadoDosAvisos,
} from './execucoes';
import { listaDeExemplo } from './exemplos';

const T0 = Date.parse('2026-10-01T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
function execucao(n: number, estado: ExecucaoDoCodexV1['estado'], extra: Partial<ExecucaoDoCodexV1> = {}): ExecucaoDoCodexV1 {
  const terminou = estado === 'concluida' || estado === 'falhou';
  return { id: `01K0000000000000000000J${String(n).padStart(3, '0')}`, tipo: 'ler_parte', rotulo: `Tarefa ${String(n)}`, estado,
    inicio: iso(T0 - 60_000), fim: terminou ? iso(T0) : null, documento: null, secao: null, rota: terminou ? '/ler/x' : null,
    mensagem: estado === 'falhou' ? 'O Codex parou antes de terminar.' : null, ...extra };
}
const lista = (execucoes: ExecucaoDoCodexV1[], gerado = T0, omitidas = 0): ExecucoesDoCodexV1 => ({ versao: 1, gerado_em: iso(gerado), execucoes, omitidas });
const receber = (estado: EstadoDosAvisos, l: ExecucoesDoCodexV1, recebidaEm = Date.parse(l.gerado_em)) => reduzirAvisos(estado, { tipo: 'lista', lista: l, recebidaEm });
const visiveis = (estado: EstadoDosAvisos) => organizarPilha(estado).visiveis.map((a) => [a.execucao.rotulo, a.execucao.estado]);

describe('reduzir as listas do serviço em avisos', () => {
  test('ativa aparece, conclui e sai sozinha depois de alguns segundos', () => {
    let estado = receber(ESTADO_INICIAL, lista([execucao(1, 'rodando')]));
    expect(visiveis(estado)).toEqual([['Tarefa 1', 'rodando']]);
    estado = receber(estado, lista([execucao(1, 'concluida')], T0 + 2000));
    expect(visiveis(estado)).toEqual([['Tarefa 1', 'concluida']]);
    estado = reduzirAvisos(estado, { tipo: 'expirar', agora: T0 + 2000 + AUTO_DISPENSA_MS - 1 });
    expect(visiveis(estado)).toHaveLength(1);
    estado = reduzirAvisos(estado, { tipo: 'expirar', agora: T0 + 2000 + AUTO_DISPENSA_MS });
    expect(visiveis(estado)).toEqual([]);
    // Dispensado não volta enquanto o serviço ainda o listar.
    estado = receber(estado, lista([execucao(1, 'concluida')], T0 + 12_000));
    expect(visiveis(estado)).toEqual([]);
  });

  test('falha fica até ser dispensada, mesmo fora da lista do serviço', () => {
    let estado = receber(ESTADO_INICIAL, lista([execucao(2, 'rodando')]));
    estado = receber(estado, lista([execucao(2, 'falhou')], T0 + 1000));
    estado = reduzirAvisos(estado, { tipo: 'expirar', agora: T0 + 60_000 });
    estado = receber(estado, lista([], T0 + 400_000));
    expect(visiveis(estado)).toEqual([['Tarefa 2', 'falhou']]);
    estado = reduzirAvisos(estado, { tipo: 'dispensar', id: execucao(2, 'falhou').id });
    expect(visiveis(estado)).toEqual([]);
  });

  test('conclusão antiga nunca vista não aparece; recente e falha, sim', () => {
    const antiga = execucao(3, 'concluida', { fim: iso(T0 - 120_000), inicio: iso(T0 - 180_000) });
    const recente = execucao(4, 'concluida', { fim: iso(T0 - 5_000) });
    const falha = execucao(5, 'falhou', { fim: iso(T0 - 200_000), inicio: iso(T0 - 250_000) });
    const estado = receber(ESTADO_INICIAL, lista([antiga, recente, falha]));
    expect(visiveis(estado).map(([rotulo]) => rotulo)).toEqual(['Tarefa 5', 'Tarefa 4']);
  });

  test('ativa que some (cancelada) perde o aviso', () => {
    let estado = receber(ESTADO_INICIAL, lista([execucao(6, 'na_fila'), execucao(7, 'rodando')]));
    estado = receber(estado, lista([execucao(7, 'rodando')], T0 + 1000));
    expect(visiveis(estado)).toEqual([['Tarefa 7', 'rodando']]);
  });

  test('o relógio do serviço corrige o tempo decorrido', () => {
    // O navegador está 10 s atrasado em relação ao serviço.
    const estado = receber(ESTADO_INICIAL, lista([execucao(8, 'rodando', { inicio: iso(T0 - 30_000) })]), T0 - 10_000);
    expect(estado.desvioMs).toBe(10_000);
    expect(tempoDoAviso(estado.avisos[execucao(8, 'rodando').id]!.execucao, T0 - 10_000 + 5_000, estado.desvioMs)).toBe('35 s');
  });
});

describe('agrupar e ordenar a pilha', () => {
  test('três visíveis por importância; o resto e as omitidas no agrupador', () => {
    const estado = receber(ESTADO_INICIAL, listaDeExemplo(T0));
    const pilha = organizarPilha(estado);
    expect(pilha.visiveis.map((a) => a.execucao.estado)).toEqual(['falhou', 'concluida', 'rodando']);
    // Das rodando, a mais antiga primeiro.
    expect(pilha.visiveis[2]!.execucao.rotulo).toBe('Lendo o capítulo 3 de Mixtape');
    expect(pilha.agrupados.map((a) => a.execucao.estado)).toEqual(['rodando', 'na_fila']);
    expect(pilha.mais).toBe(2 + 4);
    expect(organizarPilha(estado, 2).mais).toBe(3 + 4);
  });

  test('a fila segue a ordem do serviço', () => {
    const estado = receber(ESTADO_INICIAL, lista([execucao(9, 'na_fila'), execucao(10, 'na_fila'), execucao(11, 'na_fila')]));
    expect(organizarPilha(estado).visiveis.map((a) => a.execucao.rotulo)).toEqual(['Tarefa 9', 'Tarefa 10', 'Tarefa 11']);
  });
});

describe('tempos e anúncios', () => {
  test('formata durações curtas, médias e longas', () => {
    expect(formatarDuracao(-5)).toBe('0 s');
    expect(formatarDuracao(8_400)).toBe('8 s');
    expect(formatarDuracao(185_000)).toBe('3 min 05 s');
    expect(formatarDuracao(3_840_000)).toBe('1 h 04 min');
    expect(tempoDoAviso(execucao(1, 'na_fila'), T0, 0)).toBe('Na fila');
    expect(tempoDoAviso(execucao(1, 'concluida'), T0, 0)).toBe('Pronto em 1 min 00 s');
  });

  test('anuncia conclusão e falha, não os segundos', () => {
    const a = receber(ESTADO_INICIAL, lista([execucao(1, 'rodando')]));
    expect(anuncioDaMudanca(ESTADO_INICIAL, a)).toBe('O Codex começou: Tarefa 1.');
    expect(anuncioDaMudanca(a, reduzirAvisos(a, { tipo: 'expirar', agora: T0 + 1000 }))).toBeNull();
    const b = receber(a, lista([execucao(1, 'concluida')], T0 + 1000));
    expect(anuncioDaMudanca(a, b)).toBe('Pronto: Tarefa 1.');
    const c = receber(a, lista([execucao(1, 'falhou')], T0 + 1000));
    expect(anuncioDaMudanca(a, c)).toBe('Falhou: Tarefa 1. O Codex parou antes de terminar.');
  });

  test('confere a forma do que vem da rede', () => {
    expect(pareceLista(listaDeExemplo(T0))).toBe(true);
    expect(pareceLista({ versao: 2, execucoes: [] })).toBe(false);
    expect(pareceLista({ ...listaDeExemplo(T0), execucoes: [{ id: 'x', rotulo: 'y', estado: 'cancelado' }] })).toBe(false);
  });
});
