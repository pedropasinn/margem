import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { conferirOrcamento, interpretarJson, lerJsonLimitado, LimiteDeEntrada, ORCAMENTOS } from './entrada-json.js';
import { conferirResposta } from './executor/artefato.js';
const pequeno = { bytes: 128, profundidade: 4, itens: 8, nos: 20 };
test('recusa antes das regras: bytes UTF-8, profundidade, arrays, nós, ciclos e valores não JSON', () => {
  expect(() => interpretarJson(JSON.stringify('🧭'.repeat(40)), pequeno)).toThrow(LimiteDeEntrada);
  expect(() => interpretarJson('['.repeat(10000) + '0' + ']'.repeat(10000), ORCAMENTOS.resposta)).toThrow('profundidade');
  expect(() => interpretarJson(JSON.stringify(Array(9).fill(0)), pequeno)).toThrow('itens');
  expect(() => conferirOrcamento(Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => 1)), pequeno)).toThrow('nos');
  const ciclo: unknown[] = []; ciclo.push(ciclo);
  expect(() => conferirOrcamento(ciclo, pequeno)).toThrow('formato');
  expect(() => conferirOrcamento({ n: Infinity }, pequeno)).toThrow('formato');
  expect(() => conferirOrcamento({ get texto() { throw new Error('não executar getter'); } }, pequeno)).toThrow('formato');
  const valido = { texto: '{[\\"🧭', lista: [true, null, 2] };
  expect(interpretarJson(JSON.stringify(valido), pequeno)).toEqual(valido);
});
test('arquivo grande é recusado antes de carregar/validar; erro não revela conteúdo', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-limites-'));
  try {
    const caminho = join(pasta, 'resposta.json'), schema = join(pasta, 'schema.json');
    await writeFile(caminho, 'segredo'.repeat(80000)); await writeFile(schema, '{"type":"object"}');
    await expect(lerJsonLimitado(caminho, ORCAMENTOS.resposta)).rejects.toThrow('bytes');
    const resultado = await conferirResposta(caminho, schema);
    expect(resultado).toMatchObject({ estado: 'json_invalido' });
    expect(JSON.stringify(resultado)).not.toContain('segredo');
    await writeFile(caminho, '{"ok":true}');
    expect(await conferirResposta(caminho, schema)).toMatchObject({ estado: 'ok', valor: { ok: true } });
  } finally { await rm(pasta, { recursive: true, force: true }); }
});
