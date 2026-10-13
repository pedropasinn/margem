import { readFileSync, readdirSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { expect, test } from 'vitest';
import { obterModo, validarMarcaV2, validarModoDeLeitura, type ModeloDoCapituloV1, type ModoDeLeituraV1 } from '@margem/contratos';
import { montarPromptDeLeitura } from './v2/prompt.js';
import { modeloDoPrompt, protocoloDoModo } from './protocolos.js';
import { montarPromptDeAnalise, montarPromptDeSintese, montarPromptDeRevisao, montarPromptDoPlano } from '../compreensao/prompts.js';
import { resolverAnalise } from '../compreensao/resolver.js';
import { projetarMarcas } from '../compreensao/projecao.js';

const nomes = readdirSync(new URL('../../../prompts/generos/', import.meta.url)).filter(n => !['comum@1.md', 'verso@1.md'].includes(n));
const id = (n: number): string => String(n).padStart(26, '0');
const blocos = [{ id: id(1), tipo: 'estrofe' as const, ordem: 0, texto: 'Talvez a voz retorne.\nTalvez a voz retorne.' }];
function modelo(modo: ModoDeLeituraV1): ModeloDoCapituloV1 {
  const valor = JSON.parse(readFileSync(new URL('../../../contratos/casos/ModeloDoCapitulo/valido-minimo.json', import.meta.url), 'utf8')) as ModeloDoCapituloV1;
  return { ...valor, modo: { id: modo.id, revisao: modo.revisao }, elementos: [], relacoes: [], dificuldades: [], unidades: [], movimento: null };
}
test('o catálogo consolidado tem os dezoito protocolos recomendados, todos com seis funções', () => {
  expect(nomes).toHaveLength(18);
  for (const nome of nomes) {
    const [chave, revisao] = nome.replace('.md', '').split('@');
    const modo = obterModo({ id: chave!, revisao: Number(revisao) });
    expect(validarModoDeLeitura(modo)).toBe(true);
    expect(modo.funcoes).toHaveLength(6);
  }
});
for (const nome of nomes) test(`${nome}: protocolo, schema, âncora e projeção atravessam o fluxo`, () => {
  const [chave, revisao] = nome.replace('.md', '').split('@');
  const modo = obterModo({ id: chave!, revisao: Number(revisao) });
  const m = modelo(modo);
  const analise = montarPromptDeAnalise({ modo, blocos, responsaveis: [id(1)] });
  const montados = [
    montarPromptDeLeitura({ modo, nivel: 3, blocos, responsaveis: [id(1)] }), analise,
    montarPromptDeSintese({ modo, blocos, modelo: m }),
    montarPromptDeRevisao({ modo, blocosDoCapitulo: blocos, janela: blocos, modelo: m, elementosDaJanela: [], inteira: true }),
    montarPromptDoPlano({ modo, blocos, modelo: m, perfil: null }),
  ];
  for (const montado of montados) {
    expect(montado.prompt).toContain(protocoloDoModo(modo));
    expect(montado.prompt).not.toMatch(/<!-- protocolo|\{\{[a-z_]+\}\}/u);
    expect(montado.prompt).toContain('não vira');
  }
  expect(modeloDoPrompt('analisar-passagens@2', modo)).toContain(protocoloDoModo(modo));
  const funcao = modo.funcoes[0]!.chave;
  const saida = {
    elementos: [{ ref: 'n1', nucleo: 'elemento_textual', papel: funcao, citacoes: [{ bloco: 'B001', citacao: 'Talvez a voz retorne.', prefixo: 'retorne.\n', sufixo: '' }], enunciado: 'A voz admite um retorno possível.', qualificadores: ['Talvez'], centralidade: 2, notas: [] }],
    relacoes: [], dificuldades: [], resumo_da_parte: 'Um retorno é cogitado.', limites: [], leitura_integral: true,
  };
  const schema = new Ajv({ strict: true }).compile(analise.schema);
  expect(schema(saida), JSON.stringify(schema.errors)).toBe(true);
  const contexto = { modo, aliases: analise.aliases, responsaveis: blocos, versao_id: m.versao_id, job_id: id(2), novoId: () => id(3) };
  const resolvida = resolverAnalise(saida, contexto);
  expect(resolvida.elementos).toHaveLength(1);
  expect(resolvida.elementos[0]!.ancoras[0]!.inicio_utf16).toBe(blocos[0]!.texto.indexOf('\n') + 1);
  m.elementos = resolvida.elementos;
  const projecao = projetarMarcas(m, { modo, camada_id: m.execucao_id, blocos });
  expect(projecao.marcas).toHaveLength(1);
  expect(projecao.marcas[0]!.marca.funcao).toBe(funcao);
  expect(validarMarcaV2({ ...projecao.marcas[0]!.marca, id: id(4), criada_em: '2026-10-05T12:00:00.000Z' })).toBe(true);
  const ambigua = structuredClone(saida); ambigua.elementos[0]!.citacoes[0]!.prefixo = '';
  expect(resolverAnalise(ambigua, contexto).elementos).toHaveLength(0);
  const errada = structuredClone(saida); errada.elementos[0]!.papel = 'funcao_inventada';
  expect(schema(errada)).toBe(false);
});
test('retomada preserva o prompt anterior e não injeta protocolos novos', () => {
  const modo = obterModo({ id: 'literaria', revisao: 1 });
  const atual = montarPromptDeLeitura({ modo, nivel: 2, blocos, responsaveis: [id(1)] });
  const anterior = montarPromptDeLeitura({ modo, nivel: 2, blocos, responsaveis: [id(1)], prompt_versao: 'leitor-de-parte@2' });
  expect(atual.prompt_versao).toBe('leitor-de-parte@4');
  expect(anterior.prompt).not.toContain('Regras comuns da leitura especializada');
  const antiga = montarPromptDeAnalise({ modo, blocos, responsaveis: [id(1)], prompt_versao: 'analisar-passagens@1' });
  expect(antiga.prompt_versao).toBe('analisar-passagens@1');
  expect(antiga.prompt).not.toContain('Regras comuns da leitura especializada');
  expect(() => montarPromptDeAnalise({ modo, blocos, responsaveis: [id(1)], prompt_versao: '../outra' })).toThrow();
});
