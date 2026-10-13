import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema } from 'ajv';
import { describe, expect, it } from 'vitest';
import type { AncoraV1, Bloco, MensagemV2, Saliencia } from '@margem/contratos';
import { lerModosDeLeitura, obterModo, validadoresSchema, validarMarcaGeradaV2 } from '@margem/contratos';
import { escreverSchemaDoCodex } from '../../executor/artefato.js';
import {
  MAXIMO_IDS_NO_ENUM, montarPromptDeLeitura, montarPromptDeResposta, schemaDaLeitura, schemaDaResposta, schemaDoLeitorV2, schemaDoResponder,
} from './prompt.js';
import type { SchemaJson } from './prompt.js';

const id = (n: number): string => `01K5J17T${String(n).padStart(18, '0')}`;
const VERSAO = id(900);

function bloco(n: number, tipo: Bloco['tipo'], texto: string): Bloco {
  return { id: id(n), ordem: n, tipo, texto, inline: [], origens: [] };
}
const ESTROFE = bloco(2, 'estrofe', 'Bailando no ar, gemia inquieto vaga-lume:\n— “Quem me dera que fosse aquela loira estrela,');
const PARAGRAFO = bloco(3, 'paragrafo', 'Um parágrafo com `crases` e {{chaves}} que não são campos.');
const TITULO = bloco(1, 'secao', 'Círculo vicioso');
const MODOS = lerModosDeLeitura();

/**
 * Trecho do prompt que muda com o modo: do começo até o formato dos blocos, mais o texto da parte.
 * Os snapshots ficam em `snapshots/<modo>.md` (caminhos curtos: o gate do J17 lê `git diff --stat`).
 */
function trechoDoModo(prompt: string): string {
  const cabeca = prompt.slice(0, prompt.indexOf('## Como o texto chega'));
  const cauda = prompt.slice(prompt.indexOf('## Texto desta parte'));
  return `${cabeca}[…]\n\n${cauda}`;
}

describe('montarPromptDeLeitura', () => {
  for (const modo of MODOS.filter(m => m.revisao === 1 && ['argumentativa', 'literaria', 'filosofica', 'filosofica_comentada', 'economica', 'matematica', 'engenharia_dados', 'engenharia_software'].includes(m.id))) {
    it(`snapshot do modo ${modo.id}`, async () => {
      const montado = montarPromptDeLeitura({ prompt_versao: 'leitor-de-parte@2', modo, nivel: 2, blocos: [ESTROFE, TITULO], responsaveis: [ESTROFE.id] });
      expect(montado.prompt_versao).toBe('leitor-de-parte@2');
      await expect(trechoDoModo(montado.prompt)).toMatchFileSnapshot(`./snapshots/${modo.id}.md`);
    });
  }

  it('serializa os blocos como em F1, na ordem do canônico, com a estrofe intacta', () => {
    const { prompt } = montarPromptDeLeitura({ modo: obterModo({ id: 'literaria', revisao: 1 }), nivel: 3, blocos: [PARAGRAFO, ESTROFE, TITULO], responsaveis: [ESTROFE.id, PARAGRAFO.id] });
    const texto = prompt.slice(prompt.indexOf('## Texto desta parte'));
    expect(texto).toContain(`⟦b:${TITULO.id}⟧ [contexto · secao]\nCírculo vicioso\n⟦/b⟧\n`);
    expect(texto).toContain(`⟦b:${ESTROFE.id}⟧ [estrofe]\n${ESTROFE.texto}\n⟦/b⟧\n`);
    expect(texto.indexOf(TITULO.id)).toBeLessThan(texto.indexOf(ESTROFE.id));
    expect(texto.indexOf(ESTROFE.id)).toBeLessThan(texto.indexOf(PARAGRAFO.id));
    // O texto do documento não é interpretado como campo do modelo.
    expect(texto).toContain('{{chaves}}');
  });

  it('as instruções condicionais de verso estão disponíveis em qualquer modo', () => {
    for (const modo of MODOS) {
      const { prompt } = montarPromptDeLeitura({ modo, nivel: 3, blocos: [ESTROFE], responsaveis: [ESTROFE.id] });
      expect(prompt).toContain('## Verso');
      expect(prompt).toContain('Quando os blocos forem estrofes');
      expect(prompt).not.toMatch(/\{\{[a-z_]+\}\}|so-no-modo/u);
      for (const funcao of modo.funcoes) expect(prompt).toContain(`\`${funcao.chave}\` — **${funcao.rotulo}**. ${funcao.pergunta}`);
      for (const tipo of modo.comentarios) expect(prompt).toContain(`- \`${tipo}\`:`);
    }
  });

  it('pede saliência só até o nível alvo e mostra os alvos até ele', () => {
    const modo = obterModo({ id: 'argumentativa', revisao: 1 });
    const um = montarPromptDeLeitura({ modo, nivel: 1, blocos: [PARAGRAFO], responsaveis: [PARAGRAFO.id] });
    expect(um.prompt).toContain('nível de atenção alvo 1');
    expect(um.prompt).toContain('no nível 1, cerca de 4%');
    expect(um.prompt).not.toContain('no nível 2');
    const tres = montarPromptDeLeitura({ modo, nivel: 3, blocos: [PARAGRAFO], responsaveis: [PARAGRAFO.id] });
    expect(tres.prompt).toContain('no nível 3, cerca de 20% coberto');
    expect(tres.prompt).toContain('`1` — sem isto não se entende a passagem;');
  });

  it('continuidade entra cercada e só quando há texto', () => {
    const modo = obterModo({ id: 'filosofica', revisao: 1 });
    const sem = montarPromptDeLeitura({ modo, nivel: 2, blocos: [PARAGRAFO], responsaveis: [PARAGRAFO.id], continuidade: '  ' });
    expect(sem.prompt).not.toContain('partes anteriores deste capítulo registraram');
    const com = montarPromptDeLeitura({ modo, nivel: 2, blocos: [PARAGRAFO], responsaveis: [PARAGRAFO.id], continuidade: 'Resumo com ``` dentro.' });
    expect(com.prompt).toContain('````\nResumo com ``` dentro.\n````');
  });

  it('recusa entrada incoerente', () => {
    const modo = obterModo({ id: 'economica', revisao: 1 });
    expect(() => montarPromptDeLeitura({ modo, nivel: 2, blocos: [PARAGRAFO], responsaveis: [] })).toThrow(/responsável/u);
    expect(() => montarPromptDeLeitura({ modo, nivel: 2, blocos: [PARAGRAFO], responsaveis: [ESTROFE.id] })).toThrow(/fora da entrada/u);
    expect(() => montarPromptDeLeitura({ modo, nivel: 2, blocos: [PARAGRAFO, PARAGRAFO], responsaveis: [PARAGRAFO.id] })).toThrow(/repetido/u);
    expect(() => montarPromptDeLeitura({ modo, nivel: 4 as Saliencia, blocos: [PARAGRAFO], responsaveis: [PARAGRAFO.id] })).toThrow(/Nível/u);
    expect(() => montarPromptDeLeitura({ modo: { ...modo, funcoes: [] }, nivel: 2, blocos: [PARAGRAFO], responsaveis: [PARAGRAFO.id] })).toThrow(/Modo/u);
  });

  it('especializa o schema pelo modo, pelo nível e pelos blocos responsáveis', () => {
    const modo = obterModo({ id: 'matematica', revisao: 1 });
    const { schema } = montarPromptDeLeitura({ modo, nivel: 2, blocos: [ESTROFE, PARAGRAFO], responsaveis: [PARAGRAFO.id] });
    const marca = ((schema.properties as SchemaJson).marcas as SchemaJson).items as SchemaJson;
    const propriedades = marca.properties as SchemaJson;
    expect(propriedades.bloco_id).toEqual({ type: 'string', enum: [PARAGRAFO.id] });
    expect(propriedades.funcao).toEqual({ type: 'string', enum: [...modo.funcoes.map((f) => f.chave), 'nenhuma'] });
    expect(propriedades.saliencia).toEqual({ type: 'integer', enum: [1, 2] });
    // O arquivo versionado não é alterado pela especialização.
    expect(JSON.stringify(schemaDoLeitorV2())).toBe(JSON.stringify(JSON.parse(readFileSync(new URL('../../../../prompts/leitor-de-parte@4.schema.json', import.meta.url), 'utf8'))));
    const muitos = Array.from({ length: MAXIMO_IDS_NO_ENUM + 1 }, (_, i) => id(1000 + i));
    const largo = schemaDaLeitura(modo, 3, muitos);
    expect((((largo.properties as SchemaJson).marcas as SchemaJson).items as SchemaJson).properties).toMatchObject({ bloco_id: { pattern: expect.any(String) as unknown } });
  });
});

describe('montarPromptDeResposta', () => {
  const modo = obterModo({ id: 'literaria', revisao: 1 });
  const ancora: AncoraV1 = {
    versao_id: VERSAO, bloco_id: ESTROFE.id, citacao: 'gemia inquieto vaga-lume', prefixo: 'Bailando no ar, ', sufixo: ':\n— “Quem',
    inicio_utf16: 16, fim_utf16: 40,
  };
  const historico: MensagemV2[] = [
    { id: id(50), autor: 'leitor', texto: 'Quem geme?', criada_em: '2026-09-24T03:00:00Z' },
    { id: id(51), autor: 'ia', texto: 'O vaga-lume.', citacoes: [ancora], criada_em: '2026-09-24T03:00:05Z' },
    { id: id(52), autor: 'leitor', texto: 'E por que ``` geme?', criada_em: '2026-09-24T03:01:00Z' },
  ];

  it('snapshot com núcleo, contexto e histórico', async () => {
    const montado = montarPromptDeResposta({ pergunta: 'E por que ``` geme?', ancora, historico, blocos_nucleo: [ESTROFE], blocos_contexto: [TITULO], modo });
    expect(montado.prompt_versao).toBe('responder@2');
    expect(montado.prompt).not.toMatch(/\{\{[a-z_]+\}\}|so-no-modo/u);
    // A pergunta atual já está no fim do histórico e não se repete nele.
    expect(montado.prompt.split('E por que ``` geme?')).toHaveLength(2);
    expect(montado.prompt).toContain('o texto não diz');
    const trecho = montado.prompt.slice(montado.prompt.indexOf('## O trecho'), montado.prompt.indexOf('## Como o texto chega'));
    await expect(`${trecho}[…]\n\n${montado.prompt.slice(montado.prompt.indexOf('## Núcleo'))}`).toMatchFileSnapshot('./snapshots/responder.md');
  });

  it('o schema leva os ids recebidos e o modo aparece no prompt', () => {
    const { prompt, schema } = montarPromptDeResposta({ pergunta: 'Quem geme?', ancora, historico: [], blocos_nucleo: [ESTROFE], blocos_contexto: [], modo });
    expect(prompt).toContain('Esta é a primeira pergunta da conversa.');
    expect(prompt).toContain('Nenhum bloco além do núcleo.');
    expect(prompt).toContain('**Literária** (`literaria@1`)');
    expect(JSON.stringify(schema)).toContain(`"enum":["${ESTROFE.id}"]`);
  });

  it('recusa âncora fora do núcleo, âncora que não bate com o texto e pergunta vazia', () => {
    const base = { pergunta: 'Quem?', ancora, historico: [], blocos_nucleo: [ESTROFE], blocos_contexto: [TITULO], modo };
    expect(() => montarPromptDeResposta({ ...base, blocos_nucleo: [PARAGRAFO], blocos_contexto: [ESTROFE] })).toThrow(/núcleo/u);
    expect(() => montarPromptDeResposta({ ...base, ancora: { ...ancora, citacao: 'gemia inquieto vaga-lumE' } })).toThrow(/não corresponde/u);
    expect(() => montarPromptDeResposta({ ...base, pergunta: ' ' })).toThrow(/vazia/u);
    expect(() => montarPromptDeResposta({ ...base, blocos_contexto: [ESTROFE] })).toThrow(/repetido/u);
  });
});

// ---------------------------------------------------------------- schemas

function percorrer(valor: unknown, visitar: (objeto: Record<string, unknown>) => void): void {
  if (Array.isArray(valor)) { valor.forEach((item) => { percorrer(item, visitar); }); return; }
  if (typeof valor !== 'object' || valor === null) return;
  visitar(valor as Record<string, unknown>);
  for (const item of Object.values(valor)) percorrer(item, visitar);
}

async function saneado(schema: SchemaJson): Promise<unknown> {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-j17-'));
  try {
    await writeFile(join(pasta, 'origem.json'), JSON.stringify(schema));
    await escreverSchemaDoCodex(join(pasta, 'origem.json'), join(pasta, 'destino.json'));
    return JSON.parse(await readFile(join(pasta, 'destino.json'), 'utf8')) as unknown;
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

describe('schemas dos prompts', () => {
  const casos: [string, SchemaJson][] = [
    ['leitor-de-parte@2', schemaDoLeitorV2()],
    ['responder@2', schemaDoResponder()],
    ['leitor especializado', schemaDaLeitura(obterModo({ id: 'literaria', revisao: 1 }), 2, [id(1)])],
    ['responder especializado', schemaDaResposta([id(1), id(2)])],
  ];
  for (const [nome, schema] of casos) {
    it(`${nome}: autocontido e no formato da saída estruturada depois do saneador`, async () => {
      percorrer(schema, (objeto) => {
        expect(objeto).not.toHaveProperty('$ref');
        expect(objeto).not.toHaveProperty('oneOf');
        expect(objeto).not.toHaveProperty('if');
        if ('const' in objeto) expect(objeto).toHaveProperty('type');
        // Saída estruturada estrita: todo objeto fecha as propriedades e exige todas.
        if (objeto.type === 'object') {
          expect(objeto.additionalProperties).toBe(false);
          expect([...(objeto.required as string[])].sort()).toEqual(Object.keys(objeto.properties as object).sort());
        }
      });
      const limpo = await saneado(schema);
      const esperado: unknown = JSON.parse(JSON.stringify(schema, (chave, valor: unknown) => (chave === 'uniqueItems' ? undefined : valor)));
      // O saneador só tira `uniqueItems` (que continua valendo na conferência local).
      expect(limpo).toEqual(esperado);
      expect(() => new Ajv2020({ strict: false }).compile(limpo as AnySchema)).not.toThrow();
    });
  }
});

/** Gerador determinístico (mulberry32). */
function aleatorio(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('o schema do prompt espelha MarcaGeradaV2', () => {
  const CITACOES = ['café e ﬁ', 'Bailando no ar,\ngemia', '🧭 norte', 'a', 'sob essas hipóteses, somente'];
  const TIPOS = ['AUTOR', 'LEITURA', 'INVESTIGAR', 'OBJECAO', 'CONEXAO', 'TENSAO', 'PREREQUISITO', 'DUVIDA', 'autor'];
  const FUNCOES = ['tese', 'imagem', 'som_e_ritmo', 'passo_nao_trivial', 'nenhuma', 'Tese', 'som-e-ritmo', '', 'a'.repeat(41)];

  function gerar(sorte: () => number, doModo: readonly string[]): { marca: Record<string, unknown>; sublinharLiteral: boolean } {
    const escolher = <T>(lista: readonly T[]): T => lista[Math.floor(sorte() * lista.length)] as T;
    const citacao = escolher(CITACOES);
    const palavras = citacao.split(/[\s,]+/u).filter(Boolean);
    const literal = sorte() < 0.7;
    const sublinhar = literal
      ? (sorte() < 0.5 ? [] : [escolher(palavras)])
      : escolher([['ausente'], [''], ['a', 'a'], [7]]);
    const marca: Record<string, unknown> = {
      bloco_id: sorte() < 0.8 ? id(1) : escolher(['curto', '8ZZZZZZZZZZZZZZZZZZZZZZZZZ', id(2)]),
      citacao: sorte() < 0.9 ? citacao : '',
      prefixo: escolher(['', 'Um ', 7]),
      sufixo: escolher(['', '.', null]),
      funcao: sorte() < 0.6 ? escolher([...doModo, 'nenhuma']) : escolher(FUNCOES),
      saliencia: sorte() < 0.8 ? escolher([1, 1, 2, 3]) : escolher([0, 4, 2.5, '1']),
      sublinhar,
      comentario: sorte() < 0.5 ? null : { tipo: escolher(TIPOS), rotulo: sorte() < 0.9 ? 'R' : '', texto: sorte() < 0.9 ? 'T' : '' },
    };
    if (sorte() < 0.1) marca.id = id(9);
    if (sorte() < 0.1) marca.inicio_utf16 = 3;
    if (sorte() < 0.1) delete marca[escolher(Object.keys(marca))];
    // Sublinhado literal só conta se cada termo ocorre uma única vez na citação (a regra que o schema não expressa).
    const unico = (sublinhar as unknown[]).every((termo) => typeof termo === 'string' && termo !== '' &&
      citacao.indexOf(termo) !== -1 && citacao.indexOf(termo, citacao.indexOf(termo) + 1) === -1);
    return { marca, sublinharLiteral: literal && unico && marca.citacao === citacao };
  }

  const todas = MODOS.flatMap((modo) => modo.funcoes.map((funcao) => funcao.chave));
  const variantes: [string, SchemaJson, readonly string[]][] = [['genérico', schemaDoLeitorV2(), todas]];
  for (const modo of MODOS) {
    for (const nivel of [1, 2, 3] as const) {
      variantes.push([`${modo.id} nível ${String(nivel)}`, schemaDaLeitura(modo, nivel, [id(1)]), modo.funcoes.map((funcao) => funcao.chave)]);
    }
  }

  for (const [nome, schema, doModo] of variantes) {
    it(`${nome}: toda instância válida no prompt é válida no contrato`, () => {
      const validarNoPrompt = new Ajv2020({ strict: false }).compile(((schema.properties as SchemaJson).marcas as SchemaJson).items as AnySchema);
      const sorte = aleatorio(17);
      let aceitas = 0;
      let completas = 0;
      for (let i = 0; i < 4000; i++) {
        const { marca, sublinharLiteral } = gerar(sorte, doModo);
        if (!validarNoPrompt(marca)) continue;
        aceitas += 1;
        expect(validadoresSchema.MarcaGeradaV2(marca), JSON.stringify(marca)).toBe(true);
        if (sublinharLiteral) { completas += 1; expect(validarMarcaGeradaV2(marca), JSON.stringify(marca)).toBe(true); }
      }
      expect(aceitas).toBeGreaterThan(100);
      expect(completas).toBeGreaterThan(50);
    });
  }

  it('os casos do contrato: todo válido passa no prompt; inválido só passa pela regra do sublinhado', () => {
    const validarNoPrompt = new Ajv2020({ strict: false }).compile(((schemaDoLeitorV2().properties as SchemaJson).marcas as SchemaJson).items as AnySchema);
    const pasta = new URL('../../../../contratos/casos/MarcaGeradaV2/', import.meta.url);
    const nomes = readdirSync(pasta).filter((nome) => nome.endsWith('.json')).sort();
    expect(nomes.length).toBeGreaterThanOrEqual(6);
    for (const nome of nomes) {
      const caso: unknown = JSON.parse(readFileSync(new URL(nome, pasta), 'utf8'));
      if (nome.startsWith('valido')) expect(validarNoPrompt(caso), nome).toBe(true);
      else expect(validarNoPrompt(caso), nome).toBe(nome === 'invalido-sublinhado-ausente.json');
    }
  });
});
