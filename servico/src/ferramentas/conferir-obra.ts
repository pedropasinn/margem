/**
 * Confere uma obra do acervo de quadros (`~/dados/margem/arte/obras/<slug>/`): o hash e as dimensões da
 * imagem, o contrato e as regras de cada arquivo de modelo e de análise curta presente.
 *
 *   node --import tsx servico/src/ferramentas/conferir-obra.ts <slug|caminho> [mais…]
 *
 * Sai com 1 se algum arquivo falhar. Não escreve nada.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { validarAnaliseCurtaDaObra, validarModeloDaObra } from '../../../contratos/src/validadores.js';
import { conferirAnaliseCurta, conferirModeloDaObra } from '../../../core/src/arte.js';

export const ACERVO_DE_ARTE = process.env.MARGEM_ARTE_DIR ?? join(homedir(), 'dados/margem/arte/obras');

async function conferir(pasta: string): Promise<string[]> {
  const erros: string[] = [];
  const ler = async (nome: string): Promise<unknown> => JSON.parse(await readFile(join(pasta, nome), 'utf8'));
  if (!existsSync(join(pasta, 'imagem.jpg'))) return ['imagem.jpg ausente'];
  const sha = createHash('sha256').update(await readFile(join(pasta, 'imagem.jpg'))).digest('hex');
  const arquivos = (await readdir(pasta)).filter((n) => n.endsWith('.modelo.json'));
  const pares: [string, string][] = [];
  for (const sub of existsSync(join(pasta, 'geracoes')) ? await readdir(join(pasta, 'geracoes')) : []) {
    if (existsSync(join(pasta, 'geracoes', sub, 'modelo.json'))) pares.push([join('geracoes', sub, 'modelo.json'), join('geracoes', sub, 'curta.json')]);
  }
  for (const m of arquivos) pares.push([m, m.replace('.modelo.json', '.curta.json')]);
  if (!pares.length) erros.push('nenhum *.modelo.json');
  for (const [nomeModelo, nomeCurta] of pares) {
    const modelo = await ler(nomeModelo);
    if (!validarModeloDaObra(modelo)) { erros.push(`${nomeModelo}: contrato ${JSON.stringify(validarModeloDaObra.errors?.slice(0, 3))}`); continue; }
    const m = modelo;
    if (m.imagem.sha256 !== sha) erros.push(`${nomeModelo}: imagem.sha256 diferente do imagem.jpg (${sha})`);
    for (const e of conferirModeloDaObra(m)) erros.push(`${nomeModelo}: ${e}`);
    if (!existsSync(join(pasta, nomeCurta))) continue;
    const curta = await ler(nomeCurta);
    if (!validarAnaliseCurtaDaObra(curta)) { erros.push(`${nomeCurta}: contrato ${JSON.stringify(validarAnaliseCurtaDaObra.errors?.slice(0, 3))}`); continue; }
    for (const e of conferirAnaliseCurta(curta, m)) erros.push(`${nomeCurta}: ${e}`);
  }
  return erros;
}

let falhou = false;
for (const alvo of process.argv.slice(2)) {
  const pasta = alvo.includes('/') ? resolve(alvo) : join(ACERVO_DE_ARTE, alvo);
  const erros = await conferir(pasta);
  console.log(erros.length ? `✗ ${alvo}\n  ${erros.join('\n  ')}` : `✓ ${alvo}`);
  if (erros.length) falhou = true;
}
if (falhou) process.exitCode = 1;
