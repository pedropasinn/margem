import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { validarResolucaoGerada, type ResolucaoV2 } from '@margem/contratos';
import { montarPromptDeExplicacao, montarPromptDeResolucao } from './prompts.js';

const id = (n: number): string => String(n).padStart(26, '0');
const sessao: ResolucaoV2 = {
  versao: 2, id: id(1), documento_id: id(2), versao_id: id(3),
  origem: { tipo: 'recorte', pagina: 7, retangulo: { x: 0, y: 0, largura: 1, altura: 0.5 }, imagem_sha256: 'a'.repeat(64) },
  texto_extraido: 'Calcule ∫₀¹ x² dx.', resolucao: null, execucao: null, mensagens: [], criada_em: '2026-09-27T10:00:00Z',
};

test('resolver: página, texto cercado e aviso quando a imagem não vai junto', () => {
  const com = montarPromptDeResolucao(sessao, 'Cálculo I', true);
  expect(com.prompt).toContain('**Cálculo I**, página 7');
  expect(com.prompt).toContain('Calcule ∫₀¹ x² dx.');
  expect(com.prompt).not.toContain('não pôde ir junto');
  expect(montarPromptDeResolucao(sessao, 'Cálculo I', false).prompt).toContain('não pôde ir junto');
  expect(com.schema.$id).toBe('https://margem.local/prompts/resolver-exercicio@3.schema.json');
  expect(montarPromptDeResolucao({ ...sessao, texto_extraido: ' ' }, 'x', true).prompt).toContain('(vazio: o recorte não tinha camada de texto)');
});

test('explicar: exige a resolução e a pergunta, e leva o histórico até ela', () => {
  expect(() => montarPromptDeExplicacao(sessao, id(9), true)).toThrow();
  const pronta: ResolucaoV2 = {
    ...sessao, execucao: { modelo: 'm', esforco: 'e' },
    resolucao: { enunciado: 'Calcule ∫₀¹ x² dx.', legibilidade: 'boa', conceitos: [], observacao: null,
      itens: [{ rotulo: '', enunciado: '∫₀¹ x² dx', estrategia: 'Primitiva.', passos: [{ texto: 'Primitiva de x².', calculo: 'x³/3' }], resposta: '1/3', verificacao: null }] },
    mensagens: [{ id: id(10), autor: 'leitor', texto: 'Por que x³/3?', criada_em: '2026-09-27T10:01:00Z' }],
  };
  const montado = montarPromptDeExplicacao(pronta, id(10), true);
  expect(montado.prompt).toContain('Passo 1: Primitiva de x².');
  expect(montado.prompt).toContain('Por que x³/3?');
  expect(montado.prompt).toContain('(esta é a primeira pergunta)');
});

test('resolver @2: pede LaTeX entre $…$ e $$…$$; a saída real do Codex (p. 17, fixture da web) cabe no contrato', () => {
  const { prompt, schema } = montarPromptDeResolucao(sessao, 'Cálculo I', true);
  expect(prompt).toContain('entre `$…$`');
  expect(prompt).toContain('entre `$$…$$`');
  expect(prompt).not.toContain('sem LaTeX');
  expect(schema.$id).toBe('https://margem.local/prompts/resolver-exercicio@3.schema.json');
  const real: unknown = JSON.parse(readFileSync(new URL('../../../web/src/leitor/resolucao/fixtures/resolucao-p17-v2.json', import.meta.url), 'utf8'));
  expect(validarResolucaoGerada(real), JSON.stringify(validarResolucaoGerada.errors)).toBe(true);
});
