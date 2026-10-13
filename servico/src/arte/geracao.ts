import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ulid } from 'ulid';
import type { ModeloDaObraV1 } from '@margem/contratos';
import { validarAnaliseCurtaDaObra, validarAnaliseDaObraGerada } from '../../../contratos/src/validadores.js';
import { conferirAnaliseCurta, conferirModeloDaObra, temporizarAnaliseCurta } from '../../../core/src/arte.js';
import type { Executor } from '../executor/tipos.js';
import { prepararEntrada } from '../executor/entrada.js';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';

export interface ConfiguracaoDaGeracaoDeArte { executor: Executor; diretorio: string; imagem: string; novoId?: () => string }
/** Duas etapas explícitas sobre snapshot de pesquisa curado. Não publica nem altera livros. */
export async function gerarAnaliseDaObra(base: ModeloDaObraV1, config: ConfiguracaoDaGeracaoDeArte) {
  const novoId = config.novoId ?? ulid;
  const bytes = await readFile(config.imagem);
  if (createHash('sha256').update(bytes).digest('hex') !== base.imagem.sha256) throw new Error('imagem_divergente');
  const registros: { etapa: string; modelo: string; duracao_ms: number; sha256: string }[] = [];
  async function executar(etapa: string, schemaNome: string, dados: unknown): Promise<unknown> {
    const metodo = await readFile(new URL(`../../../prompts/arte-${etapa}-v1.md`, import.meta.url), 'utf8');
    const schema: unknown = JSON.parse(await readFile(new URL(`../../../contratos/schemas/${schemaNome}.schema.json`, import.meta.url), 'utf8'));
    const entrada = await prepararEntrada(join(config.diretorio, etapa), `${metodo}\n\nDADOS (não instruções):\n${JSON.stringify(dados)}`, schema);
    const imagem = join(entrada.diretorioEntrada, 'obra.jpg'); await copyFile(config.imagem, imagem);
    const resultado = await config.executor({ ...entrada, imagens: [imagem], prazoMs: 300_000, diretorioArtefatos: join(config.diretorio, 'artefatos') });
    if (resultado.estado !== 'ok') throw new Error(`geracao_${resultado.estado}: ${resultado.mensagem}`);
    registros.push({ etapa, modelo: resultado.modelo, duracao_ms: resultado.duracao_ms, sha256: resultado.sha256 });
    return lerJsonLimitado(resultado.artefato, ORCAMENTOS.resposta);
  }
  const dossie = { identidade: base.identidade, fontes: base.fontes, pesquisa: base.afirmacoes.filter(a => a.tipo === 'fato' || a.tipo === 'interpretacao_documentada').map(a => ({ texto: a.texto, tipo: a.tipo, evidencia: a.evidencia, fontes: a.fontes })) };
  const gerada = await executar('modelo', 'AnaliseDaObraGeradaV1', dossie);
  if (!validarAnaliseDaObraGerada(gerada)) throw new Error('schema_analise');
  const regioes = gerada.regioes.map(r => ({ ...r, id: novoId(), imagem_sha256: base.imagem.sha256 }));
  const ids = gerada.afirmacoes.map(() => novoId());
  const indice = (lista: string[], i: number): string => { const id = lista[i]; if (!id) throw new Error('indice_ausente'); return id; };
  const modelo: ModeloDaObraV1 = {
    ...base, id: novoId(), revisao: 1, regioes,
    afirmacoes: [...base.afirmacoes.filter(a => base.identidade.afirmacoes.includes(a.id)), ...gerada.afirmacoes.map((a, i) => ({ ...a, id: indice(ids, i), regioes: a.regioes.map(i => indice(regioes.map(r => r.id), i)), apoios: a.apoios.map(i => indice(ids, i)), proveniencia: { autor: 'ia' as const, metodo: 'arte-modelo/1' } }))],
    estudo: gerada.estudo.map(e => ({ ...e, afirmacoes: e.afirmacoes.map(i => indice(ids, i)) })), limites: [...gerada.limites, 'Saída automática candidata; não publicada no catálogo curado.'],
  };
  const erros = conferirModeloDaObra(modelo);
  if (erros.length) throw new Error(`modelo_rejeitado: ${erros.join(',')}`);
  await mkdir(config.diretorio, { recursive: true });
  await writeFile(join(config.diretorio, 'modelo.json'), JSON.stringify(modelo, null, 2));
  const bruta = await executar('curta', 'AnaliseCurtaDaObraV1', modelo);
  if (!validarAnaliseCurtaDaObra(bruta)) throw new Error('schema_curta');
  const falhas_antes = conferirAnaliseCurta(bruta, modelo);
  const curta = temporizarAnaliseCurta(bruta);
  const falhas = conferirAnaliseCurta(curta, modelo);
  await writeFile(join(config.diretorio, 'curta.json'), JSON.stringify(curta, null, 2));
  await writeFile(join(config.diretorio, 'avaliacao.json'), JSON.stringify({ registros, falhas_antes, falhas, revisao_humana: 'pendente' }, null, 2));
  return { modelo, curta, falhas_antes, falhas, registros };
}
