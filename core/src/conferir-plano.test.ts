import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { validarPlanoPedagogico, validarModeloDoCapitulo, type PlanoPedagogicoV1, type ModeloDoCapituloV1 } from '@margem/contratos';
import { conferirPlanoNoModelo } from './conferir-plano';
const caso = <T>(p: string): T => JSON.parse(readFileSync(new URL(`../../contratos/casos/${p}.json`, import.meta.url), 'utf8')) as T;
const plano = caso<PlanoPedagogicoV1>('PlanoPedagogico/valido-minimo');
const modelo = caso<ModeloDoCapituloV1>('ModeloDoCapitulo/valido-sintese');
modelo.id = plano.modelo_id;
const blocos = plano.passos.map(p => ({ id: p.bloco_inicio }));

test('plano e modelo localmente válidos ainda precisam de compatibilidade contextual', () => {
  expect(validarPlanoPedagogico(plano)).toBe(true);
  expect(validarModeloDoCapitulo(modelo)).toBe(true);
  expect(conferirPlanoNoModelo(plano, modelo, blocos).ok).toBe(true);
  expect(conferirPlanoNoModelo(plano, { ...modelo, id: '00000000000000000000000999' }, blocos)).toMatchObject({ ok: false, erros: [{ codigo: 'modelo_divergente', caminho: ['modelo_id'] }] });
  expect(conferirPlanoNoModelo(plano, null, blocos).ok).toBe(false);
});

test.each(['execucao_id', 'secao_id'] as const)('recusa %s divergente', campo => {
  expect(conferirPlanoNoModelo({ ...plano, [campo]: '00000000000000000000000999' }, modelo, blocos)).toMatchObject({ ok: false, erros: [{ caminho: [campo] }] });
});

test.each(['foco', 'relacoes', 'faixa', 'apoio'] as const)('diagnostica referência externa: %s', campo => {
  const p = structuredClone(plano), outro = '00000000000000000000000999';
  if (campo === 'foco') p.passos[0]!.foco = [outro];
  if (campo === 'relacoes') p.passos[0]!.relacoes = [outro];
  if (campo === 'faixa') p.passos[0]!.bloco_fim = outro;
  if (campo === 'apoio') p.apoios[0]!.alvo_id = outro;
  expect(validarPlanoPedagogico(p)).toBe(true);
  expect(conferirPlanoNoModelo(p, modelo, blocos).ok).toBe(false);
});
