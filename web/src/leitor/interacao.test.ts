import { describe, expect, test } from 'vitest';
import {
  INTERACAO_VAZIA, marcaAtiva, reduzirInteracao,
  type AcaoDaInteracao, type EstadoDaInteracao,
} from './interacao';
import { FILTRO_PADRAO, comMudanca, marcasFiltradas, notasDoCapitulo, origensPresentes } from './notas';
import { capituloExemplo } from './fixtures/capitulo-exemplo';

const A = '0'.repeat(23) + 'M01';
const B = '0'.repeat(23) + 'M02';

function reduzir(inicial: EstadoDaInteracao, acoes: AcaoDaInteracao[]): EstadoDaInteracao {
  return acoes.reduce(reduzirInteracao, inicial);
}

describe('estado único de trecho e nota', () => {
  test('a prioridade é fixada, depois focada, depois pairada', () => {
    expect(marcaAtiva(INTERACAO_VAZIA)).toBeNull();
    expect(marcaAtiva({ pairada: A, focada: null, fixada: null })).toBe(A);
    expect(marcaAtiva({ pairada: A, focada: B, fixada: null })).toBe(B);
    expect(marcaAtiva({ pairada: A, focada: B, fixada: A })).toBe(A);
  });

  test('sair de outro trecho não apaga o corrente', () => {
    const estado = reduzir(INTERACAO_VAZIA, [{ tipo: 'entrar', id: A }, { tipo: 'sair', id: B }]);
    expect(estado.pairada).toBe(A);
  });

  test('clicar alterna a fixação e Escape zera tudo', () => {
    const fixado = reduzir(INTERACAO_VAZIA, [{ tipo: 'fixar', id: A }]);
    expect(fixado.fixada).toBe(A);
    expect(reduzir(fixado, [{ tipo: 'fixar', id: A }]).fixada).toBeNull();
    expect(reduzir(fixado, [{ tipo: 'fixar', id: B }]).fixada).toBe(B);
    expect(reduzir({ pairada: A, focada: B, fixada: A }, [{ tipo: 'fechar' }])).toEqual(INTERACAO_VAZIA);
  });

  test('foco e desfoco só mexem no próprio campo', () => {
    const comFoco = reduzir(INTERACAO_VAZIA, [{ tipo: 'entrar', id: A }, { tipo: 'focar', id: B }]);
    expect(comFoco).toEqual({ pairada: A, focada: B, fixada: null });
    expect(reduzir(comFoco, [{ tipo: 'desfocar', id: A }]).focada).toBe(B);
    expect(reduzir(comFoco, [{ tipo: 'desfocar', id: B }]).focada).toBeNull();
  });
});

describe('recorte das marcas e notas do capítulo', () => {
  const { marcas, blocos } = capituloExemplo;

  test('o recorte padrão traz só marcas visíveis e resolvidas', () => {
    const recortadas = marcasFiltradas(marcas, FILTRO_PADRAO);
    expect(recortadas.every((marca) => marca.visivel && marca.validade === 'resolvida')).toBe(true);
    expect(recortadas).toHaveLength(marcas.length - 2);
  });

  test('confirmadas e ocultas são recortes diferentes', () => {
    expect(marcasFiltradas(marcas, { recorte: 'confirmadas', origem: 'todas' })).toHaveLength(0);
    const confirmada = comMudanca(marcas, marcas[0]?.id ?? '', { avaliacao: 'confirmada' });
    expect(marcasFiltradas(confirmada, { recorte: 'confirmadas', origem: 'todas' })).toHaveLength(1);
    const ocultas = marcasFiltradas(marcas, { recorte: 'ocultas', origem: 'todas' });
    expect(ocultas.every((marca) => !marca.visivel)).toBe(true);
    expect(ocultas).toHaveLength(1);
  });

  test('o filtro por origem só oferece as origens presentes', () => {
    expect(origensPresentes(marcas)).toEqual(['parte']);
    expect(marcasFiltradas(marcas, { recorte: 'todas', origem: 'manual' })).toHaveLength(0);
  });

  test('as notas são numeradas na ordem do capítulo e só existem com comentário', () => {
    const notas = notasDoCapitulo(blocos, marcasFiltradas(marcas, FILTRO_PADRAO));
    expect(notas.map((nota) => nota.numero)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const posicao = (id: string): number => blocos.findIndex((bloco) => bloco.id === id);
    for (const [indice, nota] of notas.entries()) {
      const anterior = notas[indice - 1];
      if (anterior === undefined) continue;
      const passo = posicao(nota.marca.ancora.bloco_id) - posicao(anterior.marca.ancora.bloco_id);
      expect(passo > 0 || nota.marca.ancora.inicio_utf16 > anterior.marca.ancora.inicio_utf16).toBe(true);
    }
    expect(notas.every((nota) => nota.marca.comentario !== null)).toBe(true);
  });

  test('a mudança otimista não toca nas outras marcas', () => {
    const alvo = marcas[1];
    expect(alvo).toBeDefined();
    if (alvo === undefined) return;
    const depois = comMudanca(marcas, alvo.id, { visivel: false });
    expect(depois.find((marca) => marca.id === alvo.id)?.visivel).toBe(false);
    expect(depois.filter((marca) => marca.id !== alvo.id)).toEqual(marcas.filter((marca) => marca.id !== alvo.id));
  });
});
