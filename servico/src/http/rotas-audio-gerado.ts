/**
 * Áudio gerado no app com a chave da pessoa (J106).
 *
 *   GET    /api/configuracoes/audio               situação: chave configurada? (só os 4 últimos), voz, modelo, modelos
 *   PUT    /api/configuracoes/audio/chave         grava a chave no arquivo de segredos (0600); devolve a situação
 *   DELETE /api/configuracoes/audio/chave         apaga a chave
 *   POST   /api/configuracoes/audio/testar        testa a chave enviada (sem gravar) ou a guardada
 *   GET    /api/configuracoes/audio/vozes         vozes da conta, pela API do provedor
 *   PUT    /api/configuracoes/audio/preferencias  voz e modelo
 *
 *   GET    /api/versoes/:versao/capitulos/:secao/narracao          estado do pedido mais recente (com progresso)
 *   POST   /api/versoes/:versao/capitulos/:secao/narracao/previa   roteiro e estimativa de caracteres/custo
 *   POST   /api/versoes/:versao/capitulos/:secao/narracao          enfileira, com os caracteres confirmados
 *
 * Nenhuma resposta, erro ou log carrega a chave: as respostas são montadas campo a campo, e os
 * erros do provedor passam por `redigir`.
 */
import type { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type pg from 'pg';
import { validarAncora, type AncoraV1, type Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import {
  apagarChave, chaveBemFormada, gravarChave, gravarPreferencias, lerChave, lerPreferencias, preferenciasValidas, situacaoDaChave,
} from '../audio/configuracao.js';
import { ErroDeNarracao, NarracaoEmCurso, pedirNarracao, previaDaNarracao, provedorPadrao, situacaoDaNarracao } from '../audio/narracao.js';
import { MODELOS_ELEVENLABS } from '../audio/voz/elevenlabs.js';
import { ErroDoProvedor, redigir, type ProvedorDeVoz, type TipoDeErroDoProvedor } from '../audio/voz/provedor.js';
import { lerCorpoJson } from './entrada-json.js';
import { ErroDaApi } from './erros.js';

export interface ApoioDoAudioGerado {
  banco: pg.Pool;
  exigirUlid: (valor: string, papel: string) => Id;
  criarProvedor?: (chave: string) => ProvedorDeVoz;
}

const STATUS_DO_ERRO: Readonly<Record<TipoDeErroDoProvedor, ContentfulStatusCode>> = {
  sem_chave: 409, chave_invalida: 422, sem_creditos: 402, limite: 429, permissao: 422, voz_inexistente: 422,
  pedido_recusado: 422, indisponivel: 502, resposta_invalida: 502, cancelado: 409,
};

function erroDoProvedor(erro: unknown, segredo: string | null): never {
  if (erro instanceof ErroDoProvedor) throw new ErroDaApi(STATUS_DO_ERRO[erro.tipo], erro.tipo, redigir(erro.message, segredo));
  throw erro;
}

function objeto(valor: unknown): Record<string, unknown> {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto.');
  return valor as Record<string, unknown>;
}

function trechoDoCorpo(corpo: Record<string, unknown>): AncoraV1 | null {
  if (corpo.trecho === undefined || corpo.trecho === null) return null;
  if (!validarAncora(corpo.trecho)) throw new ErroDaApi(400, 'trecho_invalido', 'O trecho precisa ser uma âncora válida.');
  return corpo.trecho;
}

export function registrarAudioGerado(api: Hono, apoio: ApoioDoAudioGerado): void {
  const { banco, exigirUlid } = apoio;
  const criarProvedor = apoio.criarProvedor ?? provedorPadrao;

  const situacao = async () => {
    const [chave, preferencias] = await Promise.all([situacaoDaChave(), lerPreferencias()]);
    return {
      provedor: 'elevenlabs' as const,
      chave, // { configurada, final } — nunca o valor
      voz: preferencias.voz_id === null ? null : { id: preferencias.voz_id, nome: preferencias.voz_nome },
      modelo_id: preferencias.modelo_id,
      modelos: MODELOS_ELEVENLABS.map((m) => ({ id: m.id, nome: m.nome, creditos_por_caractere: m.creditosPorCaractere, usd_por_mil: m.usdPorMil })),
      guardada: 'Só neste computador, num arquivo de segredos da pasta de dados do Margem (permissão 0600). Nunca vai para o banco nem para o Git.',
    };
  };

  api.get('/api/configuracoes/audio', async (c) => c.json(await situacao()));

  api.put('/api/configuracoes/audio/chave', async (c) => {
    const corpo = objeto(await lerCorpoJson(c.req.raw));
    const chave = typeof corpo.chave === 'string' ? corpo.chave.trim() : '';
    if (!chaveBemFormada(chave)) throw new ErroDaApi(400, 'chave_malformada', 'Cole a chave inteira, sem espaços (ela começa com “sk_”).');
    await gravarChave(chave);
    return c.json(await situacao());
  });

  api.delete('/api/configuracoes/audio/chave', async (c) => {
    await apagarChave();
    return c.json(await situacao());
  });

  api.post('/api/configuracoes/audio/testar', async (c) => {
    const corpo = objeto(await lerCorpoJson(c.req.raw, true));
    const enviada = typeof corpo.chave === 'string' && corpo.chave.trim() !== '' ? corpo.chave.trim() : null;
    if (enviada !== null && !chaveBemFormada(enviada)) throw new ErroDaApi(400, 'chave_malformada', 'Cole a chave inteira, sem espaços (ela começa com “sk_”).');
    const chave = enviada ?? await lerChave();
    if (chave === null) throw new ErroDaApi(409, 'sem_chave', 'Nenhuma chave da ElevenLabs configurada.');
    try {
      const resultado = await criarProvedor(chave).testarChave(c.req.raw.signal);
      return c.json({ ok: true, ...(resultado.creditos_restantes === undefined ? {} : { creditos_restantes: resultado.creditos_restantes }) });
    } catch (erro) { return erroDoProvedor(erro, chave); }
  });

  api.get('/api/configuracoes/audio/vozes', async (c) => {
    const chave = await lerChave();
    if (chave === null) throw new ErroDaApi(409, 'sem_chave', 'Nenhuma chave da ElevenLabs configurada.');
    try { return c.json({ vozes: await criarProvedor(chave).listarVozes(c.req.raw.signal) }); }
    catch (erro) { return erroDoProvedor(erro, chave); }
  });

  api.put('/api/configuracoes/audio/preferencias', async (c) => {
    const corpo = await lerCorpoJson(c.req.raw);
    if (!preferenciasValidas(corpo)) throw new ErroDaApi(400, 'preferencias_invalidas', 'Voz ou modelo inválidos.');
    await gravarPreferencias(corpo);
    return c.json(await situacao());
  });

  const alvo = (versao: string, secao: string) => ({ versaoId: exigirUlid(versao, 'versão'), secaoId: exigirUlid(secao, 'capítulo') });
  const traduzir = (erro: unknown): never => {
    if (erro instanceof NarracaoEmCurso) throw new ErroDaApi(409, 'narracao_em_curso', erro.message);
    if (erro instanceof ErroDeNarracao) {
      const status: ContentfulStatusCode = erro.codigo === 'capitulo_inexistente' ? 404 : erro.codigo === 'estimativa_mudou' || erro.codigo === 'sem_voz' ? 409 : 400;
      throw new ErroDaApi(status, erro.codigo, erro.message);
    }
    if (erro instanceof Error && erro.message === 'Versão inexistente.') throw new ErroDaApi(404, 'versao_inexistente', 'Versão inexistente.');
    throw erro;
  };

  api.get('/api/versoes/:versao/capitulos/:secao/narracao', async (c) => {
    const { versaoId, secaoId } = alvo(c.req.param('versao'), c.req.param('secao'));
    const [estado, chave] = await Promise.all([comTransacao(banco, (cliente) => situacaoDaNarracao(cliente, versaoId, secaoId)), situacaoDaChave()]);
    return c.json({ ...estado, chave_configurada: chave.configurada });
  });

  api.post('/api/versoes/:versao/capitulos/:secao/narracao/previa', async (c) => {
    const { versaoId, secaoId } = alvo(c.req.param('versao'), c.req.param('secao'));
    const trecho = trechoDoCorpo(objeto(await lerCorpoJson(c.req.raw, true)));
    try { return c.json(await comTransacao(banco, (cliente) => previaDaNarracao(cliente, { versaoId, secaoId, trecho }))); }
    catch (erro) { return traduzir(erro); }
  });

  api.post('/api/versoes/:versao/capitulos/:secao/narracao', async (c) => {
    const { versaoId, secaoId } = alvo(c.req.param('versao'), c.req.param('secao'));
    const corpo = objeto(await lerCorpoJson(c.req.raw));
    const trecho = trechoDoCorpo(corpo);
    if (typeof corpo.caracteres_confirmados !== 'number' || !Number.isSafeInteger(corpo.caracteres_confirmados)) {
      throw new ErroDaApi(400, 'sem_confirmacao', 'Confirme a estimativa antes de gerar.');
    }
    const confirmados = corpo.caracteres_confirmados;
    if (!(await situacaoDaChave()).configurada) throw new ErroDaApi(409, 'sem_chave', 'Nenhuma chave da ElevenLabs configurada.');
    try {
      const { pedido_id } = await comTransacao(banco, (cliente) => pedirNarracao(cliente, { versaoId, secaoId, trecho }, confirmados));
      const estado = await comTransacao(banco, (cliente) => situacaoDaNarracao(cliente, versaoId, secaoId));
      return c.json({ ...estado, pedido_id, chave_configurada: true }, 202);
    } catch (erro) { return traduzir(erro); }
  });
}
