/**
 * Gera o pacote distribuível do acervo de quadros (J110; ver `../arte/pacote.ts`).
 *
 *   npm run arte:empacotar -- [--origem <pasta>] [--saida <pasta>] [--versao AAAA.MM.DD] [--sem-audio] [slug…]
 *
 * Lê o acervo só para leitura (padrão: `MARGEM_ARTE_DIR`, senão `<dados>/arte/obras`) e grava
 * `acervo-de-quadros-<versão>.tar.gz` (+ `.sha256`) numa pasta temporária, nunca no repositório.
 * Imprime o relatório: obras no pacote, tamanho e obras excluídas com o motivo.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { raizDoAcervo } from '../arte/acervo.js';
import { empacotarAcervo, NOME_DO_PACOTE } from '../arte/pacote.js';
import { raizDoRepositorio } from '../dados.js';

const args = process.argv.slice(2);
const comValor = ['--origem', '--saida', '--versao'];
const valor = (nome: string): string | undefined => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const slugs = args.filter((a, i) => !a.startsWith('--') && !comValor.includes(args[i - 1] ?? ''));
const hoje = new Date();
const p = (n: number) => String(n).padStart(2, '0');
const versao = valor('--versao') ?? `${String(hoje.getFullYear())}.${p(hoje.getMonth() + 1)}.${p(hoje.getDate())}`;
const origem = resolve(valor('--origem') ?? raizDoAcervo());
const saida = resolve(valor('--saida') ?? await mkdtemp(join(tmpdir(), 'margem-acervo-')));
const repositorio = resolve(raizDoRepositorio());
if (saida === repositorio || saida.startsWith(repositorio + '/')) {
  console.error(`A saída (${saida}) fica dentro do repositório; escolha uma pasta fora dele.`);
  process.exit(64);
}
const destino = join(saida, `${NOME_DO_PACOTE}-${versao}.tar.gz`);
console.error(`lendo ${origem} (só leitura) → ${destino}`);
const r = await empacotarAcervo({ origem, destino, versao, comAudio: !args.includes('--sem-audio'), ...(slugs.length ? { slugs } : {}) });
const mb = (b: number) => `${(b / 1_000_000).toFixed(1)} MB`;
const porLicenca = new Map<string, number>();
for (const o of r.manifesto.obras) porLicenca.set(o.licenca.nome, (porLicenca.get(o.licenca.nome) ?? 0) + 1);
console.log([
  `pacote: ${r.arquivo}`,
  `sha256: ${r.sha256}`,
  `tamanho: ${mb(r.bytes)} (${String(r.bytes)} bytes; conteúdo ${mb(r.manifesto.totais.bytes)} em ${String(r.manifesto.totais.arquivos)} arquivos)`,
  `obras no pacote: ${String(r.manifesto.obras.length)}`,
  ...[...porLicenca].map(([nome, n]) => `  ${nome}: ${String(n)}`),
  `com narração: ${String(r.manifesto.obras.filter((o) => o.arquivos.some((a) => a.caminho.includes('/audio/'))).length)}`,
  `maior imagem: ${String(Math.max(...r.manifesto.obras.map((o) => Math.max(o.imagem.largura, o.imagem.altura))))} px no lado maior; ${mb(Math.max(...r.manifesto.obras.map((o) => o.imagem.bytes)))} no maior arquivo`,
  `excluídas: ${String(r.manifesto.excluidas.length)}`,
  ...r.manifesto.excluidas.map((e) => `  ${e.slug}: ${e.motivo}`),
].join('\n'));
