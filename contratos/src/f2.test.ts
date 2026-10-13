import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  CONTRASTE_MINIMO, MODO_F1, NOMES_DOS_SCHEMAS, OPACIDADE_MARCA_TEXTO, TEMAS_DE_REFERENCIA, compor, conferirLegibilidadeModo,
  conferirMarcaGeradaNaExecucao, conferirMarcaGeradaV2, conferirMarcaNoModo, conferirMarcaV2NaExecucao, contrasteDoMarcaTexto,
  decidirConexao, diagnosticarRespostaGerada, faixasDosVersos, hashEstrutural, hashMarcas, lerModosDeLeitura, localizarCitacao,
  marcaV1ParaV2, marcaV2ParaV1, obterModo, projetarRawText, razaoDeContraste, validarAnotacao, validarCamadaEditorial,
  validarCamadaEditorialV2, validarCanonico, validarConexao, validarConversa, validarExecucaoLeituraV2, validarMarcaGeradaV2,
  validarMarcaV2, validarModoDeLeitura, validarPartes, validarRespostaGerada, versosValidos,
} from './index';
import type {
  AnotacaoV1, CanonicoV1, ConexaoV1, ExecucaoLeituraV2, MarcaGeradaV2, MarcaV1, MarcaV2, ModoDeLeituraV1, ParteV1, RespostaGeradaV1,
} from './tipos';

function caso<T>(pasta: string, arquivo = 'valido-minimo'): T {
  return JSON.parse(readFileSync(new URL(`../casos/${pasta}/${arquivo}.json`, import.meta.url), 'utf8')) as T;
}
const id = (numero: number): string => String(numero).padStart(26, '0');

const validadores = {
  ModoDeLeitura: validarModoDeLeitura, MarcaGeradaV2: validarMarcaGeradaV2, MarcaV2: validarMarcaV2,
  ExecucaoLeituraV2: validarExecucaoLeituraV2, Anotacao: validarAnotacao, Conversa: validarConversa,
  RespostaGerada: validarRespostaGerada, Conexao: validarConexao,
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
      const valor = caso<unknown>(pasta, arquivo.replace(/\.json$/, ''));
      const copia = structuredClone(valor);
      expect(validar(valor), JSON.stringify(validar.errors)).toBe(arquivo.startsWith('valido-'));
      expect(valor).toEqual(copia);
    });
  });
}

test('schemas F2 têm identidade e fecham todos os objetos', () => {
  function conferir(valor: unknown): void {
    if (!valor || typeof valor !== 'object') return;
    if (Array.isArray(valor)) { valor.forEach(conferir); return; }
    const objeto = valor as Record<string, unknown>;
    if (objeto.type === 'object') expect(objeto.additionalProperties).toBe(false);
    Object.values(objeto).forEach(conferir);
  }
  const novos = NOMES_DOS_SCHEMAS.slice(NOMES_DOS_SCHEMAS.indexOf('ModoDeLeituraV1'), NOMES_DOS_SCHEMAS.indexOf('ConexaoV1') + 1);
  expect(novos).toEqual(['ModoDeLeituraV1', 'MarcaGeradaV2', 'MarcaV2', 'ExecucaoLeituraV2', 'AnotacaoV1', 'ConversaV1', 'RespostaGeradaV1', 'ConexaoV1']);
  expect(readdirSync(new URL('../schemas/', import.meta.url)).sort()).toEqual(NOMES_DOS_SCHEMAS.map((nome) => `${nome}.schema.json`).sort());
  for (const nome of novos) {
    const schema = JSON.parse(readFileSync(new URL(`../schemas/${nome}.schema.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe(`https://margem.local/contratos/${nome}.schema.json`);
    conferir(schema);
  }
});

describe('modos de leitura', () => {
  const modos = lerModosDeLeitura();
  const porId = new Map(modos.filter(modo => modo.revisao === 1).map((modo) => [modo.id, modo]));
  const chaves = (modo: ModoDeLeituraV1 | undefined): string[] => modo?.funcoes.map((funcao) => funcao.chave) ?? [];

  test('os cinco modos básicos existem e os modos adicionais são válidos', () => {
    expect(readdirSync(new URL('../modos/', import.meta.url)).sort()).toEqual(
      expect.arrayContaining(['argumentativa@1.json', 'economica@1.json', 'filosofica@1.json', 'literaria@1.json', 'matematica@1.json']));
    expect(chaves(porId.get('argumentativa'))).toEqual(['tese', 'conceito', 'justificativa']);
    expect(chaves(porId.get('literaria'))).toEqual(['imagem', 'som_e_ritmo', 'voz', 'virada', 'forma', 'intertexto']);
    expect(chaves(porId.get('filosofica'))).toEqual(['tese', 'conceito', 'distincao', 'argumento', 'objecao', 'consequencia']);
    expect(chaves(porId.get('economica'))).toEqual(['hipotese', 'mecanismo', 'evidencia', 'identificacao', 'resultado', 'limitacao']);
    expect(chaves(porId.get('matematica'))).toEqual(['definicao', 'enunciado', 'passo_nao_trivial', 'tecnica', 'dependencia']);
    for (const modo of modos) {
      expect(validarModoDeLeitura(modo)).toBe(true);
      expect(modo.revisao).toBeGreaterThanOrEqual(1);
      expect(new Set(chaves(modo)).size).toBe(modo.funcoes.length);
    }
    expect(obterModo(MODO_F1)).toEqual(porId.get('argumentativa'));
    expect(() => obterModo({ id: 'argumentativa', revisao: 2 })).toThrow();
  });
  test('argumentativa é o método de F1: cores, perguntas e comentários da V1', () => {
    const modo = porId.get('argumentativa')!;
    const metodo = readFileSync(new URL('../../docs/desenho/04-METODO-DE-MARCACAO.md', import.meta.url), 'utf8');
    expect(modo.funcoes.map((funcao) => funcao.cor.claro)).toEqual(['#FFD926', '#59D675', '#52ABFF']);
    for (const cor of ['#FFD926', '#59D675', '#52ABFF']) expect(metodo).toContain(`\`${cor}\``);
    for (const funcao of modo.funcoes) expect(metodo).toContain(`| ${funcao.pergunta} |`);
    expect(modo.comentarios).toEqual(['AUTOR', 'LEITURA', 'INVESTIGAR', 'OBJECAO', 'CONEXAO']);
  });
  test('contraste do texto sobre o marca-texto a 35% é ≥ 4,5:1 nos dois temas', () => {
    expect(OPACIDADE_MARCA_TEXTO).toBe(0.35);
    for (const modo of modos) for (const funcao of modo.funcoes) for (const tema of ['claro', 'escuro'] as const) {
      const contraste = contrasteDoMarcaTexto(funcao.cor[tema], tema);
      expect(contraste, `${modo.id}.${funcao.chave} ${tema}`).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
    }
    for (const modo of modos) expect(conferirLegibilidadeModo(modo)).toBe(true);
  });
  test('a régua de contraste é numérica e recusa cor ilegível', () => {
    expect(razaoDeContraste([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(compor('#FFFFFF', '#000000', 0.5)).toEqual([127.5, 127.5, 127.5]);
    // Achado: com texto preto/branco puro, a 35% nenhuma cor cai abaixo de 4,5:1 (os piores casos são os extremos).
    expect(contrasteDoMarcaTexto('#000000', 'claro')).toBeGreaterThan(8);
    expect(contrasteDoMarcaTexto('#FFFFFF', 'escuro')).toBeGreaterThan(5.7);
    expect(contrasteDoMarcaTexto('#FFFFFF', 'escuro')).toBeLessThan(5.8);
    // A régua recusa quando a opacidade real do traço é maior (o Marcador de J11 pode usar outra).
    expect(contrasteDoMarcaTexto('#FFD926', 'escuro', 1)).toBeLessThan(CONTRASTE_MINIMO);
    const modo = structuredClone(porId.get('argumentativa')!);
    expect(conferirLegibilidadeModo(modo, 1)).toBe(false);
    expect(conferirLegibilidadeModo(modo, 0.3)).toBe(true);
    expect(conferirLegibilidadeModo(modo, 0.5)).toBe(false); // o amarelo no tema escuro cai para 4,46:1 a 50%
    expect(TEMAS_DE_REFERENCIA.escuro.fundo).toBe('#141414');
  });
  test('as funções de um modo são distinguíveis entre si depois da composição', () => {
    const lab = ([r, g, b]: [number, number, number]): [number, number, number] => {
      const lin = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const [x, y, z] = [(0.4124 * lin(r) + 0.3576 * lin(g) + 0.1805 * lin(b)) / 0.95047, 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b), (0.0193 * lin(r) + 0.1192 * lin(g) + 0.9505 * lin(b)) / 1.08883];
      const f = (t: number): number => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
      return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
    };
    for (const modo of modos) for (const tema of ['claro', 'escuro'] as const) {
      const cores = modo.funcoes.map((funcao) => lab(compor(funcao.cor[tema], TEMAS_DE_REFERENCIA[tema].fundo)));
      cores.forEach((a, i) => cores.slice(i + 1).forEach((b) => expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), `${modo.id} ${tema}`).toBeGreaterThanOrEqual(10)));
    }
  });
});

describe('marcas V2, camada e conversão', () => {
  const v1 = caso<MarcaV1>('Marca');
  test('round-trip V1 → V2 → V1 com os casos V1', () => {
    for (const arquivo of ['valido-minimo', 'valido-orfa']) {
      const original = caso<MarcaV1>('Marca', arquivo);
      const v2 = marcaV1ParaV2(original);
      expect(v2).toMatchObject({ saliencia: 2, camada_id: original.execucao_id, modo: MODO_F1, funcao: original.funcao });
      expect(validarMarcaV2(v2)).toBe(true);
      expect(marcaV2ParaV1(v2)).toEqual(original);
      expect(marcaV1ParaV2(original, original.execucao_id)).toEqual(v2);
    }
    expect(marcaV1ParaV2(v1)).toEqual(caso<MarcaV2>('MarcaV2'));
  });
  test('sem execução, a camada é a do lote de importação; divergência é recusada', () => {
    const semExecucao: MarcaV1 = { ...structuredClone(v1), origem: 'importacao' };
    delete semExecucao.execucao_id;
    expect(() => marcaV1ParaV2(semExecucao)).toThrow();
    const v2 = marcaV1ParaV2(semExecucao, id(45));
    expect(v2.camada_id).toBe(id(45));
    expect(marcaV2ParaV1(v2)).toEqual(semExecucao);
    expect(() => marcaV1ParaV2(v1, id(45))).toThrow();
    expect(() => marcaV1ParaV2({ ...v1, funcao: 'imagem' } as unknown as MarcaV1)).toThrow();
  });
  test('V2 → V1 recusa o que a V1 não representa', () => {
    const v2 = marcaV1ParaV2(v1);
    expect(() => marcaV2ParaV1({ ...v2, saliencia: 1 })).toThrow();
    expect(() => marcaV2ParaV1({ ...v2, modo: { id: 'filosofica', revisao: 1 } })).toThrow();
    expect(() => marcaV2ParaV1({ ...v2, funcao: 'distincao' })).toThrow();
    expect(() => marcaV2ParaV1({ ...v2, comentario: { tipo: 'TENSAO', rotulo: 'TENSÃO', texto: 'x' } })).toThrow();
  });
  test('sobreposição só conflita dentro da mesma camada', () => {
    const a = marcaV1ParaV2(v1);
    const b: MarcaV2 = { ...structuredClone(a), id: id(51) };
    expect(validarCamadaEditorialV2([a, b])).toEqual([{ camada_id: a.camada_id, pares: [[a.id, b.id]] }]);
    const outraCamada: MarcaV2 = { ...structuredClone(b), camada_id: id(41), execucao_id: id(41), modo: { id: 'literaria', revisao: 1 }, funcao: 'imagem' };
    expect(validarCamadaEditorialV2([a, outraCamada])).toEqual([]);
    const importada: MarcaV2 = { ...structuredClone(b), camada_id: id(46), origem: 'importacao' };
    delete importada.execucao_id;
    expect(validarCamadaEditorialV2([a, importada])).toEqual([]);
    expect(validarCamadaEditorialV2([a, { ...b, funcao: 'nenhuma' }])).toEqual([]);
    for (const validade of ['ambigua', 'orfa'] as const) expect(validarCamadaEditorialV2([a, { ...b, validade }])).toEqual([]);
    expect(validarCamadaEditorialV2([a, { ...b, visivel: false, avaliacao: 'rejeitada' }])).toHaveLength(1);
    expect(validarCamadaEditorialV2([a, { ...b, ancora: { ...b.ancora, bloco_id: id(2) } }])).toEqual([]);
    // Na V1 o mesmo par entre camadas diferentes seria conflito: a regra mudou só na V2.
    expect(validarCamadaEditorial([v1, { ...structuredClone(v1), id: id(51), execucao_id: id(41) }])).toHaveLength(1);
  });
  test('camada com versão ou modo misturados, marca inválida e id repetido são erro', () => {
    const a = marcaV1ParaV2(v1);
    const b: MarcaV2 = { ...structuredClone(a), id: id(51) };
    expect(() => validarCamadaEditorialV2([a, { ...b, modo: { id: 'filosofica', revisao: 1 } }])).toThrow();
    expect(() => validarCamadaEditorialV2([a, { ...b, ancora: { ...b.ancora, versao_id: id(21) } }])).toThrow();
    expect(() => validarCamadaEditorialV2([a, { ...b, camada_id: id(41) }])).toThrow();
    expect(() => validarCamadaEditorialV2([a, a])).toThrow();
    expect(hashMarcas([a])).toMatch(/^[0-9a-f]{64}$/);
  });
  test('função, comentário e saliência conferem com o modo e a execução', () => {
    const literaria = obterModo({ id: 'literaria', revisao: 1 });
    const argumentativa = obterModo(MODO_F1);
    const gerada = caso<MarcaGeradaV2>('MarcaGeradaV2', 'valido-comentario');
    expect(conferirMarcaNoModo(gerada, literaria)).toBe(true);
    expect(conferirMarcaNoModo(gerada, argumentativa)).toBe(false);
    expect(conferirMarcaNoModo({ ...gerada, funcao: 'nenhuma' }, argumentativa)).toBe(false);
    expect(conferirMarcaNoModo({ ...gerada, funcao: 'nenhuma', comentario: null }, argumentativa)).toBe(true);
    expect(conferirMarcaNoModo({ ...gerada, comentario: { tipo: 'OBJECAO', rotulo: '×', texto: 'x' } }, literaria)).toBe(false);
    const execucao = caso<ExecucaoLeituraV2>('ExecucaoLeituraV2', 'valido-cli');
    expect(conferirMarcaGeradaNaExecucao(gerada, execucao, literaria)).toBe(true);
    expect(conferirMarcaGeradaNaExecucao(gerada, { ...execucao, nivel_de_atencao_alvo: 2 }, literaria)).toBe(false);
    expect(conferirMarcaGeradaNaExecucao(gerada, execucao, argumentativa)).toBe(false);
    const persistida = caso<MarcaV2>('MarcaV2');
    const execucaoF1 = caso<ExecucaoLeituraV2>('ExecucaoLeituraV2');
    expect(conferirMarcaNoModo(persistida, argumentativa)).toBe(true);
    expect(conferirMarcaNoModo({ ...persistida, modo: { id: 'argumentativa', revisao: 2 } }, argumentativa)).toBe(false);
    expect(conferirMarcaV2NaExecucao(persistida, execucaoF1)).toBe(true);
    expect(conferirMarcaV2NaExecucao(persistida, { ...execucaoF1, modo: { id: 'literaria', revisao: 1 } })).toBe(false);
    expect(conferirMarcaV2NaExecucao(persistida, { ...execucaoF1, versao_id: id(21) })).toBe(false);
    expect(conferirMarcaV2NaExecucao(persistida, execucao)).toBe(false);
  });
  test('marca gerada V2 exige ocorrência única no bloco', () => {
    const gerada = caso<MarcaGeradaV2>('MarcaGeradaV2');
    const bloco = { id: gerada.bloco_id, texto: caso<CanonicoV1>('Canonico').blocos[0]!.texto };
    expect(conferirMarcaGeradaV2(bloco, gerada)).toBe(true);
    expect(conferirMarcaGeradaV2({ ...bloco, texto: `${bloco.texto} ${bloco.texto}` }, { ...gerada, prefixo: '', sufixo: '' })).toBe(false);
    expect(conferirMarcaGeradaV2({ ...bloco, id: id(2) }, gerada)).toBe(false);
  });
  test('validarPartes aceita a execução V2 e recusa V2 malformada', () => {
    const parte = caso<ParteV1>('Parte');
    const execucao = caso<ExecucaoLeituraV2>('ExecucaoLeituraV2');
    expect(validarPartes([parte], execucao, caso<CanonicoV1>('Canonico'))).toBe(true);
    expect(validarPartes([parte], { ...execucao, modelo: 'x' } as unknown as ExecucaoLeituraV2)).toBe(false);
    expect(validarPartes([parte], { ...execucao, plano_partes: [id(31)] })).toBe(false);
  });
});

describe('estrofe (CanonicoV1.1)', () => {
  const canonico = caso<CanonicoV1>('Canonico', 'valido-estrofe');
  test('versos separados por LF, projeção mantém as quebras internas', () => {
    expect(validarCanonico(canonico)).toBe(true);
    const estrofes = canonico.blocos.filter((bloco) => bloco.tipo === 'estrofe');
    expect(estrofes.some((bloco) => bloco.texto.includes('\n'))).toBe(true);
    expect(estrofes.some((bloco) => !bloco.texto.includes('\n'))).toBe(true); // um verso só também é estrofe
    const { raw_text, offsets } = projetarRawText(canonico.blocos);
    for (const bloco of estrofes) {
      const faixa = offsets[bloco.id]!;
      expect(raw_text.slice(faixa.inicio_utf16, faixa.fim_utf16)).toBe(bloco.texto);
      const versos = faixasDosVersos(bloco.texto);
      expect(versos.map((verso) => bloco.texto.slice(verso.inicio_utf16, verso.fim_utf16))).toEqual(bloco.texto.split('\n'));
    }
  });
  test('regras do verso', () => {
    expect(versosValidos('um\ndois')).toBe(true);
    expect(versosValidos('  recuado\ndois')).toBe(true);
    expect(versosValidos('\u0085\n\u001c')).toBe(true); // mesmos casos da ponte Python: o critério é o \s do JavaScript
    for (const texto of ['um\n\ufeff\ndois', 'um\n\u3000\ndois']) expect(versosValidos(texto)).toBe(false);
    for (const texto of ['', 'um\n', '\num', 'um\n\ndois', 'um\n \ndois', 'um\r\ndois', 'um\u2028dois', 'um\u2029dois']) expect(versosValidos(texto)).toBe(false);
    expect(() => faixasDosVersos('um\n')).toThrow();
    expect(faixasDosVersos('🧭\nd')).toEqual([{ inicio_utf16: 0, fim_utf16: 2 }, { inicio_utf16: 3, fim_utf16: 4 }]);
  });
  test('fora da estrofe o V1 continua como era: LF num parágrafo segue válido', () => {
    const c = caso<CanonicoV1>('Canonico');
    c.blocos[0]!.texto = 'linha\n\nsolta\n';
    c.hash_estrutural = hashEstrutural(c.blocos);
    expect(validarCanonico(c)).toBe(true);
    c.blocos[0]!.tipo = 'estrofe';
    c.hash_estrutural = hashEstrutural(c.blocos);
    expect(validarCanonico(c)).toBe(false);
  });
});

describe('anotação, conversa, resposta e conexão', () => {
  test('limite do texto da anotação é em UTF-16', () => {
    const anotacao = caso<AnotacaoV1>('Anotacao');
    expect(validarAnotacao({ ...anotacao, texto: 'a'.repeat(8000) })).toBe(true);
    expect(validarAnotacao({ ...anotacao, texto: '🧭'.repeat(4000) })).toBe(true);
    expect(validarAnotacao({ ...anotacao, texto: '🧭'.repeat(4000) + 'a' })).toBe(false);
  });
  test('localizarCitacao nunca escolhe a primeira de várias ocorrências', () => {
    const bloco = { texto: 'a b a b' };
    expect(localizarCitacao(bloco, 'a')).toEqual({ tipo: 'ambigua', ocorrencias: 2 });
    expect(localizarCitacao(bloco, 'a', 'b ')).toEqual({ tipo: 'unica', inicio_utf16: 4, fim_utf16: 5 });
    expect(localizarCitacao(bloco, 'c')).toEqual({ tipo: 'ausente' });
    expect(localizarCitacao(bloco, '')).toEqual({ tipo: 'ausente' });
  });
  test('resposta gerada: diagnóstico para bloco fora do contexto, citação ausente ou ambígua', () => {
    const resposta = caso<RespostaGeradaV1>('RespostaGerada', 'valido-completa');
    const blocos = [{ id: id(1), texto: 'Um 🧭 e outro 🧭' }, { id: id(2), texto: 'rumo ao sul' }];
    expect(diagnosticarRespostaGerada(resposta, blocos)).toEqual([
      { caminho: '/pontos/0/apoios/0', codigo: 'citacao_ambigua' },
      { caminho: '/sugestoes_de_conexao/0', codigo: 'citacao_ausente' },
    ]);
    expect(diagnosticarRespostaGerada(resposta, [{ id: id(1), texto: 'Um 🧭.' }, { id: id(2), texto: 'o norte' }])).toEqual([]);
    expect(diagnosticarRespostaGerada(resposta, [{ id: id(2), texto: 'o norte' }])).toEqual([{ caminho: '/pontos/0/apoios/0', codigo: 'bloco_fora_do_contexto' }]);
  });
  test('conversa: a IA só cita blocos do contexto quando o contexto existe', () => {
    const conversa = caso<Parameters<typeof validarConversa>[0]>('Conversa', 'valido-resposta');
    expect(validarConversa(conversa)).toBe(true);
  });
  test('conexão: só a sugestão da IA é decidida, uma única vez', () => {
    const sugerida = caso<ConexaoV1>('Conexao', 'valido-sugerida');
    const aceita = decidirConexao(sugerida, 'aceita', '2026-09-23T13:00:00Z');
    expect(aceita).toMatchObject({ estado: 'aceita', decidida_em: '2026-09-23T13:00:00Z' });
    expect(sugerida.estado).toBe('sugerida');
    expect(() => decidirConexao(aceita, 'rejeitada', '2026-09-23T14:00:00Z')).toThrow();
    expect(() => decidirConexao(sugerida, 'aceita', '2026-09-23T11:00:00Z')).toThrow();
    expect(() => decidirConexao(caso<ConexaoV1>('Conexao', 'valido-pedro'), 'rejeitada', '2026-09-23T13:00:00Z')).toThrow();
  });
  test.each(['nota.md', 'Zettel/Ideias sobre ç e ã.md', 'a/b/c.d.md', '.obsidian-nao/nota.md'])('caminho de nota aceito: %s', (caminho) => {
    const conexao = caso<ConexaoV1>('Conexao', 'valido-pedro');
    expect(validarConexao({ ...conexao, destino: { tipo: 'nota_externa', caminho, titulo: 'Nota' } })).toBe(true);
  });
  test.each(['./nota.md', '~/nota.md', 'a/./b.md', 'a/..', '..', 'nota.md/', 'a\u0000b.md', '.md/../x.md', 'C:\\nota.md'])('caminho de nota recusado: %s', (caminho) => {
    const conexao = caso<ConexaoV1>('Conexao', 'valido-pedro');
    expect(validarConexao({ ...conexao, destino: { tipo: 'nota_externa', caminho, titulo: 'Nota' } })).toBe(false);
  });
});
