import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  aplicarLote, conferirAncora, conferirMarcaGerada, conferirProgresso, hashEstrutural, hashMarcas, projetarRawText,
  validarAncora, validarCamadaEditorial, validarCanonico, validarExecucaoLeitura, validarJobResult,
  validarLoteRevisao, validarMarca, validarMarcaGerada, validarMarcasLegado, validarParte, validarPartes, validarProgresso,
  validadoresSchema,
} from './index';
import type { AncoraV1, CanonicoV1, ExecucaoLeituraV1, JobResultV1, LoteRevisaoV1, MarcaGeradaV1, MarcaV1, OperacaoRevisao, ParteV1, ProgressoV1 } from './tipos';
import { canonicoDaFixture } from '../testes/fixture';

function caso<T>(nome: string, arquivo = 'valido-minimo'): T {
  return JSON.parse(readFileSync(new URL(`../casos/${nome}/${arquivo}.json`, import.meta.url), 'utf8')) as T;
}
const id = (numero: number): string => String(numero).padStart(26, '0');
const validadores = { Canonico: validarCanonico, Ancora: validarAncora, Parte: validarParte, MarcaGerada: validarMarcaGerada, Marca: validarMarca, LoteRevisao: validarLoteRevisao, JobResult: validarJobResult, Progresso: validarProgresso, ExecucaoLeitura: validarExecucaoLeitura, MarcasLegado: validarMarcasLegado };
for (const [nome, validar] of Object.entries(validadores)) {
  describe(nome, () => {
    const arquivos = readdirSync(new URL(`../casos/${nome}/`, import.meta.url));
    test('tem ao menos dois válidos e quatro inválidos', () => {
      expect(arquivos.filter((nome) => nome.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
      expect(arquivos.filter((nome) => nome.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
    });
    for (const arquivo of arquivos) test(arquivo, () => {
      const valor = caso<unknown>(nome, arquivo.replace(/\.json$/, ''));
      const copia = structuredClone(valor);
      expect(validar(valor), JSON.stringify(validar.errors)).toBe(arquivo.startsWith('valido-'));
      expect(valor).toEqual(copia);
    });
  });
}

test('legado é cópia byte a byte, sem endurecimento silencioso', () => {
  expect(readFileSync(new URL('../schemas/MarcasLegadoV1.schema.json', import.meta.url)))
    .toEqual(readFileSync(new URL('../../docs/desenho/05-marcas-legado.schema.json', import.meta.url)));
  const legado = caso<{ marcas: { pagina_pdf: number; citacao: string }[] }>('MarcasLegado');
  legado.marcas[0]!.pagina_pdf = -1;
  legado.marcas[0]!.citacao = '';
  expect(validarMarcasLegado(legado)).toBe(true);
});
test('novos schemas têm identidade e fecham todos os objetos', () => {
  function conferir(valor: unknown): void {
    if (!valor || typeof valor !== 'object') return;
    if (Array.isArray(valor)) { valor.forEach(conferir); return; }
    const objeto = valor as Record<string, unknown>;
    if (objeto.type === 'object') expect(objeto.additionalProperties).toBe(false);
    Object.values(objeto).forEach(conferir);
  }
  for (const nome of Object.keys(validadores).filter((nome) => nome !== 'MarcasLegado')) {
    const schema = JSON.parse(readFileSync(new URL(`../schemas/${nome}V1.schema.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe(`https://margem.local/contratos/${nome}V1.schema.json`);
    conferir(schema);
  }
});

describe('Unicode, hash e âncoras', () => {
  test.each(['📖', '🧭', 'café', 'ﬁ', 'ﬂ'])('confere a citação literal %s da fixture', (citacao) => {
    const canonico = canonicoDaFixture();
    expect(validarCanonico(canonico)).toBe(true);
    const bloco = canonico.blocos.find((bloco) => bloco.texto.includes(citacao))!;
    const inicio = bloco.texto.indexOf(citacao);
    const ancora: AncoraV1 = { versao_id: id(20), bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao, prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length) };
    expect(conferirAncora(bloco, ancora)).toBe(true);
    expect(conferirAncora(bloco, { ...ancora, bloco_id: id(99) })).toBe(false);
    expect(conferirAncora(bloco, { ...ancora, prefixo: 'errado' })).toBe(false);
    expect(conferirAncora(bloco, { ...ancora, fim_utf16: ancora.fim_utf16 + 1 })).toBe(false);
  });
  test('não corta par substituto nem normaliza combinantes', () => {
    const ancora = caso<AncoraV1>('Ancora');
    expect(validarAncora({ ...ancora, citacao: '\ud83e', fim_utf16: 4 })).toBe(false);
    expect(validarAncora({ ...ancora, citacao: 'café', fim_utf16: 8 })).toBe(true);
    const bloco = { id: ancora.bloco_id, texto: 'Um café' };
    expect(conferirAncora(bloco, { ...ancora, citacao: 'café', fim_utf16: 8, prefixo: '', sufixo: '' })).toBe(false);
  });
  test('hash inclui id, tipo, texto e ordem; ignora metadados; projeção usa UTF-16', () => {
    const { blocos } = canonicoDaFixture();
    const hash = hashEstrutural(blocos);
    expect(hashEstrutural([...blocos].reverse())).not.toBe(hash);
    for (const alteracao of [{ id: id(99) }, { tipo: 'codigo' as const }, { texto: 'novo' }]) {
      const alterados = structuredClone(blocos); Object.assign(alterados[0]!, alteracao);
      expect(hashEstrutural(alterados)).not.toBe(hash);
    }
    expect(hashEstrutural(blocos.map((bloco) => ({ ...bloco, ordem: 99 })))).toBe(hash);
    const { raw_text, offsets } = projetarRawText(blocos);
    expect(raw_text).toBe(blocos.map((bloco) => bloco.texto).join('\n\n'));
    for (const bloco of blocos) expect(raw_text.slice(offsets[bloco.id]!.inicio_utf16, offsets[bloco.id]!.fim_utf16)).toBe(bloco.texto);
    expect(projetarRawText([])).toEqual({ raw_text: '', offsets: {} });
    expect(() => projetarRawText([blocos[0]!, blocos[0]!])).toThrow();
  });
  test('hash é conferido por padrão e pode ser adiado explicitamente', () => {
    const canonico = caso<CanonicoV1>('Canonico', 'invalido-hash');
    expect(validadoresSchema.CanonicoV1(canonico)).toBe(true);
    expect(validarCanonico(canonico)).toBe(false);
    expect(validarCanonico(canonico, { conferir_hash: false })).toBe(true);
  });
});

function canonicoComSecoes(): CanonicoV1 {
  const canonico = caso<CanonicoV1>('Canonico');
  const modelo = canonico.blocos[0]!;
  canonico.blocos = [
    { ...modelo, id: id(1), ordem: 0, tipo: 'capitulo', texto: 'Título' },
    { ...modelo, id: id(2), ordem: 1, tipo: 'secao', texto: 'Subtítulo' },
    { ...modelo, id: id(3), ordem: 2 },
    { ...modelo, id: id(4), ordem: 3, tipo: 'capitulo', texto: 'Segundo' },
  ];
  canonico.secoes = [
    { id: id(10), nivel: 1, titulo: 'Título', ordem: 0, bloco_inicio: id(1), bloco_fim: id(3) },
    { id: id(11), nivel: 2, titulo: 'Subtítulo', ordem: 1, bloco_inicio: id(2), bloco_fim: id(3) },
    { id: id(12), nivel: 1, titulo: 'Segundo', ordem: 2, bloco_inicio: id(4), bloco_fim: id(4) },
  ];
  canonico.hash_estrutural = hashEstrutural(canonico.blocos);
  return canonico;
}
describe('integridade do canônico', () => {
  test('aceita árvore e recusa cruzamentos, saltos de nível e título com filhos', () => {
    expect(validarCanonico(canonicoComSecoes())).toBe(true);
    const mutacoes: ((c: CanonicoV1) => void)[] = [
      (c) => { c.secoes[1]!.nivel = 3; },
      (c) => { c.secoes[0]!.bloco_fim = id(2); },
      (c) => { c.secoes[1]!.bloco_fim = id(4); },
      (c) => { c.secoes[2]!.bloco_inicio = id(2); },
      (c) => { c.blocos[0]!.texto += '\nTexto dos filhos'; c.hash_estrutural = hashEstrutural(c.blocos); },
      (c) => { c.secoes[0]!.bloco_fim = id(99); },
      (c) => { c.blocos[1]!.id = id(1); },
      (c) => { c.blocos[1]!.ordem = 0; },
    ];
    for (const mudar of mutacoes) { const c = canonicoComSecoes(); mudar(c); expect(validarCanonico(c)).toBe(false); }
  });
  test('origens, inline, notas e assets têm referências e intervalos conferidos', () => {
    const c = caso<CanonicoV1>('Canonico');
    const b = c.blocos[0]!;
    b.origens = [{ tipo: 'pdf', pagina: 1, bbox: [0, 0, 10, 10], inicio: 0, fim: 5 }, { tipo: 'pdf', pagina: 2, bbox: [0, 0, 10, 10], inicio: 5, fim: b.texto.length }];
    b.inline = [{ inicio: 3, fim: 5, estilo: 'italico' }];
    expect(validarCanonico(c)).toBe(true);
    b.inline[0]!.fim = 4; expect(validarCanonico(c)).toBe(false);
    b.inline = [{ inicio: 3, fim: 5, estilo: 'nota_ref', ref: id(2) }];
    expect(validarCanonico(c)).toBe(false);
    c.blocos.push({ ...structuredClone(b), id: id(2), ordem: 1, tipo: 'nota_rodape', inline: [] });
    c.hash_estrutural = hashEstrutural(c.blocos); expect(validarCanonico(c)).toBe(true);
    c.assets = [{ id: id(90), tipo: 'pagina', caminho: 'pagina.png', sha256: '0'.repeat(64), bloco_id: id(1) }];
    b.asset_id = id(90); expect(validarCanonico(c)).toBe(true);
    c.assets[0]!.bloco_id = id(2); expect(validarCanonico(c)).toBe(false);
  });
  test.each(['pt-BR', 'zh-Hant-TW', 'x-margem', 'i-klingon', 'en-US-u-ca-gregory'])('aceita idioma %s', (idioma) => {
    const c = caso<CanonicoV1>('Canonico'); c.documento.idioma = idioma; expect(validarCanonico(c)).toBe(true);
  });
  test.each(['pt_BR', 'português', 'en-u-ca-u-nu', 'sl-rozaj-rozaj'])('recusa idioma %s', (idioma) => {
    const c = caso<CanonicoV1>('Canonico'); c.documento.idioma = idioma; expect(validarCanonico(c)).toBe(false);
  });
});

describe('marcas e camada editorial', () => {
  test('camada distingue versão, função e validade; ocultação/rejeição não libera intervalo', () => {
    const a = caso<MarcaV1>('Marca');
    const b = { ...structuredClone(a), id: id(51) };
    expect(validarCamadaEditorial([a, b])).toEqual([[a.id, b.id]]);
    expect(validarCamadaEditorial([a, { ...b, visivel: false, avaliacao: 'rejeitada' }])).toHaveLength(1);
    for (const validade of ['ambigua', 'orfa'] as const) expect(validarCamadaEditorial([a, { ...b, validade }])).toEqual([]);
    expect(validarCamadaEditorial([a, { ...b, funcao: 'nenhuma' }])).toEqual([]);
    expect(validarCamadaEditorial([a, { ...b, ancora: { ...b.ancora, versao_id: id(99) } }])).toEqual([]);
    expect(validarCamadaEditorial([a, { ...b, ancora: { ...b.ancora, inicio_utf16: 5, fim_utf16: 7 }, subfaixas: [] }])).toEqual([]);
  });
  test('sublinhar deve estar presente, ser único e não se sobrepor', () => {
    const marca = caso<MarcaGeradaV1>('MarcaGerada');
    expect(validarMarcaGerada({ ...marca, citacao: 'aa aa', sublinhar: ['aa'] })).toBe(false);
    expect(validarMarcaGerada({ ...marca, citacao: 'abcd', sublinhar: ['abc', 'bcd'] })).toBe(false);
    expect(validarMarcaGerada({ ...marca, citacao: 'abcd', sublinhar: ['ab', 'cd'] })).toBe(true);
    const bloco = { id: marca.bloco_id, texto: 'Um 🧭, café e ﬁ. Um 🧭, café e ﬁ.' };
    expect(conferirMarcaGerada(bloco, { ...marca, prefixo: '', sufixo: '' })).toBe(false);
    expect(conferirMarcaGerada(bloco, { ...marca, prefixo: 'ﬁ. Um ', sufixo: '' })).toBe(true);
    expect(conferirMarcaGerada(bloco, { ...marca, citacao: 'ausente', sublinhar: [] })).toBe(false);
    expect(validarMarcaGerada({ ...marca, id: id(50) })).toBe(false);
    expect(validarMarcaGerada({ ...marca, inicio_utf16: 3 })).toBe(false);
  });
});

describe('referências externas', () => {
  test('responsabilidade é única; contexto pode aparecer em várias partes', () => {
    const a = caso<ParteV1>('Parte');
    const b = { ...a, id: id(31), ordem: 1, blocos_responsaveis: [id(2)] };
    expect(validarPartes([a, b])).toBe(true);
    expect(validarPartes([a, { ...b, blocos_responsaveis: [id(1)] }])).toBe(false);
    expect(validarPartes([{ ...a, blocos_contexto: [id(3)] }, { ...b, blocos_contexto: [id(3)] }])).toBe(true);
    const execucao = caso<ExecucaoLeituraV1>('ExecucaoLeitura');
    const c = caso<CanonicoV1>('Canonico');
    expect(validarPartes([a], execucao, c)).toBe(true);
    expect(validarPartes([a], { ...execucao, id: id(99) }, c)).toBe(false);
    expect(validarPartes([a, b], execucao, c)).toBe(false);
    expect(validarPartes([{ ...a, blocos_responsaveis: [id(99)] }], execucao, c)).toBe(false);
  });
  test('progresso confere documento, versão, bloco e capítulo', () => {
    const p = caso<ProgressoV1>('Progresso'); const c = caso<CanonicoV1>('Canonico');
    expect(conferirProgresso(c, id(80), id(20), p)).toBe(true);
    expect(conferirProgresso(c, id(99), id(20), p)).toBe(false);
    expect(conferirProgresso(c, id(80), id(99), p)).toBe(false);
    expect(conferirProgresso(c, id(80), id(20), { ...p, capitulos_concluidos: [id(99)] })).toBe(false);
  });
  test('job adiado exige data; falha não publica artefato; datas inválidas são recusadas', () => {
    const j = caso<JobResultV1>('JobResult');
    expect(validarJobResult({ ...j, estado: 'adiado' })).toBe(false);
    expect(validarJobResult({ ...j, estado: 'falhou' })).toBe(false);
    expect(validarJobResult({ ...j, artefato: undefined, estado: 'falhou' })).toBe(true);
    const p = caso<ProgressoV1>('Progresso');
    expect(validarProgresso({ ...p, atualizado_em: '2026-02-30T12:00:00Z' })).toBe(false);
  });
});

describe('revisão atômica e idempotente', () => {
  test('aplica, serializa e reaplica sem depender de memória de processo', () => {
    const marcas = [caso<MarcaV1>('Marca')]; const lote = caso<LoteRevisaoV1>('LoteRevisao');
    expect(hashMarcas(marcas)).toBe(lote.snapshot_base);
    const original = structuredClone(marcas);
    const umaVez = aplicarLote(marcas, lote);
    expect(umaVez[0]!.avaliacao).toBe('confirmada');
    expect(aplicarLote(JSON.parse(JSON.stringify(umaVez)) as MarcaV1[], lote)).toEqual(umaVez);
    expect(marcas).toEqual(original);
    expect(() => aplicarLote(marcas, { ...lote, snapshot_base: '0'.repeat(64) })).toThrow();
  });
  test('ordena operações da mesma marca, incluindo remoção, e reaplica', () => {
    const marca = caso<MarcaV1>('Marca'); const lote = caso<LoteRevisaoV1>('LoteRevisao');
    const depois = { ...marca, funcao: 'tese' as const };
    lote.operacoes = [
      { ordem: 2, marca_id: marca.id, op: 'remover', antes: depois, depois: {}, motivo: 'Redundante' },
      { ordem: 1, marca_id: marca.id, op: 'mudar_funcao', antes: { funcao: 'conceito' }, depois: { funcao: 'tese' }, motivo: 'Tese' },
    ];
    expect(aplicarLote([marca], lote)).toEqual([]);
    expect(aplicarLote([], lote)).toEqual([]);
  });
  test('todas as operações preservam idempotência e verificam antes', () => {
    const marca = caso<MarcaV1>('Marca'); const lote = caso<LoteRevisaoV1>('LoteRevisao');
    const comentario = { tipo: 'AUTOR' as const, rotulo: 'AUTOR', texto: 'Comentário' };
    const alteracoes: OperacaoRevisao[] = [
      { ordem: 0, marca_id: marca.id, motivo: 'Teste', op: 'mudar_funcao', antes: { funcao: marca.funcao }, depois: { funcao: 'tese' } },
      { ordem: 1, marca_id: marca.id, motivo: 'Teste', op: 'reescrever_comentario', antes: { comentario: null }, depois: { comentario } },
      { ordem: 2, marca_id: marca.id, motivo: 'Teste', op: 'remover_comentario', antes: { comentario }, depois: { comentario: null } },
      { ordem: 3, marca_id: marca.id, motivo: 'Teste', op: 'editar_subfaixas', antes: { subfaixas: marca.subfaixas }, depois: { subfaixas: [] } },
      { ordem: 4, marca_id: marca.id, motivo: 'Teste', op: 'mudar_visibilidade', antes: { visivel: true }, depois: { visivel: false } },
      lote.operacoes[0]!,
    ];
    alteracoes[5]!.ordem = 5; lote.operacoes = alteracoes;
    const resultado = aplicarLote([marca], lote);
    expect(resultado[0]).toMatchObject({ funcao: 'tese', comentario: null, subfaixas: [], visivel: false, avaliacao: 'confirmada' });
    expect(aplicarLote(resultado, lote)).toEqual(resultado);
    const copia = structuredClone(marca);
    lote.operacoes[4]!.marca_id = id(99);
    expect(() => aplicarLote([marca], lote)).toThrow();
    expect(marca).toEqual(copia);
  });
  test('recusa lote obsoleto, campos livres, ordem repetida e subfaixa fora da âncora', () => {
    const marca = caso<MarcaV1>('Marca'); const lote = caso<LoteRevisaoV1>('LoteRevisao');
    expect(() => aplicarLote([{ ...marca, visivel: false }], lote)).toThrow();
    expect(validarLoteRevisao({ ...lote, operacoes: [...lote.operacoes, ...lote.operacoes] })).toBe(false);
    expect(validarLoteRevisao({ ...lote, operacoes: [{ ...lote.operacoes[0], depois: { avaliacao: 'confirmada', visivel: false } }] })).toBe(false);
    lote.operacoes = [{ ordem: 0, marca_id: marca.id, op: 'editar_subfaixas', antes: { subfaixas: marca.subfaixas }, depois: { subfaixas: [{ inicio_utf16: 0, fim_utf16: 2 }] }, motivo: 'Inválido' }];
    expect(() => aplicarLote([marca], lote)).toThrow();
  });
});
