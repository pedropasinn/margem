/**
 * Avalia uma geração de um quadro contra a referência da obra e escreve `avaliacao.json` e
 * `avaliacao.md` na pasta da geração. Determinístico; não chama modelo.
 *
 *   node --import tsx servico/src/ferramentas/avaliar-quadro.ts <slug> <rotulo|caminho-da-geracao>
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { AnaliseCurtaDaObraV1, ModeloDaObraV1 } from '@margem/contratos';
import { lerObra } from '../arte/v2/acervo.js';
import { escreverAvaliacao } from '../arte/v2/pipeline.js';
import type { RegistroV2 } from '../arte/v2/pipeline.js';

const [slug, geracao] = process.argv.slice(2);
if (!slug || !geracao) {
  console.error('Uso: node --import tsx servico/src/ferramentas/avaliar-quadro.ts <slug> <rotulo|caminho>');
  process.exit(64);
}
const obra = await lerObra(slug);
const pasta = geracao.includes('/') ? (isAbsolute(geracao) ? geracao : resolve(geracao)) : join(obra.pasta, 'geracoes', geracao);
const ler = async <T>(nome: string): Promise<T | null> => (existsSync(join(pasta, nome)) ? JSON.parse(await readFile(join(pasta, nome), 'utf8')) as T : null);
const modelo = await ler<ModeloDaObraV1>('modelo.json');
if (!modelo) { console.error(`sem modelo.json em ${pasta}`); process.exit(1); }
const curta = await ler<AnaliseCurtaDaObraV1>('curta.json');
if (!curta) { console.error(`sem curta.json em ${pasta}`); process.exit(1); }
await escreverAvaliacao(obra, pasta, modelo, curta, await ler<RegistroV2>('registro.json'));
const a = JSON.parse(await readFile(join(pasta, 'avaliacao.json'), 'utf8')) as { contrato: { falhas_modelo: string[]; falhas_curta: string[] | null }; regioes: { iou_medio_casado: number; recall_iou_0_5: number; esperadas: number }; afirmacoes: { cobertas: number; total: number }; curta: { gerada: { duracao_s: number; batidas: number; repeticao: { jaccard_max: number } } | null } };
console.log(JSON.stringify({
  obra: slug, geracao: pasta.split('/').at(-1), falhas: [...a.contrato.falhas_modelo, ...(a.contrato.falhas_curta ?? [])],
  iou_medio_casado: a.regioes.iou_medio_casado, regioes_iou_0_5: `${String(a.regioes.recall_iou_0_5)}/${String(a.regioes.esperadas)}`,
  afirmacoes_cobertas: `${String(a.afirmacoes.cobertas)}/${String(a.afirmacoes.total)}`,
  duracao_s: a.curta.gerada?.duracao_s, batidas: a.curta.gerada?.batidas, jaccard_max: a.curta.gerada?.repeticao.jaccard_max,
  relatorio: join(pasta, 'avaliacao.md'),
}));
