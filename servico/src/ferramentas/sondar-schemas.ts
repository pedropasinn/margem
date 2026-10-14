/**
 * Sonda dos schemas de saída (V-W3, auditoria B-01).
 *
 *   npm run sondar-schemas              confere todos os prompts/*.schema.json, já saneados como vão
 *                                       para a CLI, contra as regras do modo estrito (sem rede)
 *   npm run sondar-schemas -- --real    além disso, manda cada um ao `codex exec` de verdade com um
 *                                       prompt trivial e diz se a API aceitou o formato (gasta cota;
 *                                       rodar a cada troca de versão da CLI ou do modelo da conta)
 *
 * Sai com código 1 se algum schema violar o modo estrito (ou, com --real, for recusado pela API).
 * O teste `sondar-schemas.test.ts` roda a parte sem rede em toda suíte.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { raizDoRepositorio } from '../dados.js';
import { sanearSchemaParaOCodex } from '../executor/artefato.js';
import { conferirModoEstrito, type Violacao } from '../executor/modo-estrito.js';
import type { Executor } from '../executor/tipos.js';

export interface ResultadoDaSonda {
  arquivo: string;
  violacoes: Violacao[];
  /** Só com `--real`: a API aceitou o formato? (`null` quando não foi testado.) */
  real?: { aceito: boolean; detalhe: string } | null;
}

export async function schemasDosPrompts(raiz = raizDoRepositorio()): Promise<string[]> {
  const pasta = join(raiz, 'prompts');
  return (await readdir(pasta)).filter((nome) => nome.endsWith('.schema.json')).sort().map((nome) => join(pasta, nome));
}

/** Confere cada schema saneado contra o modo estrito, sem rede. */
export async function sondarSchemas(arquivos: readonly string[]): Promise<ResultadoDaSonda[]> {
  const resultados: ResultadoDaSonda[] = [];
  for (const arquivo of arquivos) {
    let violacoes: Violacao[];
    try {
      violacoes = conferirModoEstrito(sanearSchemaParaOCodex(JSON.parse(await readFile(arquivo, 'utf8')) as unknown));
    } catch (erro) {
      violacoes = [{ caminho: '/', regra: `JSON ilegível: ${erro instanceof Error ? erro.message : String(erro)}` }];
    }
    resultados.push({ arquivo, violacoes });
  }
  return resultados;
}

const PROMPT_DA_SONDA = 'Teste de formato. Responda só com o menor JSON válido para o schema pedido, com textos curtos e listas vazias quando puder.';

/**
 * Manda o schema à CLI real. O que importa é a API aceitar o formato: resposta fora do schema ainda
 * conta como aceito; recusa é a CLI sair com erro antes de responder (ex.: `invalid_json_schema`).
 */
export async function sondarDeVerdade(arquivo: string, executor: Executor): Promise<{ aceito: boolean; detalhe: string }> {
  const entrada = await mkdtemp(join(tmpdir(), 'margem-sonda-'));
  try {
    await writeFile(join(entrada, 'LEIA-ME.md'), 'Sonda de schema do Margem: não há nada para ler.\n');
    const resultado = await executor({ diretorioEntrada: entrada, prompt: PROMPT_DA_SONDA, schema: arquivo, prazoMs: 300_000, esforco: 'low' });
    if (resultado.estado === 'ok') return { aceito: true, detalhe: `ok (${resultado.modelo})` };
    if (resultado.estado === 'adiado') return { aceito: false, detalhe: `adiado: ${resultado.mensagem}` };
    if (resultado.codigo === 'schema' || resultado.codigo === 'json_invalido') return { aceito: true, detalhe: `aceito, resposta fora do schema: ${resultado.mensagem}` };
    const causa = resultado.detalhe?.stderr_resumo.split('\n').filter((linha) => /error/iu.test(linha)).at(-1) ?? resultado.mensagem;
    return { aceito: false, detalhe: `${resultado.codigo}: ${causa}` };
  } finally {
    await rm(entrada, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const real = process.argv.includes('--real');
  const arquivos = await schemasDosPrompts();
  const resultados = await sondarSchemas(arquivos);
  let executor: Executor | null = null;
  if (real) {
    const { escolherExecutor } = await import('../worker/configuracao.js');
    executor = await escolherExecutor();
  }
  let falhas = 0;
  for (const resultado of resultados) {
    const nome = resultado.arquivo.split(/[\\/]/u).at(-1) ?? resultado.arquivo;
    if (executor !== null && resultado.violacoes.length === 0) resultado.real = await sondarDeVerdade(resultado.arquivo, executor);
    const recusado = resultado.real?.aceito === false;
    if (resultado.violacoes.length > 0 || recusado) falhas += 1;
    console.log(`${resultado.violacoes.length === 0 && !recusado ? 'ok    ' : 'FALHOU'} ${nome}${resultado.real ? ` · API: ${resultado.real.detalhe}` : ''}`);
    for (const violacao of resultado.violacoes) console.log(`         ${violacao.caminho}: ${violacao.regra}`);
  }
  console.log(`\n${String(resultados.length)} schemas, ${String(falhas)} com problema${real ? '' : ' (sem --real: só as regras, sem chamar a API)'}.`);
  return falhas === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main();
