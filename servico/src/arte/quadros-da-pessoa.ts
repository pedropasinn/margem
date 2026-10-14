/**
 * Quadros da pessoa (J118), do lado da API: receber a imagem, pôr o preparo na fila, mostrar o estado,
 * tentar de novo, corrigir a identificação e remover. Quem prepara é o worker (`preparo.ts`).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { renomearComRetentativa } from '../plataforma/disco.js';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import { validarQuadroDaPessoa, type IdentificacaoDaObraV1, type QuadroDaPessoaV1 } from '@margem/contratos';
import { comTransacao, type Transacao } from '../db/transacao.js';
import * as jobsRepo from '../repos/jobs.js';
import { ehSlug, raizDoAcervo, raizesDeLeitura } from './acervo.js';
import { EXTENSAO_DO_FORMATO, type FormatoDaImagem } from './imagem-enviada.js';
import {
  chaveDoPreparo, esquecerIdentificacao, lerIdentificacaoProposta, lerPreparo, MODELO_DO_ACERVO, propostaReconhecida, TIPO_PREPARAR_QUADRO,
  type IdentificacaoProposta, type Informado,
} from './preparo.js';
import * as repo from './repo.js';

export const pastaDoQuadro = (slug: string, raiz = raizDoAcervo()): string => join(raiz, slug);

/** `v2-AAAAMMDD-HHMM` (o título da análise fica "Codex v2 · DD/MM · HHMM"), único na pasta da obra. */
export function rotuloNovo(pasta: string, agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `v2-${String(agora.getFullYear())}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}`;
  let rotulo = base;
  for (let n = 2; existsSync(join(pasta, 'geracoes', rotulo)); n += 1) rotulo = `${base}-${String(n)}`;
  return rotulo;
}

/** Nome da pasta: o título (ou o artista) em minúsculas sem acento, mais um sufixo curto e único. */
export function slugDaObra(base: string | null, sufixo: string): string {
  const raiz = (base ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48).replace(/-+$/u, '');
  return `${raiz || 'obra'}-${sufixo}`;
}

async function enfileirar(cliente: Transacao, quadroId: string): Promise<jobsRepo.Job> {
  const dedup_key = chaveDoPreparo(quadroId, ulid());
  return jobsRepo.enfileirar(cliente, {
    tipo: TIPO_PREPARAR_QUADRO, dedup_key, input_snapshot_hash: createHash('sha256').update(dedup_key).digest('hex'), prioridade: jobsRepo.PRIORIDADE.artefato_pedido,
  });
}

const ATIVOS = new Set(['fila', 'adiado', 'reservado']);

export type EnvioRegistrado = { quadro: QuadroDaPessoaV1 } | { erro: 'quadro_duplicado'; slug: string };

/**
 * Cria a obra: grava o original em `<raiz>/<slug>/original.<ext>`, a linha e o job, numa transação. A
 * mesma imagem (bytes iguais) duas vezes é recusada com o slug da que já existe.
 */
export async function registrarEnvio(banco: pg.Pool, envio: {
  bytes: Uint8Array; formato: FormatoDaImagem; nome: string | null; informado: Informado;
}): Promise<EnvioRegistrado> {
  const sha = createHash('sha256').update(envio.bytes).digest('hex');
  const raiz = raizDoAcervo();
  const { informado } = envio;
  const identificacao: IdentificacaoDaObraV1 | null = informado.titulo && informado.artista
    ? { titulo: informado.titulo, artista: informado.artista, ano: informado.ano } : null;
  let criada: string | null = null;
  try {
    return await comTransacao(banco, async (cliente) => {
      await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`quadro:${sha}`]);
      const existente = await repo.porImagem(cliente, sha);
      if (existente) return { erro: 'quadro_duplicado' as const, slug: existente.slug };
      let slug = '';
      for (let tentativa = 0; tentativa < 20; tentativa += 1) {
        slug = slugDaObra(informado.titulo ?? informado.artista, ulid().slice(-6).toLowerCase());
        if (!(await repo.slugEmUso(cliente, slug)) && raizesDeLeitura().every((r) => !existsSync(join(r, slug)))) break;
      }
      const pasta = pastaDoQuadro(slug, raiz);
      await mkdir(pasta, { recursive: true });
      criada = pasta;
      await writeFile(join(pasta, `original.${EXTENSAO_DO_FORMATO[envio.formato]}`), envio.bytes);
      await writeFile(join(pasta, 'informado.json'), `${JSON.stringify(informado, null, 2)}\n`);
      const rotulo = rotuloNovo(pasta);
      const id = await repo.criar(cliente, { slug, formato: envio.formato, bytes: envio.bytes.byteLength, nome_do_arquivo: envio.nome, sha256_original: sha, identificacao, rotulo });
      const job = await enfileirar(cliente, id);
      await repo.ligarJob(cliente, id, job.id, rotulo);
      // Marca a pasta como "em preparo": a leitura do acervo não avisa por ela enquanto não há análise.
      await writeFile(join(pasta, 'preparo.json'), `${JSON.stringify({ versao: 1, job_id: job.id, etapa: 'imagem', feitas: 0, total: 1, atualizado_em: new Date().toISOString() })}\n`);
      const linha = await repo.obter(cliente, id);
      return { quadro: await quadroDaPessoa(linha!, raiz) };
    });
  } catch (erro) {
    if (criada) await rm(criada, { recursive: true, force: true });
    throw erro;
  }
}

const MOTIVOS: Record<string, string> = {
  timeout: 'O Codex passou do prazo. Tente de novo.', cancelado: 'O preparo foi cancelado.',
  auth: 'O Codex está sem sessão válida. Entre na sua conta do ChatGPT e tente de novo.',
  schema: 'A resposta do Codex veio fora do formato. Tente de novo.', json_invalido: 'A resposta do Codex veio truncada. Tente de novo.',
  processo: 'O Codex terminou com erro. Tente de novo.', cli_incompativel: 'A versão do Codex desta instalação não oferece o que a análise precisa.',
  tentativas_esgotadas: 'O preparo foi interrompido várias vezes. Tente de novo.',
};

const linhaCurta = (v: string | null, maximo: number): string | null => {
  const limpa = v?.replace(/[\r\n\u2028\u2029]+/gu, ' ').trim().slice(0, maximo) ?? '';
  return limpa === '' ? null : limpa;
};

/**
 * O palpite do Codex como a interface o mostra (V-W5): a justificativa ("lembra cenas sentimentais
 * britânicas do fim do século XIX") e, se ele arriscou, título e artista para a pessoa confirmar.
 */
export function palpiteParaInterface(p: IdentificacaoProposta): NonNullable<QuadroDaPessoaV1['palpite']> {
  return {
    texto: p.justificativa.trim().slice(0, 1000) || 'O Codex não reconheceu a obra pela imagem.',
    titulo: linhaCurta(p.titulo, 300), artista: linhaCurta(p.artista, 300), ano: linhaCurta(p.ano, 40), confianca: p.confianca,
  };
}

/** A obra como a interface a vê (`QuadroDaPessoaV1`), com o estado vindo do job e o progresso do disco. */
export async function quadroDaPessoa(linha: repo.LinhaDoQuadro, raiz = raizDoAcervo()): Promise<QuadroDaPessoaV1> {
  const pasta = pastaDoQuadro(linha.slug, raiz);
  const preparo = await lerPreparo(pasta);
  const doJob = preparo?.job_id === linha.job_id ? preparo : null;
  const proposta = linha.identificacao ? null : await lerIdentificacaoProposta(pasta);
  const identificacao: QuadroDaPessoaV1['identificacao'] = linha.identificacao
    ? { titulo: linha.identificacao.titulo, artista: linha.identificacao.artista, ano: linha.identificacao.ano ?? null, origem: 'pessoa' }
    : proposta && propostaReconhecida(proposta)
      ? proposta.modelo === MODELO_DO_ACERVO
        ? { titulo: proposta.titulo!, artista: proposta.artista!, ano: proposta.ano, origem: 'acervo' }
        : { titulo: proposta.titulo!, artista: proposta.artista!, ano: proposta.ano, origem: 'codex', confianca: proposta.confianca } : null;
  const palpite = proposta && !propostaReconhecida(proposta) ? palpiteParaInterface(proposta) : null;
  const base = {
    versao: 1 as const, id: linha.id, slug: linha.slug, identificacao, ...(palpite ? { palpite } : {}), enviado_em: linha.criado_em.toISOString(),
    imagem: { formato: linha.formato, bytes: Number(linha.bytes), ...(linha.nome_do_arquivo ? { nome: linha.nome_do_arquivo } : {}) },
  };
  let quadro: QuadroDaPessoaV1;
  switch (linha.job_estado) {
    case null: case 'fila':
      quadro = { ...base, estado: 'na_fila', etapa: null, progresso: null }; break;
    case 'adiado':
      quadro = { ...base, estado: 'na_fila', etapa: null, progresso: null, aviso: linha.job_not_before
        ? `Cota do Codex esgotada; o preparo continua sozinho a partir de ${linha.job_not_before.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`
        : 'Na fila, esperando a vez.' };
      break;
    case 'reservado':
      quadro = { ...base, estado: 'preparando', etapa: doJob?.etapa ?? 'imagem', progresso: doJob ? { feitas: Math.min(doJob.feitas, doJob.total), total: doJob.total } : null }; break;
    case 'ok':
      quadro = { ...base, estado: 'pronto', etapa: null, progresso: null }; break;
    default: {
      const diagnostico = (linha.job_diagnosticos ?? []).find((d) => d.nivel === 'erro') ?? linha.job_diagnosticos?.[0];
      const codigo = /^[a-z][a-z0-9_]{0,63}$/u.test(linha.job_erro ?? '') ? linha.job_erro! : 'desconhecido';
      const propria = ['imagem_invalida', 'obra_nao_reconhecida', 'obra_nao_encontrada', 'analise_recusada', 'indisponivel'].includes(codigo);
      const mensagem = (propria ? diagnostico?.mensagem : MOTIVOS[codigo] ?? diagnostico?.mensagem) ?? 'O preparo não terminou.';
      quadro = { ...base, estado: 'falhou', etapa: doJob?.etapa ?? null, progresso: null, erro: { codigo, mensagem: mensagem.slice(0, 1000) } };
    }
  }
  if (!validarQuadroDaPessoa(quadro)) throw new Error(`QuadroDaPessoaV1 inválido: ${JSON.stringify(validarQuadroDaPessoa.errors)}`);
  return quadro;
}

export async function listarQuadrosDaPessoa(banco: pg.Pool): Promise<{ linha: repo.LinhaDoQuadro; quadro: QuadroDaPessoaV1 }[]> {
  const linhas = await comTransacao(banco, (cliente) => repo.listar(cliente));
  const raiz = raizDoAcervo();
  return Promise.all(linhas.map(async (linha) => ({ linha, quadro: await quadroDaPessoa(linha, raiz) })));
}

export type Alteracao = { quadro: QuadroDaPessoaV1 } | { erro: 'quadro_inexistente' | 'preparo_em_curso' | 'quadro_pronto' };

/** Uma tentativa nova depois de uma falha, retomando o que já foi feito (as etapas prontas não chamam o Codex de novo). */
export async function tentarDeNovo(banco: pg.Pool, slug: string): Promise<Alteracao> {
  return comTransacao(banco, async (cliente) => {
    const linha = await repo.obterPorSlug(cliente, slug, { travar: true });
    if (!linha) return { erro: 'quadro_inexistente' as const };
    if (linha.job_estado !== null && ATIVOS.has(linha.job_estado)) return { erro: 'preparo_em_curso' as const };
    if (linha.job_estado === 'ok') return { erro: 'quadro_pronto' as const };
    const job = await enfileirar(cliente, linha.id);
    await repo.ligarJob(cliente, linha.id, job.id, linha.rotulo);
    return { quadro: await quadroDaPessoa((await repo.obter(cliente, linha.id))!) };
  });
}

/**
 * A pessoa corrige (ou informa) título, artista e ano: o preparo em curso é cancelado, o dossiê é
 * refeito e a análise sai numa geração nova. A imagem e as análises anteriores ficam na pasta.
 */
export async function corrigirIdentificacao(banco: pg.Pool, slug: string, identificacao: IdentificacaoDaObraV1): Promise<Alteracao> {
  const antes = await comTransacao(banco, (cliente) => repo.obterPorSlug(cliente, slug));
  if (!antes) return { erro: 'quadro_inexistente' };
  if (antes.job_id && antes.job_estado !== null && ATIVOS.has(antes.job_estado)) await jobsRepo.cancelar(banco, antes.job_id);
  return comTransacao(banco, async (cliente) => {
    const linha = await repo.obterPorSlug(cliente, slug, { travar: true });
    if (!linha) return { erro: 'quadro_inexistente' as const };
    // Outro pedido entrou entre o cancelamento e o travamento: a pessoa tenta de novo em seguida.
    if (linha.job_estado !== null && ATIVOS.has(linha.job_estado)) return { erro: 'preparo_em_curso' as const };
    const limpa: IdentificacaoDaObraV1 = { titulo: identificacao.titulo.trim(), artista: identificacao.artista.trim(), ano: identificacao.ano?.trim() || null };
    await repo.gravarIdentificacao(cliente, linha.id, limpa);
    const pasta = pastaDoQuadro(slug);
    await esquecerIdentificacao(pasta);
    const rotulo = rotuloNovo(pasta);
    const job = await enfileirar(cliente, linha.id);
    await repo.ligarJob(cliente, linha.id, job.id, rotulo);
    return { quadro: await quadroDaPessoa((await repo.obter(cliente, linha.id))!) };
  });
}

export type Remocao = { removido: true } | { erro: 'quadro_inexistente' | 'obra_do_acervo' };

/**
 * Remove a obra da pessoa: cancela o preparo, apaga a linha e a pasta. Só as obras da pasta da pessoa
 * (`raizDoAcervo()`) saem; o acervo antigo e as obras de exemplo não se removem pelo app.
 */
export async function removerQuadro(banco: pg.Pool, slug: string): Promise<Remocao> {
  if (!ehSlug(slug)) return { erro: 'quadro_inexistente' };
  const raiz = raizDoAcervo();
  const pasta = pastaDoQuadro(slug, raiz);
  const linha = await comTransacao(banco, (cliente) => repo.obterPorSlug(cliente, slug));
  if (!linha && !existsSync(pasta)) {
    return raizesDeLeitura().some((r) => existsSync(join(r, slug))) || ['educacao', 'tolo'].includes(slug) ? { erro: 'obra_do_acervo' } : { erro: 'quadro_inexistente' };
  }
  if (linha?.job_id && linha.job_estado !== null && ATIVOS.has(linha.job_estado)) await jobsRepo.cancelar(banco, linha.job_id);
  if (linha) await comTransacao(banco, (cliente) => repo.apagar(cliente, linha.id));
  // Tira a pasta do caminho antes de apagar: um preparo que ainda escreva nela não ressuscita a obra.
  if (existsSync(pasta)) {
    const lixeira = join(raiz, `.removendo-${slug}-${ulid().toLowerCase()}`);
    await renomearComRetentativa(pasta, lixeira);
    await rm(lixeira, { recursive: true, force: true });
  }
  return { removido: true };
}
