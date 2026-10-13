import { expect, test } from 'vitest';
import type { Bloco, ModeloDoCapituloV1 } from '@margem/contratos';
import { novosAliases } from '@margem/core';
import { idTeste } from '../../testes/apoio.js';
import { exigirModo } from '../modos.js';
import {
  LIMITE_DE_CONTEXTO_TOKENS, montarPromptDeAnalise, montarPromptDeRevisao, montarPromptDeSintese, montarPromptDoPlano, serializarModelo,
  serializarPerfil,
} from './prompts.js';

const argumentativa = exigirModo({ id: 'argumentativa', revisao: 1 });
const literaria = exigirModo({ id: 'literaria', revisao: 1 });
const ULID = /[0-7][0-9A-HJKMNP-TV-Z]{25}/u;

function bloco(n: number, tipo: Bloco['tipo'], texto: string): Pick<Bloco, 'id' | 'tipo' | 'texto' | 'ordem'> {
  return { id: idTeste('B', n), ordem: n, tipo, texto };
}
const blocos = [bloco(0, 'capitulo', 'Capítulo'), bloco(1, 'paragrafo', 'Primeiro parágrafo com uma tese.'), bloco(2, 'paragrafo', 'Segundo parágrafo.')];

function modelo(): ModeloDoCapituloV1 {
  const versao = idTeste('V', 1);
  return {
    versao: 1, id: idTeste('M', 1), execucao_id: idTeste('E', 1), versao_id: versao, secao_id: idTeste('S', 1), modo: { id: 'argumentativa', revisao: 1 },
    revisao: 0, estagio: 'analise_local', base_id: null, lote_id: null, movimento: null, unidades: [],
    elementos: [{
      id: idTeste('K', 1), nucleo: 'afirmacao', papel: 'tese', centralidade: 1, enunciado: 'Há uma tese.', qualificadores: [], notas: [],
      ancoras: [{ versao_id: versao, bloco_id: idTeste('B', 1), inicio_utf16: 22, fim_utf16: 31, citacao: 'uma tese.', prefixo: '', sufixo: '' }],
      origem: { estagio: 'analise_local', job_id: idTeste('J', 1) },
    }],
    relacoes: [], dificuldades: [], criada_em: '2026-09-25T12:00:00Z',
  };
}

test('a análise local só mostra aliases, marca os blocos de contexto e restringe papéis e blocos no schema', () => {
  const montado = montarPromptDeAnalise({ modo: argumentativa, blocos, responsaveis: [idTeste('B', 1), idTeste('B', 2)] });
  expect(montado.prompt).not.toMatch(ULID);
  expect(montado.prompt).toContain('⟦b:B001⟧ [contexto · capitulo]');
  expect(montado.prompt).toContain('⟦b:B002⟧ [paragrafo]');
  expect(montado.prompt).toContain('Quando os blocos forem estrofes');
  expect(montado.aliases.blocos.id('B002')).toBe(idTeste('B', 1));
  const schema = JSON.stringify(montado.schema);
  expect(schema).toContain('"enum":["tese","conceito","justificativa"]');
  expect(schema).toContain('"enum":["B002","B003"]');
  expect(schema).not.toContain('B001"');
  expect(montarPromptDeAnalise({ modo: literaria, blocos, responsaveis: [idTeste('B', 1)] }).prompt).toContain('## Verso');
});

test('o perfil do leitor só entra no plano; análise, síntese e revisão nunca o recebem', () => {
  const perfil = { versao: 1 as const, revisao: 0, areas: [{ nome: 'Economia', nivel: 'avancado' as const }], preferencias: ['MARCADOR-DO-PERFIL'], observacoes: '', atualizado_em: '2026-09-25T12:00:00Z' };
  const plano = montarPromptDoPlano({ modo: argumentativa, blocos, modelo: modelo(), perfil });
  expect(plano.prompt).toContain('MARCADOR-DO-PERFIL');
  expect(plano.prompt).toContain('Economia: avançado');
  expect(plano.prompt).not.toMatch(ULID);
  const outros = [
    montarPromptDeAnalise({ modo: argumentativa, blocos, responsaveis: [idTeste('B', 1)] }).prompt,
    montarPromptDeSintese({ modo: argumentativa, blocos, modelo: modelo() }).prompt,
    montarPromptDeRevisao({ modo: argumentativa, blocosDoCapitulo: blocos, janela: blocos, modelo: modelo(), elementosDaJanela: [idTeste('K', 1)], inteira: true }).prompt,
  ];
  for (const prompt of outros) {
    expect(prompt).not.toContain('MARCADOR-DO-PERFIL');
    expect(prompt).not.toContain('perfil do leitor');
    expect(prompt).not.toMatch(ULID);
  }
  expect(serializarPerfil(null)).toContain('ainda não preencheu');
});

test('a síntese leva o texto quando cabe e, quando não cabe, só esqueleto e evidências', () => {
  const curta = montarPromptDeSintese({ modo: argumentativa, blocos, modelo: modelo() });
  expect(curta.com_texto).toBe(true);
  expect(curta.prompt).toContain('## Texto do capítulo');
  expect(curta.prompt).toContain('citação (B002): “uma tese.”');
  const enorme = [...blocos, bloco(3, 'paragrafo', 'palavra '.repeat(LIMITE_DE_CONTEXTO_TOKENS))];
  const longa = montarPromptDeSintese({ modo: argumentativa, blocos: enorme, modelo: modelo() });
  expect(longa.com_texto).toBe(false);
  expect(longa.prompt).not.toContain('## Texto do capítulo');
  expect(longa.prompt).toContain('- B004 [paragrafo] palavra palavra');
});

test('o modelo serializado usa aliases estáveis para elementos, relações e dificuldades', () => {
  const aliases = novosAliases();
  const texto = serializarModelo(modelo(), aliases);
  expect(texto).toContain('- L01 · afirmacao · papel: tese · centralidade 1');
  expect(texto).toContain('### Relações\n\nNenhuma.');
  expect(aliases.elementos.id('L01')).toBe(idTeste('K', 1));
});
