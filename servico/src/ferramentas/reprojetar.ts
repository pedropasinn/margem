/**
 * Reprojeção offline da bancada-50 (J76): reaplica `projetarMarcas` — o código real do serviço — sobre os
 * modelos do capítulo já coletados em `avaliacao/bancada-50/entregue/<id>.json`, sem Codex e sem banco.
 *
 *   node --import tsx servico/src/ferramentas/reprojetar.ts --saida <pasta> [--variante <nome>] [--entrada <pasta>] [T01 T02 …]
 *   node --import tsx servico/src/ferramentas/reprojetar.ts --conferir      # sanidade: `atual` reproduz as marcas entregues?
 *
 * Grava `<saida>/<id>.json` com a mesma forma de `entregue/` (as marcas da compreensão trocadas pelas
 * reprojetadas; o modelo com as retrospectivas derivadas quando a variante as liga), para o
 * `comparar.py --entregue <saida>` medir em cima. Variantes: `VARIANTES_DA_PROJECAO` em `projecao.ts`.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { MarcaV2, ModeloDoCapituloV1, PlanoPedagogicoV1 } from '@margem/contratos';
import { obterModo } from '@margem/contratos';
import {
  derivarRetrospectivas, projetarMarcas, PROJECAO_ORIGINAL, VARIANTES_DA_PROJECAO, type OpcoesDaProjecao,
} from '../compreensao/projecao.js';

interface Entregue {
  id: string;
  blocos?: { id: string; tipo: string; texto: string }[];
  marcas_compreensao?: MarcaV2[];
  compreensao?: { estado: string | null; modelo: ModeloDoCapituloV1 | null; plano: PlanoPedagogicoV1 | null };
  [outro: string]: unknown;
}

interface Argumentos { entrada: string; saida: string; variante: string; ids: string[]; conferir: boolean }

function argumentos(lista: readonly string[]): Argumentos {
  let entrada = 'avaliacao/bancada-50/entregue';
  let saida = '';
  let variante = 'atual';
  let conferir = false;
  const ids: string[] = [];
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i] ?? '';
    if (item === '--entrada') entrada = lista[++i] ?? entrada;
    else if (item === '--saida') saida = lista[++i] ?? '';
    else if (item === '--variante') variante = lista[++i] ?? variante;
    else if (item === '--conferir') conferir = true;
    else ids.push(item);
  }
  if (saida === '' && !conferir) throw new Error('Falta --saida <pasta> (ou --conferir).');
  return { entrada: resolve(entrada), saida: saida === '' ? '' : resolve(saida), variante, ids, conferir };
}

/** Chave de comparação de uma marca: âncora, função, saliência, comentário e subfaixas (a ordem das chaves do jsonb não conta). */
export function chaveDaMarca(marca: Pick<MarcaV2, 'ancora' | 'funcao' | 'saliencia' | 'comentario' | 'subfaixas'>): string {
  return JSON.stringify([marca.ancora.bloco_id, marca.ancora.inicio_utf16, marca.ancora.fim_utf16, marca.funcao, marca.saliencia,
    marca.comentario?.tipo ?? null, marca.comentario?.rotulo ?? null, marca.comentario?.texto ?? null,
    marca.subfaixas.map((faixa) => [faixa.inicio_utf16, faixa.fim_utf16])]);
}

export function reprojetarEntregue(entregue: Entregue, opcoes: OpcoesDaProjecao): Entregue {
  const modelo = entregue.compreensao?.modelo;
  const blocos = entregue.blocos;
  if (!modelo || !blocos || entregue.marcas_compreensao === undefined) return entregue;
  const modo = obterModo(modelo.modo);
  const ordem = blocos.map((bloco) => bloco.id);
  const modeloFinal = opcoes.retrospectiva ? derivarRetrospectivas(modelo, ordem) : modelo;
  const camada = entregue.marcas_compreensao[0]?.camada_id ?? modelo.execucao_id;
  const projecao = projetarMarcas(modeloFinal, { modo, camada_id: camada, blocos }, opcoes);
  const marcas = projecao.marcas.map((item, indice) => ({
    ...item.marca, id: `R${String(indice).padStart(25, '0')}`, criada_em: modelo.criada_em, elemento_id: item.elemento_id,
  }));
  return {
    ...entregue,
    marcas_compreensao: marcas,
    compreensao: { ...entregue.compreensao, estado: entregue.compreensao?.estado ?? null, plano: entregue.compreensao?.plano ?? null, modelo: modeloFinal },
    reprojecao: { diagnosticos: projecao.diagnosticos, cobertura: projecao.cobertura },
  };
}

async function main(): Promise<void> {
  const { entrada, saida, variante, ids, conferir } = argumentos(process.argv.slice(2));
  if (conferir) {
    const arquivos = (await readdir(entrada)).filter((nome) => /^T\d+\.json$/.test(nome)).sort();
    let iguais = 0;
    let marcas = 0;
    for (const arquivo of arquivos) {
      const entregue = JSON.parse(await readFile(join(entrada, arquivo), 'utf8')) as Entregue;
      const novo = reprojetarEntregue(entregue, PROJECAO_ORIGINAL);
      const a = (entregue.marcas_compreensao ?? []).map(chaveDaMarca).sort();
      const b = (novo.marcas_compreensao ?? []).map(chaveDaMarca).sort();
      marcas += a.length;
      if (JSON.stringify(a) === JSON.stringify(b)) iguais += 1;
      else process.stdout.write(`diferente | ${arquivo}: ${String(a.length)} entregues × ${String(b.length)} reprojetadas\n`);
    }
    process.stdout.write(`conferir | ${String(iguais)}/${String(arquivos.length)} textos idênticos à entrega (${String(marcas)} marcas)\n`);
    if (iguais !== arquivos.length) process.exitCode = 1;
    return;
  }
  const opcoes = VARIANTES_DA_PROJECAO[variante];
  if (!opcoes) throw new Error(`Variante desconhecida: ${variante}. Conhecidas: ${Object.keys(VARIANTES_DA_PROJECAO).join(', ')}.`);
  await mkdir(saida, { recursive: true });
  const arquivos = (await readdir(entrada)).filter((nome) => /^T\d+\.json$/.test(nome) && (ids.length === 0 || ids.includes(nome.slice(0, -5)))).sort();
  let marcas = 0;
  for (const arquivo of arquivos) {
    const entregue = JSON.parse(await readFile(join(entrada, arquivo), 'utf8')) as Entregue;
    const novo = reprojetarEntregue(entregue, opcoes);
    marcas += novo.marcas_compreensao?.length ?? 0;
    await writeFile(join(saida, arquivo), JSON.stringify(novo));
  }
  process.stdout.write(`reprojetar | variante ${variante} | ${String(arquivos.length)} textos | ${String(marcas)} marcas → ${saida}\n`);
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) await main();
