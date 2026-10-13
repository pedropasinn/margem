/**
 * Portão da sala de teste contra um Postgres de teste (`margem_test_*`, criado e destruído aqui):
 * entrada com senha, limite de tentativas, sessão, a lista de rotas de leitura negando tudo fora
 * da sala, comentários, formulário, o relatório do dono e o CSV. Executor nenhum: a API interna
 * recusa leituras, e o teste confere que nenhum job nasce de uma ação do testador.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type pg from 'pg';
import { afterAll, expect, test } from 'vitest';
import { validarComentarioDaSala, validarRespostaDaSala, validarSalaDeTeste, type Bloco, type SalaDeTesteV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarApi } from '../http/app.js';
import { importarMarcasLegado } from '../leitura/importar.js';
import * as documentos from '../repos/documentos.js';
import { LimiteDeTentativas } from './limite.js';
import { criarPortao, ROTAS_DE_LEITURA } from './portao.js';

const SENHA = 'senha-de-teste-1';
const raizWeb = mkdtempSync(join(tmpdir(), 'margem-portao-web-'));
mkdirSync(join(raizWeb, 'assets'));
writeFileSync(join(raizWeb, 'index.html'), '<!doctype html><title>Margem</title><div id="raiz"></div>');
writeFileSync(join(raizWeb, 'assets', 'app-1234.js'), 'console.log(1)');
afterAll(() => { rmSync(raizWeb, { recursive: true, force: true }); });

interface Cenario {
  banco: pg.Pool; api: Hono; portao: Hono; relogio: { agora: number };
  sala: SalaDeTesteV1; outraSala: SalaDeTesteV1;
  a: { documento: string; versao: string; capitulos: string[]; blocos: Bloco[] };
  b: { documento: string; versao: string };
  c: { documento: string; versao: string; capitulos: string[] };
}

async function documento(banco: pg.Pool, titulo: string, sha: string, blocos: { tipo: Bloco['tipo']; texto: string }[], secoes: { nivel: number; inicio: number; fim: number }[]) {
  const canonico = canonicoDeTeste({ titulo, blocos, secoes });
  canonico.documento.sha256_original = sha.repeat(64);
  return comTransacao(banco, async (cliente) => {
    const doc = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: `${titulo}.md` });
    const versao = await documentos.criarVersao(cliente, doc.id, canonico);
    return { documento: doc.id, versao: versao.id, capitulos: canonico.secoes.map((secao) => secao.id), blocos: canonico.blocos };
  });
}

function escrita(corpo: unknown, cookie?: string, extra: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Margem': '1', ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: JSON.stringify(corpo) };
}

async function montar(banco: pg.Pool, limite?: LimiteDeTentativas): Promise<Cenario> {
  const a = await documento(banco, 'Ensaio da sala', 'a', [
    { tipo: 'capitulo', texto: 'Primeiro' },
    { tipo: 'paragrafo', texto: 'A razão comum basta para ver que a ordem pede explicação. A ordem pede.' },
    { tipo: 'capitulo', texto: 'Segundo' },
    { tipo: 'paragrafo', texto: 'Toda explicação termina em algo que não se explica.' },
  ], [{ nivel: 1, inicio: 0, fim: 1 }, { nivel: 1, inicio: 2, fim: 3 }]);
  const b = await documento(banco, 'Outro da sala', 'b', [{ tipo: 'paragrafo', texto: 'Texto curto.' }], []);
  const c = await documento(banco, 'Diário do leitor', 'c', [{ tipo: 'capitulo', texto: 'Segredo' }, { tipo: 'paragrafo', texto: 'Só do leitor.' }], [{ nivel: 1, inicio: 0, fim: 1 }]);
  // Marcas publicadas da IA (camada de importação) e, por cima, o grifo e a nota do leitor.
  await importarMarcasLegado(banco, a.versao, {
    capitulo: '1', leitura_integral: true, limites: [], recuperacao: [],
    marcas: [{ id: 'm01', pagina_pdf: 1, funcao: 'tese', citacao: 'A razão comum basta', sublinhar: [],
      comentario: { tipo: 'AUTOR', rotulo: 'AUTOR · TESE', texto: 'A razão comum é suficiente.' } }],
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20, recursos: new Set(['sala'] as const) });
  const bloco = a.blocos[1]!;
  const ancora = (citacao: string) => {
    const inicio = bloco.texto.indexOf(citacao);
    return { versao_id: a.versao, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao,
      prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length) };
  };
  expect((await api.request('/api/grifos', escrita({ ancora: ancora('pede explicação'), funcao: 'tese' }))).status).toBe(201);
  expect((await api.request('/api/anotacoes', escrita({ ancora: ancora('ordem'), tipo: 'nota', texto: 'Nota íntima do leitor.' }))).status).toBe(201);

  const criada = await api.request('/api/salas', escrita({ titulo: 'Beta · rodada 1', boas_vindas: 'Obrigado!', documentos: [a.documento, b.documento], senha: SENHA }));
  expect(criada.status).toBe(201);
  const { sala, senha } = await criada.json() as { sala: SalaDeTesteV1; senha: string };
  expect(senha).toBe(SENHA);
  expect(validarSalaDeTeste(sala), JSON.stringify(validarSalaDeTeste.errors)).toBe(true);
  const outra = await api.request('/api/salas', escrita({ titulo: 'Outra sala', documentos: [c.documento] }));
  const { sala: outraSala } = await outra.json() as { sala: SalaDeTesteV1 };
  const relogio = { agora: Date.parse('2026-10-02T12:00:00.000Z') };
  const portao = criarPortao({
    banco, chave: Buffer.alloc(32, 7), raizWeb, agora: () => new Date(relogio.agora),
    ipDoPedido: (ctx) => ctx.req.header('x-ip-de-teste') ?? '10.0.0.1',
    ...(limite ? { limite } : {}),
  });
  return { banco, api, portao, relogio, sala, outraSala, a, b, c };
}

async function entrar(portao: Hono, slug: string, nome = 'Ana', senha = SENHA, ip = '10.0.0.1'): Promise<{ resposta: Response; cookie: string }> {
  const resposta = await portao.request(`/api/salas/publico/${slug}/entrar`, escrita({ nome, senha }, undefined, { 'x-ip-de-teste': ip }));
  const cabecalho = resposta.headers.get('set-cookie') ?? '';
  return { resposta, cookie: cabecalho.split(';')[0] ?? '' };
}

const jobs = async (banco: pg.Pool) => Number((await banco.query<{ n: string }>('SELECT count(*) AS n FROM job')).rows[0]?.n);

test('entrada, sessão e a lista de rotas de leitura: nada fora da sala, nada sem sessão', async () => comBanco('sala_portao', async (banco) => {
  const { portao, sala, outraSala, a, b, c, relogio } = await montar(banco);
  const jobsAntes = await jobs(banco);

  // A tela de entrada conhece o título; link inexistente é 404.
  const publico = await portao.request(`/api/salas/publico/${sala.slug}`);
  expect(publico.status).toBe(200);
  expect(await publico.json()).toEqual({ sala: { titulo: 'Beta · rodada 1', aberta: true }, dentro: false });
  expect((await portao.request('/api/salas/publico/naoexiste99')).status).toBe(404);

  // Senha errada: mensagem genérica, sem cookie.
  const errada = await entrar(portao, sala.slug, 'Ana', 'senha-errada-123');
  expect(errada.resposta.status).toBe(401);
  expect(await errada.resposta.json()).toEqual({ erro: 'entrada_recusada', detalhe: 'Não foi possível entrar. Confira a senha e tente de novo.' });
  expect(errada.resposta.headers.get('set-cookie')).toBeNull();
  const inexistente = await entrar(portao, 'naoexiste99');
  expect(inexistente.resposta.status).toBe(401);

  // Senha certa: cookie HttpOnly, Secure, SameSite=Lax, com expiração.
  const { resposta, cookie } = await entrar(portao, sala.slug);
  expect(resposta.status).toBe(200);
  const setCookie = resposta.headers.get('set-cookie') ?? '';
  expect(setCookie).toMatch(/^margem_sala=[0-7][0-9A-HJKMNP-TV-Z]{25}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=259200; HttpOnly; Secure; SameSite=Lax$/);

  const rotasReais = (sessao: { versao: string; documento: string; capitulo: string }) => [
    '/api/modos',
    `/api/versoes/${sessao.versao}/secoes`,
    `/api/versoes/${sessao.versao}/capitulos/${sessao.capitulo}`,
    `/api/versoes/${sessao.versao}/geometria?paginas=1-2`,
    `/api/versoes/${sessao.versao}/ilustracoes/figura.png`,
    `/api/assets/${sessao.versao}/${sessao.capitulo}`,
    `/api/documentos/${sessao.documento}/original`,
  ];
  // Uma rota real por item da lista explícita (a lista e o teste andam juntos).
  expect(rotasReais({ versao: a.versao, documento: a.documento, capitulo: a.capitulos[0]! })).toHaveLength(ROTAS_DE_LEITURA.length);

  // Sem sessão: tudo 404, inclusive a lista explícita e a capa.
  for (const rota of [...rotasReais({ versao: a.versao, documento: a.documento, capitulo: a.capitulos[0]! }), `/api/salas/publico/${sala.slug}/capa`,
    `/api/salas/publico/${sala.slug}/respostas`, `/api/salas/publico/${sala.slug}/comentarios`]) {
    expect((await portao.request(rota)).status, rota).toBe(404);
  }
  // Cookie forjado ou adulterado: 404.
  const [id, segredo] = cookie.replace('margem_sala=', '').split('.');
  for (const falso of [`margem_sala=${id ?? ''}.${segredo ?? ''}.${'A'.repeat(43)}`, `margem_sala=${id ?? ''}.${'B'.repeat(43)}.x`, 'margem_sala=lixo']) {
    expect((await portao.request(`/api/salas/publico/${sala.slug}/capa`, { headers: { Cookie: falso } })).status).toBe(404);
  }

  const comCookie = (rota: string, init: RequestInit = {}) => portao.request(rota, { ...init, headers: { Cookie: cookie, ...(init.headers as Record<string, string> | undefined) } });
  // Capa: só os documentos da sala.
  const capa = await (await comCookie(`/api/salas/publico/${sala.slug}/capa`)).json() as { documentos: { id: string; capitulos: number }[]; testador: { nome: string } };
  expect(capa.documentos.map((d) => d.id)).toEqual([a.documento, b.documento]);
  expect(capa.documentos[0]?.capitulos).toBe(2);
  expect(capa.testador.nome).toBe('Ana');

  // Leitura da sala: secoes e capítulo respondem; só as marcas da IA, sem nada do leitor.
  expect((await comCookie(`/api/versoes/${a.versao}/secoes`)).status).toBe(200);
  const capitulo = await comCookie(`/api/versoes/${a.versao}/capitulos/${a.capitulos[0]!}`);
  expect(capitulo.status).toBe(200);
  const snapshot = await capitulo.json() as { marcas: { origem: string; comentario: { texto: string } | null }[]; anotacoes: unknown[]; conversas: unknown[] };
  expect(snapshot.marcas.map((m) => m.origem)).toEqual(['importacao']);
  expect(snapshot.marcas[0]?.comentario?.texto).toBe('A razão comum é suficiente.');
  expect(snapshot.anotacoes).toEqual([]);
  expect(JSON.stringify(snapshot)).not.toContain('Nota íntima do leitor');
  expect((await comCookie(`/api/versoes/${a.versao}/capitulos/${a.capitulos[0]!}?camada=todas`)).status).toBe(200);
  expect((await comCookie(`/api/versoes/${a.versao}/capitulos/${a.capitulos[0]!}?camada=${a.capitulos[0]!}`)).status).toBe(404);
  expect((await comCookie(`/api/versoes/${a.versao}/capitulos/${a.capitulos[0]!}?camada=..%2F`)).status).toBe(404);
  expect((await comCookie(`/api/versoes/${b.versao}/secoes`)).status).toBe(200);
  expect((await comCookie('/api/modos')).status).toBe(200);

  // Fora da sala: cada rota da lista com o documento de fora é 404.
  for (const rota of rotasReais({ versao: c.versao, documento: c.documento, capitulo: c.capitulos[0]! }).slice(1)) {
    expect((await comCookie(rota)).status, rota).toBe(404);
  }
  // Travessia de caminho nos arquivos.
  for (const rota of [
    `/api/versoes/${a.versao}/ilustracoes/..%2F..%2F..%2F.config%2Fmargem%2Fpostgres.env`,
    `/api/versoes/${a.versao}/ilustracoes/%2e%2e%2f%2e%2e%2fcanonico.json`,
    `/api/assets/${a.versao}/..%2F..%2Fetc%2Fpasswd`,
    `/api/assets/..%2F${a.versao}/${a.capitulos[0]!}`,
    `/api/documentos/..%2F..%2F${c.documento}/original`,
    `/api/versoes/${a.versao}/geometria?paginas=1-9999`,
  ]) expect((await comCookie(rota)).status, rota).toBe(404);

  // Rotas da API principal que não estão na lista: 404 com sessão, sem efeito.
  for (const [metodo, rota] of [
    ['GET', '/api/documentos'], ['GET', `/api/documentos/${a.documento}`], ['GET', '/api/estado'], ['GET', '/api/eventos'],
    ['GET', '/api/execucoes/ativas'], ['GET', '/api/salas'], ['GET', `/api/salas/${sala.id}/respostas`], ['GET', `/api/salas/${sala.id}/respostas.csv`],
    ['GET', '/api/perfil'], ['GET', `/api/documentos/${a.documento}/progresso`], ['GET', `/api/documentos/${a.documento}/obsidian.md`],
    ['GET', '/api/obsidian/exportacao.zip'], ['GET', `/api/versoes/${a.versao}/etiquetas`], ['GET', `/api/documentos/${a.documento}/compreensoes`],
    ['POST', `/api/documentos/${a.documento}/leituras`], ['POST', '/api/grifos'], ['POST', '/api/anotacoes'], ['POST', '/api/conversas'],
    ['POST', '/api/documentos'], ['POST', '/api/importacoes/web'], ['PATCH', `/api/marcas/${a.capitulos[0]!}`], ['POST', '/api/salas'],
    ['DELETE', `/api/salas/${sala.id}`], ['PUT', `/api/documentos/${a.documento}/progresso`],
  ] as const) {
    const pedido = await comCookie(rota, { method: metodo, headers: { 'X-Margem': '1', 'Content-Type': 'application/json' }, ...(metodo === 'GET' ? {} : { body: '{}' }) });
    expect(pedido.status, `${metodo} ${rota}`).toBe(404);
  }

  // O cookie desta sala não abre a outra.
  expect((await comCookie(`/api/salas/publico/${outraSala.slug}/capa`)).status).toBe(404);

  // Estáticos: a página da sala e os assets; nada de índice nem de fuga da raiz.
  const pagina = await portao.request(`/t/${sala.slug}`);
  expect(pagina.status).toBe(200);
  expect(await pagina.text()).toContain('id="raiz"');
  expect((await portao.request(`/t/${sala.slug}/ler/${a.documento}`)).status).toBe(200);
  expect((await portao.request('/assets/app-1234.js')).status).toBe(200);
  for (const rota of ['/', '/index.html', '/biblioteca', '/ler/x', '/%2e%2e/%2e%2e/package.json', '/assets/../index.html', '/assets/%2e%2e%2f%2e%2e%2fservico%2fpackage.json']) {
    expect((await portao.request(rota)).status, rota).toBe(404);
  }

  // A sessão vence com o relógio.
  relogio.agora += 3 * 24 * 60 * 60 * 1000 + 1000;
  expect((await comCookie(`/api/salas/publico/${sala.slug}/capa`)).status).toBe(404);
  expect(await jobs(banco)).toBe(jobsAntes);
}));

test('comentários no trecho e formulário: rascunho, envio, edição; relatório e CSV do dono', async () => comBanco('sala_formulario', async (banco) => {
  const { api, portao, sala, a, b, c } = await montar(banco);
  const jobsAntes = await jobs(banco);
  const { cookie } = await entrar(portao, sala.slug, 'Bruno');
  const base = `/api/salas/publico/${sala.slug}`;
  const bloco = a.blocos[1]!;
  const trecho = (citacao: string, desvio = 0) => {
    const inicio = bloco.texto.indexOf(citacao) + desvio;
    return { versao_id: a.versao, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao, texto: 'Não entendi esta parte.' };
  };

  // Escrita exige X-Margem e mesma origem.
  expect((await portao.request(`${base}/comentarios`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(trecho('razão comum')) })).status).toBe(403);
  expect((await portao.request(`${base}/comentarios`, escrita(trecho('razão comum'), cookie, { Origin: 'https://atacante.exemplo' }))).status).toBe(403);
  expect((await portao.request(`${base}/comentarios`, escrita(trecho('razão comum'), cookie, { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403);

  const criado = await portao.request(`${base}/comentarios`, escrita(trecho('razão comum'), cookie, { Origin: 'http://localhost' }));
  expect(criado.status).toBe(201);
  const { comentario } = await criado.json() as { comentario: unknown };
  expect(validarComentarioDaSala(comentario), JSON.stringify(validarComentarioDaSala.errors)).toBe(true);
  // Intervalo deslocado mas citação única: o serviço resolve. Citação repetida ou ausente: 422.
  const ausente = await portao.request(`${base}/comentarios`, escrita({ ...trecho('razão comum'), citacao: 'termina em algo' }, cookie));
  expect((await ausente.json() as { erro: string }).erro).toBe('citacao_ausente');
  const resolvido = await portao.request(`${base}/comentarios`, escrita({ ...trecho('basta', 3) }, cookie));
  expect(resolvido.status).toBe(201);
  expect((await resolvido.json() as { comentario: { inicio_utf16: number } }).comentario.inicio_utf16).toBe(bloco.texto.indexOf('basta'));
  const ambigua = await portao.request(`${base}/comentarios`, escrita({ ...trecho('ordem pede'), inicio_utf16: 0, fim_utf16: 10 }, cookie));
  expect((await ambigua.json() as { erro: string }).erro).toBe('citacao_ambigua');
  // Documento de fora da sala: 404.
  const blocoDeFora = (await comTransacao(banco, (cliente) => documentos.obterVersao(cliente, c.versao))).canonico.blocos[1]!;
  expect((await portao.request(`${base}/comentarios`, escrita({ versao_id: c.versao, bloco_id: blocoDeFora.id, inicio_utf16: 0, fim_utf16: 3, citacao: 'Só', texto: 'x' }, cookie))).status).toBe(404);
  const meus = await (await portao.request(`${base}/comentarios?documento=${a.documento}`, { headers: { Cookie: cookie } })).json() as { comentarios: { id: string }[] };
  expect(meus.comentarios).toHaveLength(2);
  // Apagar o próprio comentário; o id de outro não existe para ele.
  expect((await portao.request(`${base}/comentarios/${meus.comentarios[1]!.id}`, { method: 'DELETE', headers: { Cookie: cookie, 'X-Margem': '1' } })).status).toBe(200);
  expect((await portao.request(`${base}/comentarios/${meus.comentarios[1]!.id}`, { method: 'DELETE', headers: { Cookie: cookie, 'X-Margem': '1' } })).status).toBe(404);

  // Formulário: rascunho parcial; envio sem obrigatórias é 422; envio completo; edição depois do envio segue exigindo.
  const gravar = (corpo: unknown) => portao.request(`${base}/respostas`, { ...escrita(corpo, cookie), method: 'PUT' });
  const rascunho = await gravar({ geral: { primeira_impressao: 4, o_que_confundiu: 'O ícone da margem.' } });
  expect(rascunho.status).toBe(200);
  const { resposta } = await rascunho.json() as { resposta: unknown };
  expect(validarRespostaDaSala(resposta)).toBe(true);
  expect(resposta).toMatchObject({ estado: 'rascunho', enviada_em: null });
  expect((await gravar({ geral: { primeira_impressao: 9 } })).status).toBe(422);
  expect((await gravar({ geral: { inventada: 'x' } })).status).toBe(422);
  expect((await gravar({ por_documento: { [c.documento]: {} } })).status).toBe(200);
  const incompleto = await gravar({ geral: { primeira_impressao: 4 }, enviar: true });
  expect(incompleto.status).toBe(422);
  expect((await incompleto.json() as { erro: string }).erro).toBe('obrigatorias_sem_resposta');
  const enviado = await gravar({ geral: { primeira_impressao: 4, marcas_ajudaram: 5, usaria_de_novo: 'Talvez', o_que_faltou: '=SOMA(A1)' }, enviar: true });
  expect(enviado.status).toBe(200);
  expect((await enviado.json() as { resposta: { estado: string } }).resposta.estado).toBe('enviada');
  expect((await gravar({ geral: { primeira_impressao: 5 } })).status).toBe(422);
  expect((await gravar({ geral: { primeira_impressao: 5, marcas_ajudaram: 5, usaria_de_novo: 'Sim', o_que_faltou: '=SOMA(A1)' } })).status).toBe(200);

  // Segunda testadora, só rascunho: não entra nas médias.
  const { cookie: outro } = await entrar(portao, sala.slug, 'Carla', SENHA, '10.0.0.2');
  expect((await portao.request(`${base}/respostas`, { ...escrita({ geral: { primeira_impressao: 1 } }, outro), method: 'PUT' })).status).toBe(200);
  // A mesma pessoa (mesmo nome) entrando de novo retoma o rascunho.
  const { cookie: deNovo } = await entrar(portao, sala.slug, '  carla ', SENHA, '10.0.0.3');
  const retomada = await (await portao.request(`${base}/respostas`, { headers: { Cookie: deNovo } })).json() as { resposta: { geral: Record<string, unknown> } };
  expect(retomada.resposta.geral).toEqual({ primeira_impressao: 1 });

  // O leitor vê respostas, médias (só enviadas), escolhas e comentários com o capítulo.
  const relatorio = await (await api.request(`/api/salas/${sala.id}/respostas`)).json() as {
    testadores: { nome: string; resposta: { estado: string } | null }[];
    medias: { geral: Record<string, { media: number | null; respostas: number }> };
    escolhas: { geral: Record<string, Record<string, number>> };
    comentarios: { testador: string; secao_id: string | null; citacao: string; documento_titulo: string }[];
  };
  expect(relatorio.testadores.map((t) => [t.nome, t.resposta?.estado ?? null])).toEqual([['Bruno', 'enviada'], ['carla', 'rascunho']]);
  expect(relatorio.medias.geral.primeira_impressao).toEqual({ media: 5, respostas: 1 });
  expect(relatorio.escolhas.geral.usaria_de_novo).toEqual({ Sim: 1, Talvez: 0, Não: 0 });
  expect(relatorio.comentarios).toEqual([expect.objectContaining({ testador: 'Bruno', citacao: 'razão comum', secao_id: a.capitulos[0], documento_titulo: 'Ensaio da sala' })]);

  const csv = await api.request(`/api/salas/${sala.id}/respostas.csv`);
  expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  expect(csv.headers.get('content-disposition')).toBe('attachment; filename="beta-rodada-1-respostas.csv"');
  const bytes = Buffer.from(await csv.arrayBuffer());
  // BOM UTF-8 na frente (o Excel abre com acentos); `Response.text()` o engoliria.
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const texto = bytes.subarray(3).toString('utf8');
  expect(texto.startsWith('Nome,E-mail,Estado,')).toBe(true);
  expect(texto).toContain("'=SOMA(A1)");
  expect(texto.split('\r\n').filter((linha) => linha !== '')).toHaveLength(3);
  const csvComentarios = await (await api.request(`/api/salas/${sala.id}/comentarios.csv`)).text();
  expect(csvComentarios).toContain('Bruno,Ensaio da sala,razão comum,Não entendi esta parte.');
  expect(b.documento).toBeDefined();
  expect(await jobs(banco)).toBe(jobsAntes);
}));

test('limite de tentativas por IP e por sala; sala fechada, senha trocada e saída encerram a sessão', async () => comBanco('sala_limite', async (banco) => {
  const { api, portao, sala } = await montar(banco, new LimiteDeTentativas({ maximo: 10, janelaMs: 15 * 60 * 1000 }));
  // Dez erros do mesmo IP: a 11ª tentativa, mesmo certa, é recusada.
  for (let i = 0; i < 10; i++) expect((await entrar(portao, sala.slug, 'Ana', 'errada-errada', '10.9.9.9')).resposta.status).toBe(401);
  const bloqueada = await entrar(portao, sala.slug, 'Ana', SENHA, '10.9.9.9');
  expect(bloqueada.resposta.status).toBe(429);
  expect(bloqueada.cookie).toBe('');
  // Por sala: com o IP limpo, a sala também bloqueia depois de 10 erros (de IPs diferentes).
  expect((await entrar(portao, sala.slug, 'Ana', SENHA, '10.1.1.1')).resposta.status).toBe(429);

  // Outra sala, outro limite: e a sessão termina quando a sala fecha, a senha muda ou a pessoa sai.
  const { portao: novo, sala: aberta } = await montar(banco);
  const { cookie } = await entrar(novo, aberta.slug);
  const capa = () => novo.request(`/api/salas/publico/${aberta.slug}/capa`, { headers: { Cookie: cookie } });
  expect((await capa()).status).toBe(200);
  const fechar = await api.request(`/api/salas/${aberta.id}`, { ...escrita({ ativa: false }), method: 'PATCH' });
  expect(fechar.status).toBe(200);
  expect((await capa()).status).toBe(404);
  expect(await (await novo.request(`/api/salas/publico/${aberta.slug}`)).json()).toMatchObject({ sala: { aberta: false } });
  expect((await entrar(novo, aberta.slug)).resposta.status).toBe(403);
  await api.request(`/api/salas/${aberta.id}`, { ...escrita({ ativa: true }), method: 'PATCH' });

  const { cookie: segundo } = await entrar(novo, aberta.slug);
  const trocada = await api.request(`/api/salas/${aberta.id}/senha`, escrita({}));
  const { senha: nova } = await trocada.json() as { senha: string };
  expect(nova).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  expect((await novo.request(`/api/salas/publico/${aberta.slug}/capa`, { headers: { Cookie: segundo } })).status).toBe(404);
  expect((await entrar(novo, aberta.slug)).resposta.status).toBe(401);

  const { cookie: terceiro } = await entrar(novo, aberta.slug, 'Ana', nova);
  const saida = await novo.request(`/api/salas/publico/${aberta.slug}/sair`, escrita({}, terceiro));
  expect(saida.headers.get('set-cookie')).toContain('Max-Age=0');
  expect((await novo.request(`/api/salas/publico/${aberta.slug}/capa`, { headers: { Cookie: terceiro } })).status).toBe(404);
}));

test('a API principal recusa sala malformada e documento sem texto', async () => comBanco('sala_admin', async (banco) => {
  const { api, a } = await montar(banco);
  const criar = (corpo: unknown) => api.request('/api/salas', escrita(corpo));
  expect((await criar({ titulo: '', documentos: [a.documento] })).status).toBe(400);
  expect((await criar({ titulo: 'x', documentos: [] })).status).toBe(400);
  expect((await criar({ titulo: 'x', documentos: [a.documento], senha: 'curta' })).status).toBe(400);
  expect((await criar({ titulo: 'x', documentos: [a.documento], senha_hash: 'scrypt$1' })).status).toBe(400);
  expect((await criar({ titulo: 'x', documentos: ['01KZZZZZZZZZZZZZZZZZZZZZZZ'] })).status).toBe(422);
  expect((await criar({ titulo: 'x', documentos: [a.documento], formulario: { versao: 1, geral: [{ id: 'a', tipo: 'escolha', enunciado: 'x', obrigatoria: true }], por_documento: [] } })).status).toBe(400);
  const gerada = await criar({ titulo: 'Sem senha digitada', documentos: [a.documento], expira_em: '2026-12-31T23:59:00-03:00' });
  expect(gerada.status).toBe(201);
  const corpo = await gerada.json() as { sala: SalaDeTesteV1; senha: string; senha_gerada: boolean };
  expect(corpo.senha_gerada).toBe(true);
  expect(corpo.sala.expira_em).toBe('2027-01-01T02:59:00.000Z');
  expect(corpo.sala.formulario.geral.map((p) => p.id)).toContain('primeira_impressao');
  const guardado = (await banco.query<{ senha_hash: string }>('SELECT senha_hash FROM sala WHERE id=$1', [corpo.sala.id])).rows[0]?.senha_hash ?? '';
  expect(guardado).toMatch(/^scrypt\$32768\$8\$1\$/);
  expect(guardado).not.toContain(corpo.senha);
  // A lista do dono nunca devolve o hash.
  const lista = await (await api.request('/api/salas')).text();
  expect(lista).not.toContain('scrypt');
}));

test('rajada simultânea de entradas não passa do teto: a tentativa conta antes do scrypt (auditoria 02/10)', async () => comBanco('sala_rajada', async (banco) => {
  const { portao, sala } = await montar(banco, new LimiteDeTentativas({ maximo: 10, janelaMs: 15 * 60 * 1000 }));
  const respostas = await Promise.all(Array.from({ length: 30 }, (_, i) => entrar(portao, sala.slug, 'Ana', 'errada-errada', `10.7.0.${String(i)}`)));
  expect(respostas.filter(({ resposta }) => resposta.status === 401)).toHaveLength(10);
  expect(respostas.filter(({ resposta }) => resposta.status === 429)).toHaveLength(20);
}), 60_000);
