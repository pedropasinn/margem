import { expect, test } from 'vitest';
import { idTeste } from '../../testes/apoio.js';
import { LIMITE_CONTINUIDADE, montarContinuidade, type ResumoDeParte } from './continuidade.js';

function resumo(ordem: number, texto: string): ResumoDeParte {
  return { parte_id: idTeste('P', ordem), ordem, resumo: texto };
}

test('sem corte no capítulo não há registro de continuidade', () => {
  expect(montarContinuidade({
    ordem: 0, anteriores: [resumo(0, 'nada')], continuacoes: new Set(),
  })).toBeUndefined();
});

test('parte que continua o capítulo recebe os resumos anteriores, em ordem', () => {
  const texto = montarContinuidade({
    ordem: 2,
    anteriores: [resumo(0, 'Primeira metade.'), resumo(1, 'Segunda metade.')],
    continuacoes: new Set([1, 2]),
    capituloDaParte: new Map([[0, idTeste('S', 0)], [1, idTeste('S', 0)], [2, idTeste('S', 0)]]),
  });
  expect(texto).toContain('Primeira metade.');
  expect(texto).toContain('Segunda metade.');
  expect(texto?.indexOf('Primeira metade.')).toBeLessThan(texto?.indexOf('Segunda metade.') ?? 0);
});

test('nenhuma parte recebe resumo de parte futura', () => {
  const texto = montarContinuidade({
    ordem: 1,
    anteriores: [resumo(0, 'Passado.'), resumo(1, 'Presente.'), resumo(2, 'Futuro.')],
    continuacoes: new Set([1]),
  });
  expect(texto).toContain('Passado.');
  expect(texto).not.toContain('Presente.');
  expect(texto).not.toContain('Futuro.');
});

test('em modo capítulos, resumo de outro capítulo não atravessa a fronteira', () => {
  const pedido = {
    ordem: 2,
    anteriores: [resumo(0, 'Do capítulo um.'), resumo(1, 'Do capítulo dois, parte um.')],
    continuacoes: new Set([2]),
    capituloDaParte: new Map([[0, idTeste('S', 0)], [1, idTeste('S', 1)], [2, idTeste('S', 1)]]),
  };
  const capitulos = montarContinuidade(pedido);
  expect(capitulos).not.toContain('Do capítulo um.');
  expect(capitulos).toContain('Do capítulo dois, parte um.');
  const sequencial = montarContinuidade({ ...pedido, modo: 'sequencial' });
  expect(sequencial).toContain('Do capítulo um.');
});

test('o registro é truncado no limite, sem partir par substituto', () => {
  const texto = montarContinuidade({
    ordem: 1,
    anteriores: [resumo(0, `${'a'.repeat(LIMITE_CONTINUIDADE)}🧭`)],
    continuacoes: new Set([1]),
  });
  expect(texto).toBeDefined();
  expect((texto ?? '').length).toBeLessThanOrEqual(LIMITE_CONTINUIDADE);
  expect(texto).toMatch(/\[…\]$/);
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(texto ?? '')).toBe(false);
});

test('resumo vazio não gera arquivo de continuidade', () => {
  expect(montarContinuidade({ ordem: 1, anteriores: [resumo(0, '   ')], continuacoes: new Set([1]) })).toBeUndefined();
});
