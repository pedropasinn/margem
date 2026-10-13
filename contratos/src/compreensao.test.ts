import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  NOMES_DOS_SCHEMAS, validarApresentacao, validarExecucaoCompreensao, validarLoteDoModelo, validarModeloDoCapitulo,
  validarPerfilDoLeitor, validarPlanoPedagogico,
} from './index';

function caso(pasta: string, arquivo: string): unknown {
  return JSON.parse(readFileSync(new URL(`../casos/${pasta}/${arquivo}`, import.meta.url), 'utf8')) as unknown;
}

const validadores = {
  ModeloDoCapitulo: validarModeloDoCapitulo, LoteDoModelo: validarLoteDoModelo, PlanoPedagogico: validarPlanoPedagogico,
  Apresentacao: validarApresentacao, PerfilDoLeitor: validarPerfilDoLeitor, ExecucaoCompreensao: validarExecucaoCompreensao,
};
for (const [pasta, validar] of Object.entries(validadores)) {
  describe(`casos ${pasta}`, () => {
    const arquivos = readdirSync(new URL(`../casos/${pasta}/`, import.meta.url));
    test('tem ao menos dois válidos e quatro inválidos, com campo desconhecido e versão errada', () => {
      expect(arquivos.filter((nome) => nome.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
      expect(arquivos.filter((nome) => nome.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
      expect(arquivos).toContain('invalido-campo-desconhecido.json');
      expect(arquivos).toContain('invalido-versao.json');
    });
    for (const arquivo of arquivos) test(arquivo, () => {
      const valor = caso(pasta, arquivo);
      const copia = structuredClone(valor);
      expect(validar(valor), JSON.stringify(validar.errors)).toBe(arquivo.startsWith('valido-'));
      expect(valor).toEqual(copia);
    });
  });
}

test('schemas da compreensão têm identidade e fecham todos os objetos', () => {
  function conferir(valor: unknown): void {
    if (!valor || typeof valor !== 'object') return;
    if (Array.isArray(valor)) { valor.forEach(conferir); return; }
    const objeto = valor as Record<string, unknown>;
    if (objeto.type === 'object') expect(objeto.additionalProperties).toBe(false);
    Object.values(objeto).forEach(conferir);
  }
  const novos = NOMES_DOS_SCHEMAS.slice(NOMES_DOS_SCHEMAS.indexOf('ModeloDoCapituloV1'), NOMES_DOS_SCHEMAS.indexOf('ExecucaoCompreensaoV1') + 1);
  expect(novos).toEqual(['ModeloDoCapituloV1', 'LoteDoModeloV1', 'PlanoPedagogicoV1', 'ApresentacaoDoPlanoV1', 'PerfilDoLeitorV1', 'ExecucaoCompreensaoV1']);
  for (const nome of novos) {
    const schema = JSON.parse(readFileSync(new URL(`../schemas/${nome}.schema.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe(`https://margem.local/contratos/${nome}.schema.json`);
    conferir(schema);
  }
});
