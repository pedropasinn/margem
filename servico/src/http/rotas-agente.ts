/**
 * Rotas da página "Perguntar": conversas com o agente que lê a biblioteca inteira.
 *
 * Id, datas e estado são do serviço; o corpo só traz a pergunta. Uma pergunta por vez em cada
 * conversa (409 enquanto a anterior está na fila ou pensando). "Salvar" um mapa de capítulo cria um
 * visual do capítulo já pronto (o mesmo lugar dos fluxogramas do J70), sem nova chamada ao Codex.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import type { ArtefatoDoAgenteV1, Id, MensagemDoAgenteV1 } from '@margem/contratos';
import { enfileirarPergunta } from '../agente/manipulador.js';
import * as agenteRepo from '../agente/repo.js';
import { comTransacao, type Transacao } from '../db/transacao.js';
import * as visuaisRepo from '../repos/visuais.js';
import { ErroDaApi } from './erros.js';

type ContextoDeCorpo = { req: { raw: Request } };
export interface ApoioDoAgente {
  banco: pg.Pool;
  corpoJson: (c: ContextoDeCorpo) => Promise<unknown>;
  exigirUlid: (valor: string, papel: string) => Id;
}

export const PERGUNTA_MAXIMA = 8000;

function lerPergunta(bruto: unknown): string {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  const desconhecidas = Object.keys(bruto).filter((chave) => chave !== 'pergunta');
  if (desconhecidas.length > 0) throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${desconhecidas.join(', ')}.`);
  const { pergunta } = bruto as { pergunta?: unknown };
  if (typeof pergunta !== 'string' || pergunta.trim() === '') throw new ErroDaApi(400, 'pergunta_vazia', 'Escreva a pergunta.');
  if (pergunta.length > PERGUNTA_MAXIMA) throw new ErroDaApi(400, 'pergunta_longa', `A pergunta passa de ${String(PERGUNTA_MAXIMA)} caracteres.`);
  return pergunta.trim();
}

/** Título da conversa: a primeira pergunta, numa linha, cortada numa palavra. */
export function tituloDaPergunta(pergunta: string): string {
  const linha = pergunta.replace(/\s+/gu, ' ').trim();
  if (linha.length <= 80) return linha;
  const corte = linha.slice(0, 80);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > 40 ? corte.slice(0, espaco) : corte).trim()}…`;
}

async function fio(cliente: Transacao, id: Id) {
  const conversa = await agenteRepo.obterConversa(cliente, id);
  if (!conversa) throw new ErroDaApi(404, 'conversa_inexistente');
  return { conversa, mensagens: await agenteRepo.mensagens(cliente, id) };
}

const emCurso = (mensagens: readonly MensagemDoAgenteV1[]): boolean =>
  mensagens.some((mensagem) => mensagem.autor === 'leitor' && (mensagem.estado === 'na_fila' || mensagem.estado === 'pensando'));

export function registrarRotasDoAgente(api: Hono, apoio: ApoioDoAgente): void {
  const { banco, corpoJson, exigirUlid } = apoio;

  api.get('/api/agente/conversas', async (c) => {
    const conversas = await comTransacao(banco, (cliente) => agenteRepo.listarConversas(cliente));
    return c.json({ conversas });
  });

  api.post('/api/agente/conversas', async (c) => {
    const pergunta = lerPergunta(await corpoJson(c));
    const resposta = await comTransacao(banco, async (cliente) => {
      const id = await agenteRepo.criarConversa(cliente, tituloDaPergunta(pergunta));
      const mensagem = await agenteRepo.acrescentarPergunta(cliente, id, pergunta);
      await enfileirarPergunta(cliente, id, mensagem);
      return fio(cliente, id);
    });
    return c.json(resposta, 201);
  });

  api.get('/api/agente/conversas/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'conversa');
    return c.json(await comTransacao(banco, (cliente) => fio(cliente, id)));
  });

  api.delete('/api/agente/conversas/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'conversa');
    const apagada = await comTransacao(banco, (cliente) => agenteRepo.apagarConversa(cliente, id));
    if (!apagada) throw new ErroDaApi(404, 'conversa_inexistente');
    return c.json({ conversa_id: id, apagada: true });
  });

  api.post('/api/agente/conversas/:id/mensagens', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'conversa');
    const pergunta = lerPergunta(await corpoJson(c));
    const resposta = await comTransacao(banco, async (cliente) => {
      const conversa = await agenteRepo.obterConversa(cliente, id, { travar: true });
      if (!conversa) throw new ErroDaApi(404, 'conversa_inexistente');
      if (emCurso(await agenteRepo.mensagens(cliente, id))) throw new ErroDaApi(409, 'pergunta_em_curso', 'O agente ainda está respondendo a pergunta anterior.');
      const mensagem = await agenteRepo.acrescentarPergunta(cliente, id, pergunta);
      await enfileirarPergunta(cliente, id, mensagem);
      return fio(cliente, id);
    });
    return c.json(resposta, 201);
  });

  // Pergunta que falhou (cota, prazo, formato): um job novo para a mesma pergunta.
  api.post('/api/agente/mensagens/:id/repetir', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'mensagem');
    const resposta = await comTransacao(banco, async (cliente) => {
      const mensagem = await agenteRepo.obterMensagem(cliente, id, { travar: true });
      if (!mensagem || mensagem.autor !== 'leitor') throw new ErroDaApi(404, 'pergunta_inexistente');
      if (mensagem.estado !== 'falhou') throw new ErroDaApi(409, 'pergunta_nao_falhou', 'Só uma pergunta que falhou pode ser repetida.');
      await enfileirarPergunta(cliente, mensagem.conversa_id, id);
      return fio(cliente, mensagem.conversa_id);
    });
    return c.json(resposta);
  });

  // Mapa de um capítulo → visual do capítulo, já publicado (aparece no leitor, na margem do capítulo).
  api.post('/api/agente/mensagens/:id/artefatos/:indice/salvar', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'mensagem');
    const indice = Number.parseInt(c.req.param('indice'), 10);
    const resposta = await comTransacao(banco, async (cliente) => {
      const mensagem = await agenteRepo.obterMensagem(cliente, id, { travar: true });
      if (!mensagem || mensagem.autor !== 'agente') throw new ErroDaApi(404, 'resposta_inexistente');
      const artefato = Number.isInteger(indice) ? mensagem.artefatos[indice] : undefined;
      if (!artefato) throw new ErroDaApi(404, 'artefato_inexistente');
      if (artefato.tipo !== 'mapa' || artefato.capitulo === null) throw new ErroDaApi(422, 'sem_lugar', 'Só um mapa de um capítulo tem onde ser salvo (os visuais do capítulo).');
      if (artefato.visual_id !== undefined) throw new ErroDaApi(409, 'ja_salvo', 'Este mapa já foi salvo no capítulo.');
      const { capitulo } = artefato;
      const visualId = await visuaisRepo.criar(cliente, {
        versao_id: capitulo.versao_id, secao_id: capitulo.secao_id, tipo: 'diagrama', alvo: { tipo: 'capitulo' }, pedido: null, substitui: null,
      });
      // Só as âncoras da mesma versão entram (regra do VisualV1); as outras ficam só na conversa.
      const nos = artefato.nos.map((no) => (no.ancora && no.ancora.versao_id !== capitulo.versao_id ? { id: no.id, rotulo: no.rotulo } : no));
      await visuaisRepo.publicar(cliente, visualId, {
        artefato: { tipo: 'mermaid', codigo: artefato.codigo, titulo: artefato.titulo, nos }, diagnosticos: [],
        execucao: { modelo: mensagem.execucao?.modelo ?? 'agente', esforco: mensagem.execucao?.esforco ?? 'medium' },
      });
      // Relê pelo contrato: fora do VisualV1, a transação desfaz.
      await visuaisRepo.obter(cliente, visualId);
      const artefatos: ArtefatoDoAgenteV1[] = mensagem.artefatos.map((item, posicao) => (posicao === indice && item.tipo === 'mapa' ? { ...item, visual_id: visualId } : item));
      await agenteRepo.gravarArtefatos(cliente, id, artefatos);
      return { visual_id: visualId, caminho: `/ler/${capitulo.documento_id}/${capitulo.secao_id}` };
    });
    return c.json(resposta, 201);
  });
}
