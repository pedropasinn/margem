import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { validarIndiceObsidianV2, type ConexaoV3, type MarcaV2 } from '@margem/contratos';
import { indiceV2, INCLUIR_TUDO } from './dados-v2.js';
import { exportarParaObsidian, FIM_GERENCIADO, INICIO_GERENCIADO } from './exportar.js';
import {
  exportarParaObsidianV2, instanteLocal, markdownDoLeitor, nomeDaNota, nomeDaRelacao, type EntradaDaExportacaoV2, type NotaDoObsidianV2,
} from './exportar-v2.js';
import { IDS, entradaDeExemplo, entradaDeExemploV2 } from './fixture-de-exemplo.js';

const embaralhar = <T>(lista: readonly T[]): T[] => [...lista].reverse();
const nota = (notas: readonly NotaDoObsidianV2[], tipo: NotaDoObsidianV2['tipo'], id: string): NotaDoObsidianV2 => {
  const achada = notas.find((candidata) => candidata.tipo === tipo && candidata.id === id);
  if (!achada) throw new Error(`nota ${tipo} ${id} ausente`);
  return achada;
};
/** Valor de uma chave de primeiro nível do frontmatter (o texto depois de `chave: `). */
function campo(conteudo: string, chave: string): string | undefined {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(conteudo)?.[1] ?? '';
  return new RegExp(`^${chave}: (.*)$`, 'm').exec(frontmatter)?.[1];
}
const ID_DA_MARCA = (n: number) => entradaDeExemplo().marcas[n - 1]!.id;

describe('exportação para o Obsidian, formato 2', () => {
  test('ouro: a saída do exemplo, nota a nota', async () => {
    const { notas } = exportarParaObsidianV2(entradaDeExemploV2());
    const tudo = notas.map((n) => `<!-- ${n.caminho} -->\n${n.conteudo}`).join('\n');
    await expect(tudo).toMatchFileSnapshot('./__ouro__/exemplo-v2.md');
  });

  test('o exemplo versionado em integracoes/obsidian/exemplo/Margem é a saída atual (npm run exemplo-obsidian)', () => {
    for (const n of exportarParaObsidianV2(entradaDeExemploV2()).notas) {
      expect(readFileSync(new URL(`../../../integracoes/obsidian/exemplo/Margem/${n.caminho}`, import.meta.url), 'utf8')).toBe(n.conteudo);
    }
  });

  test('determinística: mesma entrada, mesmos bytes, qualquer que seja a ordem das listas', () => {
    const primeira = exportarParaObsidianV2(entradaDeExemploV2());
    expect(exportarParaObsidianV2(entradaDeExemploV2())).toEqual(primeira);
    const entrada = entradaDeExemploV2();
    const embaralhada: EntradaDaExportacaoV2 = {
      ...entrada, marcas: embaralhar(entrada.marcas), anotacoes: embaralhar(entrada.anotacoes), conversas: embaralhar(entrada.conversas),
      conexoes: embaralhar(entrada.conexoes), etiquetas: embaralhar(entrada.etiquetas), flashcards: embaralhar(entrada.flashcards),
      resolucoes: embaralhar(entrada.resolucoes), marcas_externas: embaralhar(entrada.marcas_externas),
    };
    expect(exportarParaObsidianV2(embaralhada)).toEqual(primeira);
  });

  test('uma pasta por documento: a nota-índice com o nome da V1 e uma nota por item, nas subpastas', () => {
    const { nome, notas, itens } = exportarParaObsidianV2(entradaDeExemploV2());
    expect(nome).toBe('Meditações - um ensaio sobre a dúvida');
    expect(notas[0]).toMatchObject({ tipo: 'documento', id: IDS.documento, caminho: `${nome}/${nome}.md` });
    const contagem = Object.fromEntries(['grifo', 'anotacao', 'pergunta', 'relacao', 'flashcard', 'exercicio']
      .map((tipo) => [tipo, notas.filter((n) => n.tipo === tipo).length]));
    // Quatro marcas (três com a nota do leitor dentro), uma nota antiga solta, uma pergunta, três relações com
    // origem aqui (a sugerida fica de fora, a que vem de outro documento mora lá).
    expect(contagem).toEqual({ grifo: 4, anotacao: 1, pergunta: 1, relacao: 3, flashcard: 1, exercicio: 1 });
    expect(itens).toBe(5);
    const pastas = new Set(notas.slice(1).map((n) => n.caminho.split('/')[1]));
    expect([...pastas].sort()).toEqual(['Anotações', 'Exercícios', 'Flashcards', 'Grifos', 'Perguntas', 'Relações']);
    expect(notas[0]!.conteudo).toContain('  notas: 3\n  anotacoes: 1\n');
    expect(notas[0]!.conteudo).toContain('  dificuldades: 5\n');
    // O índice das notas segue IndiceObsidianV2.
    const indice = indiceV2([exportarParaObsidianV2(entradaDeExemploV2())], { marcas: 'minhas', url_base: 'https://margem.exemplo.ts.net', incluir: INCLUIR_TUDO });
    expect(validarIndiceObsidianV2(indice), JSON.stringify(validarIndiceObsidianV2.errors)).toBe(true);
  });

  test('a nota-índice guarda todos os blocos ^margem-<id> da nota V1 (links antigos continuam valendo)', () => {
    const v1 = exportarParaObsidian(entradaDeExemplo()).conteudo;
    const indice = exportarParaObsidianV2(entradaDeExemploV2()).notas[0]!.conteudo;
    const blocos = (texto: string) => [...texto.matchAll(/\^margem-[a-z0-9-]+/g)].map((achado) => achado[0]).sort();
    expect(blocos(v1).length).toBeGreaterThan(5);
    expect(blocos(indice)).toEqual(expect.arrayContaining(blocos(v1)));
    // Cada linha com bloco aponta para a nota do item.
    expect(indice).toMatch(new RegExp(`- \\[\\[Tese — Toda certeza começa por uma suspeita · ${ID_DA_MARCA(1).slice(-6).toLowerCase()}\\|Tese — Toda certeza começa por uma suspeita\\]\\] · p\\. 111 \\^margem-${ID_DA_MARCA(1).toLowerCase()}`));
  });

  test('frontmatter: esquema 2, tipo, id estável, documento, autor, capítulo, página, posição, função, modo, cor e datas', () => {
    const { notas } = exportarParaObsidianV2(entradaDeExemploV2());
    for (const n of notas) {
      expect(campo(n.conteudo, 'margem_esquema')).toBe('2');
      expect(campo(n.conteudo, 'margem_tipo')).toBe(`"${n.tipo}"`);
      expect(campo(n.conteudo, 'margem_id')).toBe(`"${n.id}"`);
      expect(n.conteudo.split(INICIO_GERENCIADO)).toHaveLength(2);
      expect(n.conteudo.endsWith(`${FIM_GERENCIADO}\n`)).toBe(true);
    }
    const grifo = nota(notas, 'grifo', ID_DA_MARCA(1)).conteudo;
    expect(campo(grifo, 'margem_documento')).toBe('"[[Meditações - um ensaio sobre a dúvida]]"');
    expect(campo(grifo, 'documento')).toBe('"Meditações: um ensaio sobre a dúvida"');
    expect(campo(grifo, 'autor')).toBe('"René Descartes"');
    expect(campo(grifo, 'capitulo')).toBe('"I. Da dúvida"');
    expect(campo(grifo, 'pagina')).toBe('"111"');
    expect(campo(grifo, 'posicao')).toBe('[0, 36]');
    expect(campo(grifo, 'funcao')).toBe('"tese"');
    expect(campo(grifo, 'funcao_rotulo')).toBe('"Tese"');
    expect(campo(grifo, 'modo')).toBe('"filosofica@1"');
    expect(campo(grifo, 'cor')).toBe('"#E8B04B"');
    expect(campo(grifo, 'autoria')).toBe('"ia"');
    expect(campo(grifo, 'criado')).toBe('2026-09-20T10:00:00-03:00');
    // Etiqueta livre em margem/etiqueta/, dificuldade em margem/dificuldade/.
    expect(grifo).toContain('  - "margem/etiqueta/para_a_tese"');
    expect(nota(notas, 'grifo', ID_DA_MARCA(2)).conteudo).toContain('  - "margem/dificuldade/premissa_implicita"');
  });

  test('modelo D: a nota do leitor mora na nota do grifo, sem tipo; o ^margem-<id> dela continua na nota-índice', () => {
    const entrada = entradaDeExemploV2();
    const { notas } = exportarParaObsidianV2(entrada);
    const [n1, n2, n3, n4] = entrada.anotacoes;
    // Nenhuma nota própria para as notas de grifo: só a antiga, solta, vai para Anotações/.
    expect(notas.filter((n) => n.tipo === 'anotacao').map((n) => n.id)).toEqual([n2!.id]);
    for (const n of [n1!, n3!, n4!]) expect(notas.some((outra) => outra.id === n.id)).toBe(false);
    const tese = nota(notas, 'grifo', ID_DA_MARCA(1));
    expect(tese.conteudo).toContain('## Sua nota\n\nParece Agostinho antes de Descartes');
    expect(campo(tese.conteudo, 'nota_do_leitor')).toBe('true');
    expect(tese.conteudo).not.toMatch(/anotacao_tipo|margem\/anotacao|Impressão/);
    // O comentário do Codex continua, numa seção dele, separado da nota do leitor.
    expect(tese.conteudo).toContain('## Comentário do Codex\n\n*Leitura — ponto de partida:* A dúvida é método');
    // A fonte: sem os campos de fonte (a referência já está no texto, como a migração a deixou).
    const argumento = nota(notas, 'grifo', ID_DA_MARCA(4)).conteudo;
    expect(argumento).toContain('## Sua nota\n\nRegra 2 do Discurso.\n\nFonte: Discurso do método');
    expect(argumento).not.toMatch(/fonte_titulo|anotacao_tipo/);
    // O leitor anotou um grifo do Codex: a nota vai para ele, com a revisão do Codex sinalizada.
    const objecao = nota(notas, 'grifo', ID_DA_MARCA(2)).conteudo;
    expect(objecao).toContain('## Sua nota\n\nÉ o círculo: a razão julga a razão.\n\n*(revista pelo Codex)*');
    expect(campo(objecao, 'nota_revisada_pelo_codex')).toBe('true');
    // Na nota-índice, a linha da nota leva o bloco dela e aponta para a seção do grifo.
    const indice = notas[0]!.conteudo;
    const nomeDaTese = tese.caminho.split('/').at(-1)!.slice(0, -3);
    expect(indice).toContain(`\t- Sua nota: [[${nomeDaTese}#Sua nota|Parece Agostinho`);
    expect(indice).toMatch(new RegExp(`\\t- Sua nota: .*\\^margem-${n1!.id.toLowerCase()}$`, 'm'));
    // A pergunta ligada a uma nota de grifo aponta para a seção dele.
    expect(notas.find((n) => n.tipo === 'pergunta')!.conteudo).not.toContain('anotacao:');
  });

  test('modelo D: a nota antiga, solta, fica em Anotações/, rotulada e com o tipo que tinha', () => {
    const entrada = entradaDeExemploV2();
    const { notas } = exportarParaObsidianV2(entrada);
    const antiga = nota(notas, 'anotacao', entrada.anotacoes[1]!.id).conteudo;
    expect(campo(antiga, 'nota_antiga')).toBe('true');
    expect(campo(antiga, 'anotacao_tipo')).toBe('"duvida"');
    expect(antiga).toContain('  - "margem/nota_antiga"');
    expect(antiga).toContain('**Nota antiga** · Dúvida.');
    expect(notas[0]!.conteudo).toMatch(new RegExp(`\\t- Nota antiga: .*\\^margem-${entrada.anotacoes[1]!.id.toLowerCase()}$`, 'm'));
    // A etiqueta "?" antiga da nota virou sinal: nada de tag de dificuldade vinda da etiqueta.
    expect(antiga).not.toContain('margem/dificuldade');
    expect(antiga).not.toContain('etiquetas:');
  });

  test('modelo D: a nota de um grifo que não foi exportado não se perde (nota própria, sem tipo)', () => {
    const entrada = entradaDeExemploV2();
    const semATese = exportarParaObsidianV2({ ...entrada, marcas: entrada.marcas.filter((m) => m.id !== ID_DA_MARCA(1)) });
    const n1 = nota(semATese.notas, 'anotacao', entrada.anotacoes[0]!.id).conteudo;
    expect(n1).toContain('## Sua nota\n\nParece Agostinho');
    expect(n1).not.toMatch(/nota_antiga|anotacao_tipo/);
    expect(semATese.notas[0]!.conteudo).toMatch(new RegExp(`\\t- Nota: .*\\^margem-${entrada.anotacoes[0]!.id.toLowerCase()}$`, 'm'));
  });

  test('dificuldades: sinais não descartados, na nota-índice e na nota do grifo; tag vem do sinal, não da etiqueta', () => {
    const entrada = entradaDeExemploV2();
    const { notas } = exportarParaObsidianV2(entrada);
    const indice = notas[0]!.conteudo;
    const secao = indice.slice(indice.indexOf('## Dificuldades'), indice.indexOf('## Flashcards'));
    expect(secao.split('\n').filter((linha) => linha.startsWith('- '))).toHaveLength(5);
    expect(secao).not.toContain('Descartada pelo leitor');
    expect(secao).toContain('**Conceito sem definição** · «resiste a um exame de 100% das razões»');
    expect(secao).toContain('sugerida pelo Codex — *Codex:* "Exame" aqui é técnico.');
    expect(secao).toContain('**Dificuldade** · «Ó mar salgado');
    // Na nota do grifo: categoria, origem, descrição do Codex; o trecho só quando não é o do grifo.
    const argumento = nota(notas, 'grifo', ID_DA_MARCA(4)).conteudo;
    expect(argumento).toContain('- **Salto no argumento** · «tantas parcelas quantas for possível» · do Codex, confirmada por você — *Codex:* Não diz');
    expect(argumento).toContain('dificuldade:\n  - "salto_argumentativo"');
    expect(nota(notas, 'grifo', ID_DA_MARCA(2)).conteudo).toContain('- **Premissa implícita** · marcada por você');
    const imagem = nota(notas, 'grifo', ID_DA_MARCA(3)).conteudo;
    expect(imagem).toContain('  - "margem/dificuldade"\n');
    expect(imagem).toContain('dificuldade:\n  - "sem_categoria"');
    // A descartada (na tese) não marca o grifo.
    expect(nota(notas, 'grifo', ID_DA_MARCA(1)).conteudo).not.toMatch(/^dificuldade:|## Dificuldades|margem\/dificuldade/m);
    // Sem o sinal, a etiqueta "?" antiga não vira tag.
    const semSinais = exportarParaObsidianV2({ ...entrada, dificuldades: [] });
    expect(nota(semSinais.notas, 'grifo', ID_DA_MARCA(2)).conteudo).not.toContain('margem/dificuldade');
  });

  test('o rótulo e a cor da função vêm do modo de cada grifo, mesmo com dois modos no documento', () => {
    const { notas } = exportarParaObsidianV2(entradaDeExemploV2());
    const imagem = nota(notas, 'grifo', ID_DA_MARCA(3)).conteudo;
    expect(campo(imagem, 'modo')).toBe('"literaria@1"');
    expect(campo(imagem, 'funcao_rotulo')).toBe('"Imagem"');
    expect(campo(nota(notas, 'grifo', ID_DA_MARCA(1)).conteudo, 'modo')).toBe('"filosofica@1"');
  });

  test('a relação leva os dois trechos inteiros e links para as notas das duas pontas, com o tipo fino', () => {
    const entrada = entradaDeExemploV2();
    const { notas } = exportarParaObsidianV2(entrada);
    const conexao = entrada.conexoes.find((c) => c.relacao_semantica === 'pressupoe')!;
    const relacao = nota(notas, 'relacao', conexao.id).conteudo;
    const nomeDaOrigem = nota(notas, 'grifo', ID_DA_MARCA(4)).caminho.split('/').at(-1)!.slice(0, -3);
    const nomeDoDestino = nota(notas, 'grifo', ID_DA_MARCA(1)).caminho.split('/').at(-1)!.slice(0, -3);
    expect(campo(relacao, 'origem')).toBe(`"[[${nomeDaOrigem}]]"`);
    expect(campo(relacao, 'destino')).toBe(`"[[${nomeDoDestino}]]"`);
    expect(campo(relacao, 'relacao')).toBe('"prerequisito"');
    expect(campo(relacao, 'relacao_semantica')).toBe('"pressupoe"');
    expect(relacao).toContain('> Dividir cada dificuldade em tantas parcelas quantas for possível\n^origem');
    expect(relacao).toContain('> Toda certeza começa por uma suspeita\n^destino');
    expect(relacao).toContain('**Pré-requisito** (pressupõe)');
    expect(relacao).toContain('O método supõe a dúvida.');
  });

  test('cada grifo lista as relações em que é origem ou destino, inclusive as que vêm de outro documento', () => {
    const entrada = entradaDeExemploV2();
    const { notas } = exportarParaObsidianV2(entrada);
    const nomeDe = (c: ConexaoV3) => nomeDaRelacao(c, entrada.destinos);
    const tese = nota(notas, 'grifo', ID_DA_MARCA(1)).conteudo;
    expect(tese).toContain(`- → [[${nomeDe(entrada.conexoes[0]!)}|`);
    expect(tese).toContain(`- ← [[${nomeDe(entrada.conexoes[1]!)}|`);
    const objecao = nota(notas, 'grifo', ID_DA_MARCA(2)).conteudo;
    const deFora = entrada.conexoes.find((c) => c.origem.versao_id === IDS.outraVersao)!;
    expect(objecao).toContain(`- ← [[${nomeDe(deFora)}|Tensão: «Que sei eu? A razão é um instrumento dúctil»]]`);
    // A sugerida (não aceita) não entra em lugar nenhum.
    const sugerida = entrada.conexoes.find((c) => c.estado === 'sugerida')!;
    expect(notas.some((n) => n.id === sugerida.id)).toBe(false);
    expect(notas.some((n) => n.conteudo.includes(nomeDe(sugerida)))).toBe(false);
  });

  test('o texto do leitor sai como Markdown (ênfase, listas, links); a citação do livro continua escapada', () => {
    const { notas } = exportarParaObsidianV2(entradaDeExemploV2());
    const impressao = nota(notas, 'grifo', ID_DA_MARCA(1)).conteudo;
    expect(impressao).toContain('Parece Agostinho antes de Descartes: *si fallor, sum*.\n\n# isto não é título\n- nem lista');
    expect(impressao).toContain('> Toda certeza começa por uma suspeita\n^trecho');
    const objecao = nota(notas, 'grifo', ID_DA_MARCA(2)).conteudo;
    expect(objecao).toContain('O cético responde que \\[\\[a razão\\]\\] não pode julgar a si mesma');
    const cartao = notas.find((n) => n.tipo === 'flashcard')!.conteudo;
    expect(cartao).toContain('Qual é a **segunda** regra do método?\n?\nDividir cada dificuldade em parcelas.');
  });

  test('markdownDoLeitor escapa só o que quebraria a nota', () => {
    expect(markdownDoLeitor('*ênfase*, [link](https://x.org) e\n- lista')).toBe('*ênfase*, [link](https://x.org) e\n- lista');
    expect(markdownDoLeitor('abre %% comentário')).toBe('abre \\%\\% comentário');
    expect(markdownDoLeitor('fim de bloco ^trecho')).toBe('fim de bloco \\^trecho');
    expect(markdownDoLeitor('```js\nconst x = 1;')).toBe('```js\nconst x = 1;\n```');
    expect(markdownDoLeitor('```\nfechado\n```')).toBe('```\nfechado\n```');
    expect(markdownDoLeitor('<!-- sem fim')).toBe('&lt;!-- sem fim');
    expect(markdownDoLeitor('linha\r\noutra  \n\n')).toBe('linha\noutra');
  });

  test('nomes determinísticos, legíveis e com o fim do id; datas no fuso do leitor', () => {
    expect(nomeDaNota('Toda certeza começa por uma suspeita: nada do que aprendi resiste a um exame de todas as razões', '01KM0000000000000000ABCDEF', 'Grifo'))
      .toBe('Toda certeza começa por uma suspeita - nada do que aprendi… · abcdef');
    expect(nomeDaNota('   ', '01KM0000000000000000ABCDEF', 'Grifo')).toBe('Grifo · abcdef');
    expect(nomeDaNota('a/b\\c:d*e?f"g<h>i|j#k^l[m]', '01KM0000000000000000ABCDEF', 'Grifo')).not.toMatch(/[\\/:*?"<>|#^[\]]/);
    expect(instanteLocal('2026-09-19T23:30:00.000Z')).toBe('2026-09-19T20:30:00-03:00');
  });

  test('sem nada do leitor, só a nota-índice, com o aviso', () => {
    const entrada = entradaDeExemploV2();
    const vazia = exportarParaObsidianV2({ ...entrada, marcas: [], anotacoes: [], conversas: [], conexoes: [], flashcards: [], resolucoes: [], dificuldades: [] });
    expect(vazia.notas).toHaveLength(1);
    expect(vazia.notas[0]!.conteudo).toContain('*Nenhuma marca, nota ou pergunta neste documento ainda.*');
  });

  test('1 000 itens em menos de um segundo', () => {
    const entrada = entradaDeExemploV2();
    const base = entrada.marcas[0]!;
    const marcas: MarcaV2[] = Array.from({ length: 1000 }, (_, i) => ({
      ...base, id: `01KM${String(i).padStart(21, '0')}0`, ancora: { ...base.ancora, inicio_utf16: i % 30, fim_utf16: (i % 30) + 5,
        citacao: base.ancora.citacao.slice(i % 30, (i % 30) + 5) },
    }));
    const inicio = performance.now();
    const { notas } = exportarParaObsidianV2({ ...entrada, marcas });
    expect(performance.now() - inicio).toBeLessThan(1000);
    expect(notas.filter((n) => n.tipo === 'grifo')).toHaveLength(1000);
  });
});
