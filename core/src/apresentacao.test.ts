import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { PlanoPedagogicoV1 } from '@margem/contratos';
import { validarApresentacao, validarPlanoPedagogico } from '@margem/contratos';
import { agruparEmTelas, apresentarPlano } from './apresentacao';

const plano = JSON.parse(readFileSync(new URL('../../contratos/casos/PlanoPedagogico/valido-minimo.json', import.meta.url), 'utf8')) as PlanoPedagogicoV1;
const id = (n: number): string => String(n).padStart(26, '0');
const blocos = [{ id: id(1), texto: 'a'.repeat(1000) }, { id: id(2), texto: 'b'.repeat(1000) }];

test('os três dispositivos têm os mesmos passos, em telas diferentes', () => {
  const desktop = apresentarPlano(plano, blocos, 'desktop');
  const eink = apresentarPlano(plano, blocos, 'eink', { caracteres_por_tela: 500 });
  const audio = apresentarPlano(plano, blocos, 'audio');
  for (const apresentacao of [desktop, eink, audio]) {
    expect(validarApresentacao(apresentacao), JSON.stringify(validarApresentacao.errors)).toBe(true);
    expect([...new Set(apresentacao.telas.map((tela) => tela.passo))]).toEqual([0, 1]);
  }
  expect(desktop.telas.map((tela) => tela.tipo)).toEqual(['texto', 'explicacao', 'texto', 'explicacao']);
  expect(eink.telas.filter((tela) => tela.passo === 0).map((tela) => tela.tipo)).toEqual(['texto', 'explicacao']);
  expect(eink.telas[1]?.texto).toContain('Observe:');
  expect(audio.telas[1]?.texto).toContain('O que acontece se os preços forem flexíveis?');
  expect(() => apresentarPlano({ ...plano, passos: [{ ...plano.passos[0]!, bloco_fim: id(9) }] }, blocos, 'desktop')).toThrow('fora do capítulo');
});

test('telas de e-ink quebram em fronteira de bloco, e um bloco grande fica sozinho', () => {
  expect(agruparEmTelas([{ id: 'a', texto: 'x'.repeat(300) }, { id: 'b', texto: 'x'.repeat(300) }, { id: 'c', texto: 'x'.repeat(900) }], 700))
    .toEqual([['a', 'b'], ['c']]);
  expect(agruparEmTelas([{ id: 'a', texto: 'x'.repeat(5000) }], 700)).toEqual([['a']]);
});

test.each(['🧭', '👩‍💻', 'e\u0301', '🇧🇷', '👍🏽'])('truncamento preserva grafemas e orçamento UTF-16: %s', grafema => {
  const p = structuredClone(plano);
  p.passos[0]!.explicacao.longa = 'a'.repeat(7998) + grafema + 'fim';
  const texto = apresentarPlano(p, blocos, 'desktop').telas[1]!.texto!;
  expect(texto).toBe('a'.repeat(7998) + '…');
  expect(texto.length).toBeLessThanOrEqual(8000);
});

test('plano localmente válido com 4000 emojis não gera surrogate isolado', () => {
  const p = structuredClone(plano);
  p.passos[0]!.explicacao.longa = '🧭'.repeat(4000);
  expect(validarPlanoPedagogico(p)).toBe(true);
  const texto = apresentarPlano(p, blocos, 'desktop').telas[1]!.texto!;
  expect(texto).toBe('🧭'.repeat(3999) + '…');
});
