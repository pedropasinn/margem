import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { validarAncora, validarLoteDoModelo, validarResolucao } from './index';
import type { LoteDoModeloV1, ModeloDoCapituloV1, OperacaoDoModeloV1, ResolucaoV1 } from './tipos';
const caso = <T>(nome: string): T => JSON.parse(readFileSync(new URL(`../casos/${nome}.json`, import.meta.url), 'utf8')) as T;

test('sessão recusa a mesma âncora que o validador isolado recusa', () => {
  const sessao = caso<ResolucaoV1>('Resolucao/valido-trecho');
  if (sessao.origem.tipo !== 'trecho') throw new Error('Fixture precisa de trecho.');
  sessao.origem.ancora.fim_utf16 = 1;
  expect(validarAncora(sessao.origem.ancora)).toBe(false);
  expect(validarResolucao(sessao)).toBe(false);
});

for (const op of ['adicionar_elemento', 'remover_elemento', 'adicionar_dificuldade', 'remover_dificuldade', 'fundir'] as const) {
  test(`lote recusa âncora inconsistente em ${op}`, () => {
    const modelo = caso<ModeloDoCapituloV1>('ModeloDoCapitulo/valido-minimo');
    const elemento = modelo.elementos[0]!;
    const dificuldade = modelo.dificuldades[0]!;
    const lote = caso<LoteDoModeloV1>('LoteDoModelo/valido-minimo');
    const comum = { ordem: 0, motivo: 'Regressão da composição.', evidencia: [] };
    const operacoes: Record<typeof op, OperacaoDoModeloV1> = {
      adicionar_elemento: { ...comum, op: 'adicionar_elemento', alvo_id: elemento.id, antes: null, depois: elemento },
      remover_elemento: { ...comum, op: 'remover_elemento', alvo_id: elemento.id, antes: elemento, depois: null },
      adicionar_dificuldade: { ...comum, op: 'adicionar_dificuldade', alvo_id: dificuldade.id, antes: null, depois: dificuldade },
      remover_dificuldade: { ...comum, op: 'remover_dificuldade', alvo_id: dificuldade.id, antes: dificuldade, depois: null },
      fundir: { ...comum, op: 'fundir', alvo_id: modelo.elementos[1]!.id, antes: { absorvidos: [elemento] }, depois: { ancoras: elemento.ancoras } },
    };
    lote.operacoes = [operacoes[op]];
    expect(validarLoteDoModelo(lote)).toBe(true);
    for (const item of [elemento, dificuldade]) item.ancoras[0]!.fim_utf16++;
    expect(validarLoteDoModelo(lote)).toBe(false);
  });
}
test('qualificador de elemento no lote precisa existir na citação', () => {
  const elemento = caso<ModeloDoCapituloV1>('ModeloDoCapitulo/valido-minimo').elementos[0]!;
  const lote = caso<LoteDoModeloV1>('LoteDoModelo/valido-minimo');
  elemento.qualificadores = ['qualificador inexistente'];
  lote.operacoes = [{ ordem: 0, op: 'adicionar_elemento', alvo_id: elemento.id, antes: null, depois: elemento, motivo: 'Regressão', evidencia: [] }];
  expect(validarLoteDoModelo(lote)).toBe(false);
});

test('composição exporta exatamente os schemas publicados', async () => {
  const { contratoAncora, contratoMarcaV2, contratoModeloDoCapitulo, contratoLoteDoModelo, contratoResolucao } = await import('./index');
  for (const [nome, contrato] of Object.entries({ AncoraV1: contratoAncora, MarcaV2: contratoMarcaV2,
    ModeloDoCapituloV1: contratoModeloDoCapitulo, LoteDoModeloV1: contratoLoteDoModelo, ResolucaoV1: contratoResolucao })) {
    expect(contrato.schema).toEqual(JSON.parse(readFileSync(new URL(`../schemas/${nome}.schema.json`, import.meta.url), 'utf8')));
  }
});

test('diagnóstico aponta para a âncora interna e Local tem propriedade dos dados', async () => {
  const { contratoResolucao } = await import('./index');
  const sessao = caso<ResolucaoV1>('Resolucao/valido-trecho');
  const valido = contratoResolucao.validarLocal(sessao);
  expect(valido.ok).toBe(true);
  if (sessao.origem.tipo !== 'trecho' || !valido.ok || valido.valor.origem.tipo !== 'trecho') throw new Error('Fixture inválida.');
  sessao.origem.ancora.fim_utf16++;
  expect(valido.valor.origem.ancora.fim_utf16).not.toBe(sessao.origem.ancora.fim_utf16);
  expect(Object.isFrozen(valido.valor.origem.ancora)).toBe(true);
  const invalido = contratoResolucao.validarLocal(sessao);
  expect(invalido).toMatchObject({ ok: false, erros: [{ caminho: ['origem', 'ancora', 'fim_utf16'], codigo: 'intervalo_citacao' }] });
});

test('composição preserva a regra UTF-16 em combinações determinísticas de Unicode', async () => {
  const { contratoAncora, contratoResolucao } = await import('./index');
  const unidades = ['a', '🧭', 'e\u0301', 'é', '\n', '\r\n', 'ﬁ', '\u2028'];
  for (let i = 0; i < 128; i++) {
    const sessao = caso<ResolucaoV1>('Resolucao/valido-trecho');
    if (sessao.origem.tipo !== 'trecho') throw new Error('Fixture inválida.');
    const a = sessao.origem.ancora;
    a.citacao = unidades[i % unidades.length]! + unidades[Math.floor(i / unidades.length) % unidades.length]!;
    a.fim_utf16 = a.inicio_utf16 + a.citacao.length;
    expect(contratoAncora.validarLocal(a).ok).toBe(true);
    expect(contratoResolucao.validarLocal(sessao).ok).toBe(true);
    a.fim_utf16++;
    expect(contratoAncora.validarLocal(a).ok).toBe(false);
    expect(contratoResolucao.validarLocal(sessao).ok).toBe(false);
  }
});
