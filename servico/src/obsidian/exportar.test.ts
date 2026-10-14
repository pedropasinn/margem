import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ConversaV2 } from '@margem/contratos';
import {
  FIM_GERENCIADO, INICIO_GERENCIADO, escaparMarkdown, exportarParaObsidian, nomeDoArquivo, type EntradaDaExportacao,
} from './exportar.js';
import { IDS, entradaDeExemplo } from './fixture-de-exemplo.js';

function embaralhar<T>(lista: readonly T[]): T[] {
  return [...lista].reverse();
}

/** Frontmatter: as linhas entre os `---`, como pares chave → valor (lista para `tags`). */
function lerFrontmatter(conteudo: string): Record<string, string | string[]> {
  const achado = /^---\n([\s\S]*?)\n---\n/.exec(conteudo);
  if (!achado?.[1]) throw new Error('sem frontmatter');
  const resultado: Record<string, string | string[]> = {};
  let lista: string[] | null = null;
  for (const linha of achado[1].split('\n')) {
    const item = /^ {2}- (.+)$/.exec(linha);
    if (item?.[1] && lista) { lista.push(item[1]); continue; }
    const par = /^([a-z_]+):(?: (.*))?$/.exec(linha);
    if (!par?.[1]) throw new Error(`linha de YAML inesperada: ${linha}`);
    const valor = par[2];
    if (valor === undefined) { lista = []; resultado[par[1]] = lista; continue; }
    lista = null;
    // Escalar entre aspas: JSON é um subconjunto do YAML de aspas duplas.
    resultado[par[1]] = valor.startsWith('"') ? JSON.parse(valor) as string : valor;
  }
  return resultado;
}

describe('exportação para o Obsidian', () => {
  test('determinística e idempotente: mesma entrada, mesmos bytes, qualquer que seja a ordem das listas', () => {
    const primeira = exportarParaObsidian(entradaDeExemplo());
    expect(exportarParaObsidian(entradaDeExemplo())).toEqual(primeira);
    const entrada = entradaDeExemplo();
    const embaralhada: EntradaDaExportacao = {
      ...entrada,
      marcas: embaralhar(entrada.marcas), anotacoes: embaralhar(entrada.anotacoes), conversas: embaralhar(entrada.conversas),
      conexoes: embaralhar(entrada.conexoes), etiquetas: embaralhar(entrada.etiquetas),
    };
    expect(exportarParaObsidian(embaralhada).conteudo).toBe(primeira.conteudo);
  });

  test('frontmatter válido, com título, autor, fonte, id do documento, datas no fuso do leitor e a tag margem', () => {
    const { conteudo, arquivo, atualizado_em } = exportarParaObsidian(entradaDeExemplo());
    expect(lerFrontmatter(conteudo)).toEqual({
      titulo: 'Meditações: um ensaio sobre a dúvida', autor: 'René Descartes',
      fonte: `https://margem.exemplo.ts.net/documentos/${IDS.documento}`, formato: 'pdf',
      margem_id: IDS.documento, margem_versao: IDS.versao, margem_url: `https://margem.exemplo.ts.net/documentos/${IDS.documento}`,
      // 23h30 UTC de 19/09 ainda é 19/09 em Brasília; a nota mais recente é de 23/09.
      data: '2026-09-19', atualizado: '2026-09-23', tags: ['margem'],
    });
    expect(arquivo).toBe('Meditações - um ensaio sobre a dúvida.md');
    expect(atualizado_em).toBe('2026-09-23T09:15:00.000Z');
  });

  test('título com aspas, barra invertida e quebra de linha continua YAML de uma linha só', () => {
    const entrada = entradaDeExemplo();
    const titulo = 'O "eu"\\penso\nlogo: existo';
    const { conteudo } = exportarParaObsidian({ ...entrada, documento: { ...entrada.documento, titulo, autor: null } });
    const frontmatter = lerFrontmatter(conteudo);
    expect(frontmatter.titulo).toBe(titulo);
    expect(frontmatter).not.toHaveProperty('autor');
    expect(conteudo).toContain('\n# O "eu"\\\\penso logo: existo\n');
  });

  test('o corpo gerado fica entre os marcadores, e o arquivo termina com uma quebra de linha', () => {
    const { conteudo } = exportarParaObsidian(entradaDeExemplo());
    const inicio = conteudo.indexOf(INICIO_GERENCIADO);
    const fim = conteudo.indexOf(FIM_GERENCIADO);
    expect(inicio).toBeGreaterThan(conteudo.indexOf('\n---\n'));
    expect(fim).toBeGreaterThan(inicio);
    expect(conteudo.endsWith(`${FIM_GERENCIADO}\n`)).toBe(true);
    expect(conteudo.split(INICIO_GERENCIADO)).toHaveLength(2);
  });

  test('uma seção por capítulo, na ordem do texto, e os trechos em ordem de posição', () => {
    const { conteudo } = exportarParaObsidian(entradaDeExemplo());
    const titulos = [...conteudo.matchAll(/^## (.+)$/gm)].map((linha) => linha[1]);
    expect(titulos).toEqual(['I. Da dúvida', 'II. Do método']);
    const posicoes = ['Toda certeza', 'O cético', '\\$x = y\\$', 'Ó mar salgado', 'Dividir cada'].map((trecho) => conteudo.indexOf(`> ${trecho}`));
    expect(posicoes.every((posicao) => posicao > 0)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });

  test('cada marca vira callout com a função (tipo e tag), página, link de volta e bloco ^margem estável', () => {
    const { conteudo } = exportarParaObsidian(entradaDeExemplo());
    expect(conteudo).toContain(`> [!important] Tese · p. 111 · [abrir no Margem](https://margem.exemplo.ts.net/ler/${IDS.documento}/01KS0000000000000000000010?bloco=01KB0000000000000000000020)\n> Toda certeza começa por uma suspeita\n`);
    expect(conteudo).toContain('> [!warning] Objeção · p. 112');
    expect(conteudo).toContain('> #margem/objecao #margem/ia #margem/dificuldade/premissa_implicita\n\n^margem-01km0000000000000000000020\n');
    // Grifo do leitor: sem a tag da IA.
    expect(conteudo).toContain('> #margem/imagem\n\n^margem-01km0000000000000000000030');
    expect(conteudo).toContain('> *Leitura — ponto de partida:* A dúvida é método, não conclusão.\n> Ver o capítulo II.\n');
    // Ids de bloco do Obsidian (as definições, no fim da linha): só letras minúsculas, números e hífens, e nenhum repetido.
    const ids = [...conteudo.matchAll(/(?:^| )\^(margem-\S+)$/gm)].map((achado) => achado[1]);
    expect(ids).toHaveLength(9);
    expect(ids.every((bloco) => /^margem-[a-z0-9-]+$/.test(bloco ?? ''))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('trecho com quebras de linha: cada verso numa linha da citação, sem virar citação aninhada', () => {
    const { conteudo } = exportarParaObsidian(entradaDeExemplo());
    expect(conteudo).toContain('> [!quote] Imagem · p. 113');
    expect(conteudo).toContain('> Ó mar salgado, quanto do teu sal\n> São lágrimas de Portugal!\n> \\> Por te cruzarmos\n');
  });

  test('a nota do leitor vem logo abaixo do trecho, escapada, com o tipo e o bloco no fim', () => {
    const { conteudo } = exportarParaObsidian(entradaDeExemplo());
    expect(conteudo).toContain('^margem-01km0000000000000000000010\n\n**Impressão.** Parece Agostinho antes de Descartes: \\*si fallor, sum\\*.\n\n\\# isto não é título\n\\- nem lista ^margem-01kn0000000000000000000010\n');
    // Nota sem marca: abre um trecho próprio, com bloco diferente do da nota.
    expect(conteudo).toContain('> \\$x = y\\$\n\n^margem-trecho-01kn0000000000000000000020\n\n**Dúvida.** Que regras? As da lógica ou as da linguagem? #margem/dificuldade/ambiguidade ^margem-01kn0000000000000000000020\n');
    expect(conteudo).toContain('**Fonte.** Regra 2 do Discurso.\n— [Discurso do método](https://exemplo.org/discurso), p. 47 ^margem-01kn0000000000000000000030');
  });

  test('perguntas e respostas em callout recolhível, todas as mensagens na ordem', () => {
    const { conteudo } = exportarParaObsidian(entradaDeExemplo());
    expect(conteudo).toContain([
      '> [!question]- Essa objeção é a do círculo cartesiano? Quem a formulou primeiro?',
      '> **Pergunta:** Essa objeção é a do círculo cartesiano? Quem a formulou primeiro?',
      '>',
      '> **Resposta:** Em parte. O "círculo" é de Arnauld (Quartas Objeções):',
      '> provar Deus pela clareza e a clareza por Deus.',
      '>',
      '> **Pergunta:** E o cético pirrônico?',
      '>',
      '> **Resposta:** Ele suspende o juízo; não afirma que a razão \\*não pode\\*.',
      '',
      '^margem-01kq0000000000000000000010',
    ].join('\n'));
  });

  test('título de pergunta longa é cortado numa linha só', () => {
    const entrada = entradaDeExemplo();
    const longa = `${'palavra '.repeat(30)}\nsegunda linha`;
    const conversa = entrada.conversas[0]!;
    const trocada: ConversaV2 = { ...conversa, mensagens: [{ ...conversa.mensagens[0]!, autor: 'leitor', texto: longa }] };
    const { conteudo } = exportarParaObsidian({ ...entrada, conversas: [trocada] });
    const titulo = /^> \[!question\]- (.+)$/m.exec(conteudo)?.[1] ?? '';
    expect(Array.from(titulo)).toHaveLength(90);
    expect(titulo.endsWith('…')).toBe(true);
  });

  test('conexões aceitas: nota do vault vira wikilink, trecho do mesmo documento vira link de bloco; sugestões ficam de fora', () => {
    const { conteudo } = exportarParaObsidian(entradaDeExemplo());
    expect(conteudo).toContain('- *Desenvolve:* [[Zettel/202609201400 Dúvida metódica|Dúvida metódica]] — Minha nota permanente sobre o tema.');
    expect(conteudo).toContain('- *Pré-requisito:* [[#^margem-01km0000000000000000000010|«Toda certeza começa por uma suspeita»]] — O método supõe a dúvida.');
    expect(conteudo).toContain('- *Semelhança:* [[Ensaios Livro I]]');
    expect(conteudo).not.toContain('Montaigne');
  });

  test('o exemplo versionado em integracoes/obsidian/exemplo é a saída atual (npm run exemplo-obsidian)', () => {
    const nota = exportarParaObsidian(entradaDeExemplo());
    const versionado = readFileSync(new URL(`../../../integracoes/obsidian/exemplo/${nota.arquivo}`, import.meta.url), 'utf8');
    expect(versionado).toBe(nota.conteudo);
  });

  test('documento sem nada exportável ainda gera nota válida', () => {
    const entrada = entradaDeExemplo();
    const nota = exportarParaObsidian({ ...entrada, marcas: [], anotacoes: [], conversas: [], conexoes: [], etiquetas: [] });
    expect(nota.itens).toBe(0);
    expect(nota.atualizado_em).toBe(entrada.documento.criado_em);
    expect(nota.conteudo).toContain('*Nenhuma marca, nota ou pergunta neste documento ainda.*');
  });
});

describe('escape de Markdown', () => {
  test.each([
    ['*ênfase* e _itálico_', '\\*ênfase\\* e \\_itálico\\_'],
    ['[[wikilink]] e [link](x)', '\\[\\[wikilink\\]\\] e \\[link\\](x)'],
    ['#tag no meio', '\\#tag no meio'],
    ['custa $5 e $6', 'custa \\$5 e \\$6'],
    ['os ==destaque== e %%comentário%%', 'os =\\=destaque=\\= e %\\%comentário%\\%'],
    ['~~riscado~~', '~\\~riscado~\\~'],
    ['<script>alert(1)</script>', '\\<script>alert(1)\\</script>'],
    ['`código`', '\\`código\\`'],
    ['a | b', 'a \\| b'],
    ['fim ^bloco', 'fim \\^bloco'],
    ['> citação', '\\> citação'],
    ['- lista', '\\- lista'],
    ['+ lista', '\\+ lista'],
    ['12. numerada', '12\\. numerada'],
    ['3) também', '3\\) também'],
    ['===', '\\=\\=\\='],
    ['x %%% y', 'x %\\%\\% y'],
    ['    código indentado', 'código indentado'],
    ['barra \\ invertida', 'barra \\\\ invertida'],
    ['1999 foi um ano', '1999 foi um ano'],
  ])('%s', (entrada, esperado) => {
    expect(escaparMarkdown(entrada)).toBe(esperado);
  });

  test('preserva as quebras de linha e normaliza CRLF', () => {
    expect(escaparMarkdown('um\r\ndois\rtrês\n\nquatro')).toBe('um\ndois\ntrês\n\nquatro');
  });
});

describe('nome do arquivo', () => {
  test.each([
    ['Meditações: um ensaio', 'Meditações - um ensaio.md'],
    ['A/B "teste" <x>?', 'A B teste x.md'],
    ['  ...oculto', 'oculto.md'],
    ['[[Link]] #tag ^bloco | pipe', 'Link tag bloco pipe.md'],
    ['', 'Documento 01KD0000000000000000000010.md'],
    // J114: o que o Windows recusa além dos caracteres: fim em ponto/espaço e nomes de dispositivo.
    ['Reticências...', 'Reticências.md'],
    ['CON', 'CON (documento).md'],
    ['com1', 'com1 (documento).md'],
    ['Console', 'Console.md'],
  ])('%s', (titulo, esperado) => {
    expect(nomeDoArquivo(titulo, IDS.documento)).toBe(esperado);
  });

  test('limita a 200 caracteres sem partir um emoji', () => {
    const nome = nomeDoArquivo('🧭'.repeat(250), IDS.documento);
    expect(Array.from(nome.slice(0, -3))).toHaveLength(200);
    expect(nome.slice(0, -3)).toBe('🧭'.repeat(200));
  });
});
