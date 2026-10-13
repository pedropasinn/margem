import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  FORMULARIO_PADRAO_DA_SALA, NOMES_DOS_SCHEMAS, PERGUNTAS_POR_DOCUMENTO_SUGERIDAS, conferirRespostas,
  validarComentarioDaSala, validarFormularioDaSala, validarRespostaDaSala, validarSalaDeTeste,
  type FormularioDaSalaV1,
} from './index';

const validadores = {
  FormularioDaSala: validarFormularioDaSala, RespostaDaSala: validarRespostaDaSala,
  ComentarioDaSala: validarComentarioDaSala, SalaDeTeste: validarSalaDeTeste,
};

for (const [nome, validar] of Object.entries(validadores)) describe(`${nome}V1`, () => {
  const pasta = new URL(`../casos/${nome}/`, import.meta.url);
  const arquivos = readdirSync(pasta);
  test('está registrado, fecha os objetos e tem casos suficientes', () => {
    expect(NOMES_DOS_SCHEMAS).toContain(`${nome}V1`);
    const schema = JSON.parse(readFileSync(new URL(`../schemas/${nome}V1.schema.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(schema.$id).toBe(`https://margem.local/contratos/${nome}V1.schema.json`);
    expect(schema.additionalProperties).toBe(false);
    expect(arquivos.filter((a) => a.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
    expect(arquivos.filter((a) => a.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
  });
  for (const arquivo of arquivos) test(arquivo, () => {
    const valor: unknown = JSON.parse(readFileSync(new URL(arquivo, pasta), 'utf8'));
    const copia = structuredClone(valor);
    expect(validar(valor), JSON.stringify(validar.errors)).toBe(arquivo.startsWith('valido-'));
    expect(valor).toEqual(copia);
  });
});

test('o formulário padrão e as perguntas sugeridas são válidos', () => {
  expect(validarFormularioDaSala(FORMULARIO_PADRAO_DA_SALA), JSON.stringify(validarFormularioDaSala.errors)).toBe(true);
  const comPorDocumento: FormularioDaSalaV1 = { ...FORMULARIO_PADRAO_DA_SALA, por_documento: PERGUNTAS_POR_DOCUMENTO_SUGERIDAS };
  expect(validarFormularioDaSala(comPorDocumento)).toBe(true);
});

describe('conferirRespostas', () => {
  const formulario = JSON.parse(readFileSync(new URL('../casos/FormularioDaSala/valido-completo.json', import.meta.url), 'utf8')) as FormularioDaSalaV1;
  const documentos = ['01KAAAAAAAAAAAAAAAAAAAAAAA', '01KBBBBBBBBBBBBBBBBBBBBBBB'];
  test('rascunho incompleto passa; envio exige as obrigatórias', () => {
    const rascunho = { geral: { primeira_impressao: 4 }, por_documento: {} };
    expect(conferirRespostas(formulario, documentos, rascunho, false)).toEqual([]);
    expect(conferirRespostas(formulario, documentos, rascunho, true)).toEqual([{ campo: 'geral.usaria_de_novo', codigo: 'obrigatoria_sem_resposta' }]);
    expect(conferirRespostas(formulario, documentos, { geral: { primeira_impressao: 4, usaria_de_novo: 'Sim' }, por_documento: {} }, true)).toEqual([]);
  });
  test('recusa tipo errado, opção inexistente, pergunta e documento estranhos, texto longo demais', () => {
    const problemas = conferirRespostas(formulario, documentos, {
      geral: { primeira_impressao: '4', usaria_de_novo: 'Nunca', inventada: 'x', comentario: 3 },
      por_documento: { '01KCCCCCCCCCCCCCCCCCCCCCCC': { clareza: 3 }, [documentos[0]!]: { nota_util: 'x'.repeat(301), clareza: 0 } },
    }, false);
    expect(problemas.map((p) => `${p.campo}:${p.codigo}`).sort()).toEqual([
      'geral.comentario:tipo_errado', 'geral.inventada:pergunta_inexistente', 'geral.primeira_impressao:tipo_errado',
      'geral.usaria_de_novo:opcao_inexistente', `por_documento.${documentos[0]!}.clareza:tipo_errado`,
      `por_documento.${documentos[0]!}.nota_util:longo_demais`, 'por_documento.01KCCCCCCCCCCCCCCCCCCCCCCC:documento_fora_da_sala',
    ].sort());
  });
  test('pergunta obrigatória por documento vale para cada documento no envio', () => {
    const comObrigatoria: FormularioDaSalaV1 = { ...formulario, por_documento: [{ id: 'clareza', tipo: 'escala', enunciado: 'Claras?', obrigatoria: true }] };
    const geral = { primeira_impressao: 4, usaria_de_novo: 'Sim' };
    expect(conferirRespostas(comObrigatoria, documentos, { geral, por_documento: { [documentos[0]!]: { clareza: 4 } } }, true))
      .toEqual([{ campo: `por_documento.${documentos[1]!}.clareza`, codigo: 'obrigatoria_sem_resposta' }]);
  });
});
