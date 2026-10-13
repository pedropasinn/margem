/**
 * Portão da sala de teste: um processo Hono separado da API principal (127.0.0.1:8760 por padrão),
 * feito para ser a ÚNICA coisa exposta à internet (Tailscale Funnel ou Cloudflare Tunnel).
 *
 * Serve só três coisas:
 * 1. o build da web (`web/dist`): os arquivos estáticos e o `index.html` nas rotas `/t/<slug>…`;
 * 2. as rotas do testador, `/api/salas/publico/<slug>/…` (entrar, capa, comentários, respostas);
 * 3. uma lista explícita de rotas de leitura (`ROTAS_DE_LEITURA`), todas GET, cada uma conferindo
 *    que o documento, a versão, o capítulo ou o arquivo pedido pertence à sala da sessão.
 * Todo o resto é 404. A API principal (8730) continua só na tailnet; o portão nunca a chama pela
 * rede: as rotas de arquivo são delegadas a uma instância interna da mesma API, em memória, depois
 * da conferência.
 *
 * Nenhuma ação do testador enfileira job ou chama o Codex: as rotas de escrita daqui só gravam
 * nas tabelas da sala (`sala_testador`, `sala_sessao`, `sala_comentario`, `sala_resposta`).
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { Id, SalaDeTesteV1 } from '@margem/contratos';
import { dentroDaRaiz, ehUlid, raizDoRepositorio } from '../dados.js';
import { comTransacao } from '../db/transacao.js';
import { interpretarJson, LimiteDeEntrada } from '../entrada-json.js';
import { criarApi } from '../http/app.js';
import { arvoreDeSecoes, capitulos, CamadaInexistente, snapshotDoCapitulo, type SnapshotDoCapitulo } from '../http/consultas.js';
import { corpoDoErro, ErroDaApi } from '../http/erros.js';
import { formatacaoDaFonte } from '../http/formatacao-da-fonte.js';
import { lerIlustracoes } from '../http/ilustracoes.js';
import { CacheDeGeometria } from '../geometria/arquivos.js';
import * as documentosRepo from '../repos/documentos.js';
import * as salasRepo from '../repos/salas.js';
import { lerComentario, lerEntrada, lerRespostas, resolverTrecho } from './entrada.js';
import { LIMITE_PADRAO, LimiteDeTentativas } from './limite.js';
import { conferirSenha, hashParaComparacaoVazia, SLUG_VALIDO } from './senha.js';
import {
  cabecalhoDoCookie, cabecalhoQueApaga, DURACAO_PADRAO_MS, lerCookie, NOME_DO_COOKIE, novoCookie,
} from './sessao.js';
import { exigirRecurso } from '../recursos.js';

export interface OpcoesDoPortao {
  banco: pg.Pool;
  /** Chave do HMAC do cookie (`chaveDoPortao()`). */
  chave: Buffer;
  /** Onde está o build da web; `null` desliga os estáticos (testes). */
  raizWeb?: string | null;
  /** IP do cliente; o padrão lê o socket e, atrás de um proxy local, o cabeçalho dele. */
  ipDoPedido?: (c: Context) => string;
  agora?: () => Date;
  limite?: LimiteDeTentativas;
  duracaoSessaoMs?: number;
  novoId?: () => Id;
}

/**
 * A lista explícita do que o leitor pode ler pelo portão. Cada rota tem o seu dono conferido
 * (documento, versão ou capítulo da sala). Mudar esta lista é decisão de segurança: o teste
 * `portao.test.ts` a confere contra o que o portão realmente responde.
 */
export const ROTAS_DE_LEITURA = [
  'GET /api/modos',
  'GET /api/versoes/:versao/secoes',
  'GET /api/versoes/:versao/capitulos/:secao',
  'GET /api/versoes/:versao/geometria',
  'GET /api/versoes/:versao/ilustracoes/:nome',
  'GET /api/assets/:versao/:asset',
  'GET /api/documentos/:documento/original',
] as const;

export const ROTAS_DO_TESTADOR = [
  'GET /api/salas/publico/:slug',
  'POST /api/salas/publico/:slug/entrar',
  'POST /api/salas/publico/:slug/sair',
  'GET /api/salas/publico/:slug/capa',
  'GET /api/salas/publico/:slug/comentarios',
  'POST /api/salas/publico/:slug/comentarios',
  'DELETE /api/salas/publico/:slug/comentarios/:id',
  'GET /api/salas/publico/:slug/respostas',
  'PUT /api/salas/publico/:slug/respostas',
] as const;

const METODOS_DE_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** O corpo de qualquer escrita do testador cabe aqui (respostas longas incluídas). */
const ORCAMENTO_DO_TESTADOR = { bytes: 96 * 1024, profundidade: 8, itens: 256, nos: 4096 };
const MENSAGEM_DE_ENTRADA = 'Não foi possível entrar. Confira a senha e tente de novo.';

const TIPOS: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', wasm: 'application/wasm', bcmap: 'application/octet-stream',
};

async function lerArquivo(caminho: string): Promise<Buffer | null> {
  try {
    if (!(await stat(caminho)).isFile()) return null;
    return await readFile(caminho);
  } catch { return null; }
}

async function lerCorpo(requisicao: Request): Promise<unknown> {
  const declarado = Number.parseInt(requisicao.headers.get('content-length') ?? '', 10);
  if (Number.isInteger(declarado) && declarado > ORCAMENTO_DO_TESTADOR.bytes) throw new ErroDaApi(413, 'corpo_grande_demais');
  const leitor = requisicao.body?.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    if (leitor) for (;;) {
      const lido = await leitor.read();
      if (lido.done) break;
      const value: unknown = lido.value;
      if (!(value instanceof Uint8Array)) throw new Error('Corpo precisa conter bytes.');
      tamanho += value.byteLength;
      if (tamanho > ORCAMENTO_DO_TESTADOR.bytes) { await leitor.cancel(); throw new LimiteDeEntrada('bytes'); }
      partes.push(value);
    }
    return interpretarJson(Buffer.concat(partes).toString('utf8'), ORCAMENTO_DO_TESTADOR);
  } catch (erro) {
    if (erro instanceof LimiteDeEntrada) throw new ErroDaApi(413, 'corpo_grande_demais');
    throw new ErroDaApi(400, 'json_invalido', 'O corpo precisa ser JSON.');
  } finally { leitor?.releaseLock(); }
}

function lerCookieDoPedido(c: Context): string | undefined {
  const cabecalho = c.req.header('cookie');
  if (!cabecalho) return undefined;
  for (const parte of cabecalho.split(';')) {
    const [nome, ...resto] = parte.trim().split('=');
    if (nome === NOME_DO_COOKIE) return resto.join('=');
  }
  return undefined;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * O IP do socket; atrás de um proxy na própria máquina (Funnel, cloudflared), o que ele declara:
 * `CF-Connecting-IP` ou o primeiro de `X-Forwarded-For`. Só se confia no cabeçalho quando o
 * pedido veio do loopback, porque o portão só escuta lá.
 */
export function ipPadrao(c: Context): string {
  let socket = '';
  const ambiente = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  socket = ambiente?.incoming?.socket?.remoteAddress ?? '';
  if (socket === '' || LOOPBACK.has(socket)) {
    const declarado = c.req.header('cf-connecting-ip')?.trim() ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (declarado && declarado.length <= 64 && /^[0-9a-fA-F:.]+$/.test(declarado)) return declarado;
  }
  return socket === '' ? 'desconhecido' : socket;
}

interface Sessao extends salasRepo.SessaoValida { documentos: ReadonlySet<Id> }

/** Só as marcas das camadas de leitura (sem os grifos do leitor), sem as notas e conversas dele. */
function snapshotDaSala(snapshot: SnapshotDoCapitulo): SnapshotDoCapitulo {
  const camadas = new Set(snapshot.camadas.map((camada) => camada.id));
  return {
    ...snapshot,
    marcas: snapshot.marcas.filter((marca) => camadas.has(marca.camada_id)),
    anotacoes: [], conexoes: [], conversas: [], etiquetas: [], revisoes_pendentes: [], edicoes: {},
    primeiro_eu: { ativo: false, liberado: true },
  };
}

export function criarPortao(opcoes: OpcoesDoPortao): Hono {
  const { banco, chave } = opcoes;
  const agora = opcoes.agora ?? (() => new Date());
  const limite = opcoes.limite ?? new LimiteDeTentativas(LIMITE_PADRAO);
  const duracao = opcoes.duracaoSessaoMs ?? DURACAO_PADRAO_MS;
  const novoId = opcoes.novoId ?? (() => ulid());
  const ipDoPedido = opcoes.ipDoPedido ?? ipPadrao;
  const raizWeb = opcoes.raizWeb === undefined ? join(raizDoRepositorio(), 'web/dist') : opcoes.raizWeb;
  const geometrias = new CacheDeGeometria(16 * 1024 * 1024);
  // A API inteira, em memória, só para as rotas de arquivo já conferidas. Nada de leitura nem
  // compreensão: o portão nunca a usa para escrever, e uma configuração ausente falha alto.
  const interna = criarApi({ banco, leitura: () => { throw new Error('O portão não inicia leituras.'); } });
  const portao = new Hono();

  portao.onError((erro, c) => {
    const { status, corpo } = corpoDoErro(erro);
    return c.json(corpo, status);
  });

  // Cabeçalhos de segurança em tudo; as respostas da API nunca ficam em cache compartilhado.
  portao.use('*', async (c, proximo) => {
    await proximo();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    if (c.req.path.startsWith('/api/') && !c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  // Escritas: mesmo site (Origin igual ao Host, Sec-Fetch-Site não cross-site) e o cabeçalho X-Margem.
  portao.use('/api/*', async (c, proximo) => {
    if (METODOS_DE_ESCRITA.has(c.req.method)) {
      const origem = c.req.header('origin');
      const host = c.req.header('host') ?? new URL(c.req.url).host;
      let mesmaOrigem = origem === undefined;
      if (origem !== undefined) { try { mesmaOrigem = new URL(origem).host === host; } catch { mesmaOrigem = false; } }
      if (!mesmaOrigem || c.req.header('sec-fetch-site') === 'cross-site') throw new ErroDaApi(403, 'origem_recusada');
      if ((c.req.header('x-margem') ?? '').trim() === '') throw new ErroDaApi(403, 'cabecalho_ausente');
    }
    await proximo();
  });

  async function sessaoDoPedido(c: Context): Promise<Sessao | null> {
    const cookie = lerCookie(chave, lerCookieDoPedido(c));
    if (!cookie) return null;
    const sessao = await comTransacao(banco, (cliente) => salasRepo.lerSessao(cliente, cookie.sessaoId, cookie.segredoSha256, agora()));
    return sessao ? { ...sessao, documentos: new Set(sessao.sala.documentos) } : null;
  }

  async function exigirSessao(c: Context): Promise<Sessao> {
    const sessao = await sessaoDoPedido(c);
    // Sem sessão o portão é mudo: 404 igual ao de uma rota que não existe.
    if (!sessao) throw new ErroDaApi(404, 'nao_encontrado');
    return sessao;
  }

  /** Sessão da sala do link: o cookie de outra sala não vale aqui. */
  async function exigirSessaoDaSala(c: Context): Promise<Sessao> {
    const sessao = await exigirSessao(c);
    if (sessao.sala.slug !== c.req.param('slug')) throw new ErroDaApi(404, 'nao_encontrado');
    return sessao;
  }

  async function exigirVersaoDaSala(sessao: Sessao, versaoId: string): Promise<{ documento_id: Id }> {
    if (!ehUlid(versaoId)) throw new ErroDaApi(404, 'nao_encontrado');
    const linha = (await banco.query<{ documento_id: Id }>('SELECT documento_id FROM versao_texto WHERE id=$1', [versaoId])).rows[0];
    if (!linha || !sessao.documentos.has(linha.documento_id)) throw new ErroDaApi(404, 'nao_encontrado');
    return linha;
  }

  function resumoPublico(sala: SalaDeTesteV1): { titulo: string; aberta: boolean } {
    return { titulo: sala.titulo, aberta: salasRepo.salaAberta(sala, agora()) };
  }

  // ------------------------------------------------------------------ testador

  portao.get('/api/salas/publico/:slug', async (c) => {
    const slug = c.req.param('slug');
    const ip = `ip:${ipDoPedido(c)}`;
    if (!SLUG_VALIDO.test(slug) || limite.bloqueado([ip])) throw new ErroDaApi(404, 'nao_encontrado');
    const guardada = await comTransacao(banco, (cliente) => salasRepo.porSlug(cliente, slug));
    if (!guardada) { limite.registrarFalha([ip]); throw new ErroDaApi(404, 'nao_encontrado'); }
    const sessao = await sessaoDoPedido(c);
    return c.json({ sala: resumoPublico(guardada.sala), dentro: sessao?.sala.id === guardada.sala.id });
  });

  portao.post('/api/salas/publico/:slug/entrar', async (c) => {
    const slug = c.req.param('slug');
    const chaves = [`ip:${ipDoPedido(c)}`, `sala:${slug}`];
    const muitas = () => new ErroDaApi(429, 'muitas_tentativas', 'Muitas tentativas. Espere alguns minutos e tente de novo.');
    if (limite.bloqueado(chaves)) throw muitas();
    const entrada = lerEntrada(await lerCorpo(c.req.raw));
    // Conferir e reservar sem `await` no meio: a tentativa conta antes do scrypt, e uma rajada
    // simultânea não passa do teto. Quem acerta devolve a reserva.
    if (limite.bloqueado(chaves)) throw muitas();
    const devolver = limite.reservar(chaves);
    const guardada = SLUG_VALIDO.test(slug) ? await comTransacao(banco, (cliente) => salasRepo.porSlug(cliente, slug)) : null;
    // Sala inexistente gasta o mesmo scrypt: o tempo da resposta não diz se o link existe.
    const confere = await conferirSenha(entrada.senha, guardada?.senha_hash ?? await hashParaComparacaoVazia());
    if (!guardada || !confere) throw new ErroDaApi(401, 'entrada_recusada', MENSAGEM_DE_ENTRADA);
    devolver();
    if (!salasRepo.salaAberta(guardada.sala, agora())) throw new ErroDaApi(403, 'sala_fechada', 'Esta sala de teste está fechada.');
    limite.limpar(chaves[0] ?? '');
    const fim = new Date(Math.min(agora().getTime() + duracao,
      guardada.sala.expira_em === null ? Number.POSITIVE_INFINITY : Date.parse(guardada.sala.expira_em)));
    const sessaoId = novoId();
    const cookie = novoCookie(chave, sessaoId);
    const testador = await comTransacao(banco, async (cliente) => {
      const quem = await salasRepo.entrarTestador(cliente, guardada.sala.id, novoId(), entrada.nome, entrada.email);
      await salasRepo.criarSessao(cliente, { id: sessaoId, sala_id: guardada.sala.id, testador_id: quem.id, segredo_sha256: cookie.segredoSha256, expira_em: fim });
      return quem;
    });
    c.header('Set-Cookie', cabecalhoDoCookie(cookie.valor, (fim.getTime() - agora().getTime()) / 1000));
    return c.json({ sala: resumoPublico(guardada.sala), testador: { nome: testador.nome }, expira_em: fim.toISOString() });
  });

  portao.post('/api/salas/publico/:slug/sair', async (c) => {
    const sessao = await sessaoDoPedido(c);
    if (sessao) await comTransacao(banco, (cliente) => salasRepo.encerrarSessao(cliente, sessao.sessao_id));
    c.header('Set-Cookie', cabecalhoQueApaga());
    return c.json({ saiu: true });
  });

  portao.get('/api/salas/publico/:slug/capa', async (c) => {
    const sessao = await exigirSessaoDaSala(c);
    const { sala, testador } = sessao;
    const dados = await comTransacao(banco, async (cliente) => {
      const linhas = (await cliente.query<{ id: Id; titulo: string; autor: string | null; formato: string; versao_id: Id | null }>(
        `SELECT d.id, d.titulo, d.autor, d.formato,
            (SELECT v.id FROM versao_texto v WHERE v.documento_id = d.id ORDER BY v.numero DESC LIMIT 1) AS versao_id
           FROM documento d WHERE d.id = ANY($1::text[])`, [sala.documentos])).rows;
      const porId = new Map(linhas.map((linha) => [linha.id, linha]));
      const comentarios = await salasRepo.listarComentarios(cliente, sala.id, { testador_id: testador.id });
      const documentos = [];
      for (const id of sala.documentos) {
        const linha = porId.get(id);
        if (!linha || linha.versao_id === null) continue;
        const versao = await documentosRepo.obterVersao(cliente, linha.versao_id);
        documentos.push({ ...linha, versao_id: linha.versao_id, capitulos: capitulos(versao.canonico).length,
          comentarios: comentarios.filter((comentario) => comentario.documento_id === id).length });
      }
      return { documentos, resposta: await salasRepo.lerResposta(cliente, sala.id, testador.id) };
    });
    return c.json({
      sala: { titulo: sala.titulo, boas_vindas: sala.boas_vindas, expira_em: sala.expira_em, formulario: sala.formulario },
      testador: { nome: testador.nome }, documentos: dados.documentos, resposta: dados.resposta,
    });
  });

  portao.get('/api/salas/publico/:slug/comentarios', async (c) => {
    const sessao = await exigirSessaoDaSala(c);
    const documento = c.req.query('documento');
    if (documento !== undefined && (!ehUlid(documento) || !sessao.documentos.has(documento))) throw new ErroDaApi(404, 'nao_encontrado');
    const comentarios = await comTransacao(banco, (cliente) => salasRepo.listarComentarios(cliente, sessao.sala.id,
      { testador_id: sessao.testador.id, ...(documento === undefined ? {} : { documento_id: documento }) }));
    return c.json({ comentarios });
  });

  portao.post('/api/salas/publico/:slug/comentarios', async (c) => {
    const sessao = await exigirSessaoDaSala(c);
    const pedido = lerComentario(await lerCorpo(c.req.raw));
    const { documento_id: documentoId } = await exigirVersaoDaSala(sessao, pedido.versao_id);
    const comentario = await comTransacao(banco, async (cliente) => {
      const bloco = (await cliente.query<{ texto: string }>('SELECT texto FROM bloco WHERE versao_id=$1 AND id=$2', [pedido.versao_id, pedido.bloco_id])).rows[0];
      if (!bloco) throw new ErroDaApi(404, 'nao_encontrado');
      const trecho = resolverTrecho(bloco, pedido);
      return salasRepo.criarComentario(cliente, {
        id: novoId(), sala_id: sessao.sala.id, testador_id: sessao.testador.id, documento_id: documentoId,
        versao_id: pedido.versao_id, bloco_id: pedido.bloco_id, ...trecho, citacao: pedido.citacao, texto: pedido.texto,
      });
    });
    return c.json({ comentario }, 201);
  });

  portao.delete('/api/salas/publico/:slug/comentarios/:id', async (c) => {
    const sessao = await exigirSessaoDaSala(c);
    const id = c.req.param('id');
    if (!ehUlid(id) || !(await comTransacao(banco, (cliente) => salasRepo.apagarComentario(cliente, sessao.sala.id, sessao.testador.id, id)))) {
      throw new ErroDaApi(404, 'nao_encontrado');
    }
    return c.json({ comentario_id: id, apagado: true });
  });

  portao.get('/api/salas/publico/:slug/respostas', async (c) => {
    const sessao = await exigirSessaoDaSala(c);
    return c.json({ resposta: await comTransacao(banco, (cliente) => salasRepo.lerResposta(cliente, sessao.sala.id, sessao.testador.id)) });
  });

  portao.put('/api/salas/publico/:slug/respostas', async (c) => {
    const sessao = await exigirSessaoDaSala(c);
    const corpo = await lerCorpo(c.req.raw);
    const resposta = await comTransacao(banco, async (cliente) => {
      const atual = await salasRepo.lerResposta(cliente, sessao.sala.id, sessao.testador.id);
      const pedido = lerRespostas(corpo, sessao.sala.formulario, sessao.sala.documentos, atual?.estado === 'enviada');
      return salasRepo.gravarResposta(cliente, sessao.sala.id, sessao.testador.id, pedido, pedido.enviar);
    });
    return c.json({ resposta });
  });

  // ------------------------------------------------------------------ leitura (ROTAS_DE_LEITURA)

  portao.get('/api/modos', async (c) => { await exigirSessao(c); return interna.fetch(new Request('http://127.0.0.1/api/modos')); });

  portao.get('/api/versoes/:versao/secoes', async (c) => {
    const sessao = await exigirSessao(c);
    const versaoId = c.req.param('versao');
    await exigirVersaoDaSala(sessao, versaoId);
    const versao = await comTransacao(banco, (cliente) => documentosRepo.obterVersao(cliente, versaoId));
    return c.json({
      versao_id: versao.id, documento_id: versao.documento_id, titulo: versao.canonico.documento.titulo,
      secoes: arvoreDeSecoes(versao.canonico.secoes),
      capitulos: capitulos(versao.canonico).map((secao) => ({ id: secao.id, titulo: secao.titulo })),
      limites: versao.canonico.limites,
    });
  });

  portao.get('/api/versoes/:versao/capitulos/:secao', async (c) => {
    const sessao = await exigirSessao(c);
    const versaoId = c.req.param('versao');
    const secaoId = c.req.param('secao');
    await exigirVersaoDaSala(sessao, versaoId);
    if (!ehUlid(secaoId)) throw new ErroDaApi(404, 'nao_encontrado');
    const bruta = c.req.query('camada');
    if (bruta !== undefined && bruta !== '' && bruta !== 'todas' && !ehUlid(bruta)) throw new ErroDaApi(404, 'nao_encontrado');
    const camada = bruta === undefined || bruta === '' ? undefined : bruta;
    const snapshot = await comTransacao(banco, (cliente) => snapshotDoCapitulo(
      cliente, versaoId, secaoId, (versao, asset) => `/api/assets/${versao}/${asset}`, camada,
      async (documentoId, versao) => (await geometrias.ler(documentoId, versao))?.paginas.length ?? null,
      undefined, { ignorarPrimeiroEu: true }))
      .catch((erro: unknown) => {
        if (erro instanceof CamadaInexistente) throw new ErroDaApi(404, 'nao_encontrado');
        throw erro;
      });
    if (!snapshot) throw new ErroDaApi(404, 'nao_encontrado');
    const ilustracoes = (await lerIlustracoes(snapshot.documento_id, versaoId))
      .filter((figura) => snapshot.blocos.some((bloco) => bloco.id === figura.bloco_id))
      .map(({ arquivo, ...figura }) => ({ ...figura, url: `/api/versoes/${versaoId}/ilustracoes/${arquivo}` }));
    const formatacao = await formatacaoDaFonte(snapshot.documento_id, versaoId, snapshot.blocos);
    return c.json({ ...snapshotDaSala(snapshot), ilustracoes, formatacao });
  });

  /** Delega à API interna, só com os cabeçalhos de cache e faixa: nenhum cookie nem Origin passa. */
  async function delegar(c: Context): Promise<Response> {
    const url = new URL(c.req.url);
    const cabecalhos = new Headers();
    for (const nome of ['range', 'if-range', 'if-none-match']) { const valor = c.req.header(nome); if (valor !== undefined) cabecalhos.set(nome, valor); }
    const resposta = await interna.fetch(new Request(`http://127.0.0.1${url.pathname}${url.search}`, { headers: cabecalhos }));
    // Erro interno vira o 404 mudo do portão (sem detalhe que diga o que existe do outro lado).
    if (resposta.status >= 400 && resposta.status !== 416) return c.json({ erro: 'nao_encontrado' }, 404);
    return resposta;
  }

  portao.get('/api/versoes/:versao/geometria', async (c) => {
    await exigirVersaoDaSala(await exigirSessao(c), c.req.param('versao'));
    return delegar(c);
  });

  portao.get('/api/versoes/:versao/ilustracoes/:nome', async (c) => {
    await exigirVersaoDaSala(await exigirSessao(c), c.req.param('versao'));
    return delegar(c);
  });

  portao.get('/api/assets/:versao/:asset', async (c) => {
    await exigirVersaoDaSala(await exigirSessao(c), c.req.param('versao'));
    if (!ehUlid(c.req.param('asset'))) throw new ErroDaApi(404, 'nao_encontrado');
    return delegar(c);
  });

  portao.get('/api/documentos/:documento/original', async (c) => {
    const sessao = await exigirSessao(c);
    const documento = c.req.param('documento');
    if (!ehUlid(documento) || !sessao.documentos.has(documento)) throw new ErroDaApi(404, 'nao_encontrado');
    return delegar(c);
  });

  // Qualquer outra rota da API: 404, com ou sem sessão.
  portao.all('/api/*', (c) => c.json({ erro: 'nao_encontrado' }, 404));

  // ------------------------------------------------------------------ estáticos

  portao.get('*', async (c) => {
    if (raizWeb === null) return c.text('Não encontrado.', 404);
    let caminho: string;
    try { caminho = decodeURIComponent(new URL(c.req.url).pathname); } catch { return c.text('Não encontrado.', 404); }
    // A página da sala: o index.html em `/t/<slug>` e abaixo.
    if (/^\/t\/[a-z0-9-]+(?:\/.*)?$/.test(caminho)) {
      const indice = await lerArquivo(join(raizWeb, 'index.html'));
      if (indice === null) return c.text('A interface ainda não foi construída (npm run build --workspace web).', 503);
      c.header('Content-Type', TIPOS.html ?? 'text/html');
      c.header('Cache-Control', 'no-store');
      return c.body(new Uint8Array(indice));
    }
    if (caminho === '/' || caminho.endsWith('/') || caminho.endsWith('index.html')) return c.text('Não encontrado.', 404);
    const alvo = dentroDaRaiz(raizWeb, caminho.slice(1));
    const bytes = alvo === null ? null : await lerArquivo(alvo);
    if (alvo === null || bytes === null) return c.text('Não encontrado.', 404);
    c.header('Content-Type', TIPOS[alvo.slice(alvo.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream');
    c.header('Cache-Control', caminho.startsWith('/assets/') ? 'public, max-age=604800, immutable' : 'no-cache');
    return c.body(new Uint8Array(bytes));
  });

  return portao;
}

/** Processo do portão: `npm run portao`. Não roda migração (quem migra é a API, J090). */
export async function principal(): Promise<void> {
  // Salas de teste: recurso pessoal, desligado numa instalação nova (J102).
  exigirRecurso('sala');
  const [{ serve }, { pool }, { chaveDoPortao }, { enderecoDoPortao, portaDoPortao }] = await Promise.all([
    import('@hono/node-server'), import('../db/conexao.js'), import('./sessao.js'), import('./configuracao.js'),
  ]);
  const anotar = (evento: string, detalhe?: string) => { console.log(JSON.stringify({ evento, ...(detalhe ? { detalhe } : {}) })); };
  const tabela = (await pool.query<{ existe: boolean }>("SELECT to_regclass('public.sala') IS NOT NULL AS existe")).rows[0];
  if (!tabela?.existe) throw new Error('A migração 0018 (salas de teste) ainda não foi aplicada: suba a API uma vez antes do portão.');
  const portao = criarPortao({ banco: pool, chave: chaveDoPortao((mensagem) => anotar('portao_aviso', mensagem)) });
  const endereco = enderecoDoPortao();
  const servidor = serve({ fetch: portao.fetch, hostname: endereco, port: portaDoPortao() }, (info) => {
    anotar('portao_no_ar', `http://${endereco}:${String(info.port)}`);
  });
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sinal, () => { servidor.close(() => { void pool.end().finally(() => process.exit(0)); }); });
  }
}

const caminhoDoProcesso = process.argv[1] ?? '';
if (caminhoDoProcesso.endsWith('src/sala/portao.ts') || caminhoDoProcesso.endsWith('src/sala/portao.js')) {
  principal().catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : 'falha desconhecida no portão');
    process.exitCode = 1;
  });
}
