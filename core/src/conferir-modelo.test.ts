import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { contratoModeloDoCapitulo, contratoLoteDoModelo, hashEstrutural, validarCanonico,
  type CanonicoV1, type ExecucaoCompreensaoV1, type ModeloDoCapituloV1, type LoteDoModeloV1, type ResultadoContrato } from '@margem/contratos';
import { conferirEvolucaoDoModelo, conferirModeloNoCanonico, resolverReferenciasDoModelo } from './conferir-modelo';
import { aplicarOperacoes } from './compreensao';

const caso = <T>(p: string): T => JSON.parse(readFileSync(new URL(`../../contratos/casos/${p}.json`, import.meta.url), 'utf8')) as T;
const id = (n: number) => String(n).padStart(26, '0');
function valor<T>(r: ResultadoContrato<T>): T { if (!r.ok) throw new Error(JSON.stringify(r.erros)); return r.valor; }
function contexto(inicial = false) {
  const modelo = caso<ModeloDoCapituloV1>(`ModeloDoCapitulo/${inicial ? 'valido-minimo' : 'valido-sintese'}`);
  const execucao = caso<ExecucaoCompreensaoV1>('ExecucaoCompreensao/valido-minimo');
  const canonico = caso<CanonicoV1>('Canonico/valido-minimo');
  const textos = new Map(modelo.elementos.flatMap(e => e.ancoras.map(a => [a.bloco_id, a.citacao + a.sufixo] as const)));
  // Estas fixtures de contratos não são um acervo; compomos um canônico literal para os gates.
  for (const item of [...modelo.elementos, ...modelo.dificuldades]) for (const a of item.ancoras) a.fim_utf16 = a.citacao.length;
  canonico.blocos = [...textos].map(([id, texto], ordem) => ({ id, texto, ordem, tipo: 'paragrafo', inline: [], origens: [{ tipo: 'texto', linha_inicio: ordem + 1, linha_fim: ordem + 1 }] }));
  canonico.blocos[0]!.tipo = 'capitulo';
  canonico.secoes = [{ id: modelo.secao_id, nivel: 1, titulo: canonico.blocos[0]!.texto, bloco_inicio: id(1), bloco_fim: id(2), ordem: 0 }];
  canonico.hash_estrutural = hashEstrutural(canonico.blocos);
  expect(validarCanonico(canonico), JSON.stringify(validarCanonico.errors)).toBe(true);
  return { modelo, execucao, canonico };
}
function conferir(c: ReturnType<typeof contexto>) {
  return conferirModeloNoCanonico(valor(resolverReferenciasDoModelo(valor(contratoModeloDoCapitulo.validarLocal(c.modelo)), c.execucao, c.canonico)));
}

test.each(['execucao', 'versao', 'modo'] as const)('recusa identidade divergente: %s', campo => {
  const c = contexto();
  if (campo === 'execucao') c.execucao.id = id(999);
  if (campo === 'versao') c.execucao.versao_id = id(999);
  if (campo === 'modo') c.execucao.modo.revisao++;
  expect(resolverReferenciasDoModelo(valor(contratoModeloDoCapitulo.validarLocal(c.modelo)), c.execucao, c.canonico))
    .toMatchObject({ ok: false, erros: [{ codigo: 'execucao_divergente' }] });
});

test.each(['ausente', 'faixa', 'bloco'] as const)('recusa capítulo incompatível: %s', campo => {
  const c = contexto();
  if (campo === 'ausente') c.canonico.secoes = [];
  if (campo === 'faixa') c.canonico.secoes[0]!.bloco_inicio = id(999);
  if (campo === 'bloco') c.modelo.elementos[0]!.ancoras[0]!.bloco_id = id(999);
  const r = resolverReferenciasDoModelo(valor(contratoModeloDoCapitulo.validarLocal(c.modelo)), c.execucao, c.canonico);
  expect(r).toMatchObject({ ok: false, erros: [{ codigo: { ausente: 'secao_ausente', faixa: 'secao_invalida', bloco: 'bloco_fora_do_capitulo' }[campo] }] });
});

test.each(['incompleta', 'desordenada', 'citacao'] as const)('local válido não basta: %s', campo => {
  const c = contexto();
  if (campo === 'incompleta') c.modelo.unidades[0]!.bloco_fim = id(1);
  if (campo === 'desordenada') c.modelo.unidades[0]!.bloco_inicio = id(2);
  if (campo === 'citacao') c.canonico.blocos[0]!.texto = 'x'.repeat(c.canonico.blocos[0]!.texto.length);
  expect(conferir(c)).toMatchObject({ ok: false, erros: [{ codigo: { incompleta: 'unidades_incompletas', desordenada: 'unidades_nao_particionam', citacao: 'citacao_divergente' }[campo] }] });
});

test('revisão inicial permite ausência de unidades, mas não base ou lote', () => {
  const c = contexto(true), conferido = valor(conferir(c));
  expect(conferirEvolucaoDoModelo(conferido, null, null).ok).toBe(true);
  expect(conferirEvolucaoDoModelo(conferido, c.modelo, null)).toMatchObject({ ok: false, erros: [{ codigo: 'base_inesperada' }] });
});

test.each(['ok', 'tempo', 'evidencia', 'operacao', 'resultado', 'base'] as const)('evolução contextual: %s', campo => {
  const c = contexto(), base = structuredClone(c.modelo);
  const lote = caso<LoteDoModeloV1>('LoteDoModelo/valido-minimo');
  for (const op of lote.operacoes) for (const a of op.evidencia) a.fim_utf16 = a.citacao.length;
  c.modelo = aplicarOperacoes(base, lote.operacoes, { id: lote.resultado_id, estagio: lote.estagio, lote_id: lote.id, criada_em: lote.criado_em });
  if (campo === 'tempo') c.modelo.criada_em = '2026-09-24T12:00:00Z';
  if (campo === 'evidencia') lote.operacoes[0]!.evidencia[0]!.versao_id = id(999);
  if (campo === 'operacao') {
    const op = lote.operacoes[0]!;
    if (op.op === 'promover') op.alvo_id = id(999);
  }
  if (campo === 'resultado') c.modelo.elementos[0]!.enunciado += ' sem operação';
  if (campo === 'base') c.modelo.base_id = id(999);
  const antes = JSON.stringify([base, lote, c.modelo]);
  const r = conferirEvolucaoDoModelo(valor(conferir(c)), base, valor(contratoLoteDoModelo.validarLocal(lote)));
  if (campo === 'ok') expect(r.ok).toBe(true);
  else expect(r).toMatchObject({ ok: false, erros: [{ codigo: { tempo: 'revisao_anterior', evidencia: 'evidencia_divergente', operacao: 'operacao_inaplicavel', resultado: 'resultado_divergente', base: 'base_lote_divergentes' }[campo] }] });
  expect(JSON.stringify([base, lote, c.modelo])).toBe(antes);
});
