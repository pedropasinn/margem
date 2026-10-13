/**
 * Prova de resiliência de ponta a ponta (gate 3 do J10).
 *
 * Sobe a API e o worker de verdade — processos separados, Postgres real, executor
 * falso — num banco exclusivo criado e destruído aqui, e dirige o Chromium contra
 * a interface que a própria API serve. O que está sob prova é o critério de F1:
 * dá para ler, confiar nas marcas e retomar mesmo quando o processamento falha.
 *
 *   npm run e2e (recompila a interface antes de executar)
 *
 * Não usa `@playwright/test` (não instalado, e o job não instala pacotes): é um
 * roteiro com código de saída, como os do J08 e do J09.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PORTA = 8732;
const BASE = `http://127.0.0.1:${String(PORTA)}`;
const BANCO = `margem_e2e_${randomUUID().replaceAll('-', '')}`;
const CONTAINER = process.env.MARGEM_PG_CONTAINER ?? 'margem-postgres';
const ESCRITA = { 'X-Margem': '1' };
/** Concessão curta: o job do worker morto volta à fila em segundos, não em um minuto. */
const CONCESSAO_MS = 6_000;
const CELULAR = { width: 412, height: 915 };
const CAPTURAS = fileURLToPath(new URL('./saida/capturas/', import.meta.url));
let bancoCriado: Credenciais | undefined;

const falhas: string[] = [];
const temporarios: string[] = [];
const processos: ChildProcess[] = [];

function anotar(mensagem: string): void {
  console.log(`· ${mensagem}`);
}

function conferir(condicao: boolean, mensagem: string): void {
  if (condicao) anotar(`ok · ${mensagem}`);
  else falhas.push(mensagem);
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

// ---------------------------------------------------------------- banco e ambiente

interface Credenciais {
  usuario: string;
  senha: string;
  url: string;
}

/** Lê `~/.config/margem/postgres.env` sem executá-lo; nada daqui vai para log. */
async function credenciais(): Promise<Credenciais> {
  const caminho = process.env.MARGEM_CONFIG ?? join(process.env.HOME ?? '', '.config/margem/postgres.env');
  const texto = await readFile(caminho, 'utf8');
  const valores = new Map<string, string>();
  for (const linha of texto.split('\n')) {
    const igual = linha.indexOf('=');
    if (linha.trim().startsWith('#') || igual === -1) continue;
    valores.set(linha.slice(0, igual).trim(), linha.slice(igual + 1).trim().replace(/^["']|["']$/g, ''));
  }
  const usuario = valores.get('POSTGRES_USER');
  const senha = valores.get('POSTGRES_PASSWORD') ?? '';
  const url = valores.get('DATABASE_URL');
  if (usuario === undefined || url === undefined) throw new Error('postgres.env sem POSTGRES_USER ou DATABASE_URL.');
  return { usuario, senha, url };
}

function psql(credencial: Credenciais, comando: string, argumentos: string[]): number {
  const resultado = spawnSync('docker', [
    'exec', '-i', '-e', `PGPASSWORD=${credencial.senha}`, CONTAINER, comando,
    '-U', credencial.usuario, ...argumentos,
  ], { encoding: 'utf8' });
  return resultado.status ?? 1;
}

function urlDoBanco(credencial: Credenciais, nome: string): string {
  const url = new URL(credencial.url);
  url.pathname = `/${nome}`;
  return url.toString();
}

function subir(nome: string, argumentos: string[], ambiente: Record<string, string>): ChildProcess {
  const filho = spawn('node', ['--import', 'tsx', ...argumentos], {
    cwd: RAIZ,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...ambiente },
    detached: true,
  });
  filho.stdout?.on('data', (pedaco: Buffer) => { process.stdout.write(`[${nome}] ${pedaco.toString('utf8')}`); });
  filho.stderr?.on('data', (pedaco: Buffer) => { process.stderr.write(`[${nome}!] ${pedaco.toString('utf8')}`); });
  processos.push(filho);
  return filho;
}

/** Encerra a árvore do processo e espera de verdade que ela saia. */
async function derrubar(filho: ChildProcess, sinal: NodeJS.Signals): Promise<void> {
  if (filho.pid === undefined || filho.exitCode !== null || filho.signalCode !== null) return;
  const saiu = new Promise<void>((resolver) => filho.once('exit', () => { resolver(); }));
  try { process.kill(-filho.pid, sinal); } catch { filho.kill(sinal); }
  await Promise.race([saiu, esperar(20_000)]);
}

// ---------------------------------------------------------------- API

async function pedir<T>(caminho: string, inicio?: RequestInit): Promise<T> {
  const resposta = await fetch(`${BASE}${caminho}`, inicio);
  const texto = await resposta.text();
  const corpo: unknown = texto === '' ? null : JSON.parse(texto);
  if (!resposta.ok) throw new Error(`${caminho} → ${String(resposta.status)} ${texto.slice(0, 200)}`);
  return corpo as T;
}

interface JobResumido { id: string; tipo: string; estado: string; attempt: number; error_code: string | null }
interface DetalheDoDocumento {
  estado: string;
  detalhe: string | null;
  texto_disponivel: boolean;
  versao_id: string | null;
  partes_prontas: number;
  partes_total: number;
  marcas: { total: number };
  jobs: JobResumido[];
}
interface EstadoDaApi { jobs_abertos: { tipo: string; estado: string; total: number }[] }
interface Arvore { capitulos: { id: string; titulo: string }[] }
interface BlocoDoCapitulo { id: string; texto: string; tipo: string }
interface Capitulo { secao: { id: string }; blocos: BlocoDoCapitulo[] }

async function ateQue<T>(rotulo: string, prazoMs: number, tentar: () => Promise<T | null>): Promise<T> {
  const limite = Date.now() + prazoMs;
  for (;;) {
    const valor = await tentar();
    if (valor !== null) return valor;
    if (Date.now() > limite) throw new Error(`prazo esgotado esperando ${rotulo}`);
    await esperar(300);
  }
}

function documento(id: string): Promise<DetalheDoDocumento> {
  return pedir<DetalheDoDocumento>(`/api/documentos/${id}`);
}

// ---------------------------------------------------------------- roteiro do executor falso

interface MarcaDoRoteiro {
  bloco_id: string;
  citacao: string;
  prefixo: string;
  sufixo: string;
  funcao: string;
  sublinhar: string[];
  comentario: { tipo: string; rotulo: string; texto: string };
}

/**
 * O roteiro do executor falso precisa citar blocos que existem de verdade: os ids são
 * ULIDs gerados na canonização, e não há como fixá-los numa fixture. Aqui ele é escrito
 * a partir do capítulo já canonizado — é o que torna a publicação verificável.
 */
async function escreverRoteiros(capitulo: Capitulo, pasta: string): Promise<{ lento: string; rapido: string; falha: string; marcas: number }> {
  const paragrafos = capitulo.blocos.filter((bloco) => bloco.tipo === 'paragrafo' && bloco.texto.trim() !== '');
  const escolhidos = paragrafos.slice(0, 2);
  if (escolhidos.length < 2) throw new Error('o capítulo de teste precisa de dois parágrafos');
  const marcas: MarcaDoRoteiro[] = escolhidos.map((bloco, indice) => ({
    bloco_id: bloco.id,
    citacao: bloco.texto,
    prefixo: '',
    sufixo: '',
    funcao: indice === 0 ? 'tese' : 'conceito',
    sublinhar: [],
    comentario: {
      tipo: 'AUTOR',
      rotulo: indice === 0 ? 'AUTOR · TESE' : 'AUTOR · CONCEITO',
      texto: indice === 0 ? 'A afirmação que organiza a parte.' : 'O termo que a parte define.',
    },
  }));
  const leitura = {
    marcas,
    recuperacao: [{ secao_id: capitulo.secao.id, perguntas: ['O que esta parte afirma?'] }],
    mapa_da_secao: [{
      secao_id: capitulo.secao.id, afirmacao_principal: 'A parte afirma e define.',
      definicoes: [], condicoes: [], duvidas_de_extracao: [],
    }],
    resumo_da_parte: 'A parte afirma e define, nesta ordem.',
    limites: [],
    leitura_integral: true,
  };
  const revisao = {
    alteracoes: [],
    consistencia_das_cores: 'As cores seguem o método.',
    observacoes: [],
  };
  const passos = (atrasoMs: number) => ([
    { tipo: 'ok', modelo: 'executor-falso', atraso_ms: atrasoMs, conteudo: leitura },
    { tipo: 'ok', modelo: 'executor-falso', conteudo: revisao },
  ]);

  const lento = join(pasta, 'roteiro-lento.json');
  const rapido = join(pasta, 'roteiro-rapido.json');
  const falha = join(pasta, 'roteiro-falha.json');
  await writeFile(lento, JSON.stringify({ versao: 1, passos: passos(25_000) }, null, 2));
  await writeFile(rapido, JSON.stringify({ versao: 1, passos: passos(0) }, null, 2));
  await writeFile(falha, JSON.stringify({
    versao: 1,
    passos: [{ tipo: 'processo', mensagem: 'A CLI terminou com código 137.' }],
  }, null, 2));
  return { lento, rapido, falha, marcas: marcas.length };
}

// ---------------------------------------------------------------- navegador

async function abrirLeitor(navegador: Browser, documentoId: string, tamanho: { width: number; height: number }, movel = false): Promise<Page> {
  const pagina = await navegador.newPage({ viewport: tamanho, ...(movel ? { hasTouch: true, isMobile: true } : {}) });
  pagina.on('pageerror', (erro) => falhas.push(`erro de página: ${erro.message}`));
  await pagina.goto(`${BASE}/ler/${documentoId}`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.capitulo');
  return pagina;
}

// ---------------------------------------------------------------- roteiro

async function principal(): Promise<void> {
  const credencial = await credenciais();
  if (psql(credencial, 'createdb', [BANCO]) !== 0) throw new Error(`não consegui criar ${BANCO}`);
  bancoCriado = credencial;

  const dados = await mkdtemp(join(tmpdir(), 'margem-e2e-dados-'));
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-e2e-roteiros-'));
  temporarios.push(dados, artefatos);
  const ambiente = {
    TSX_TSCONFIG_PATH: join(RAIZ, 'servico/tsconfig.json'),
    DATABASE_URL: urlDoBanco(credencial, BANCO),
    MARGEM_DADOS: dados,
    MARGEM_PORTA: String(PORTA),
    MARGEM_SLOTS: '1',
    MARGEM_CONCESSAO_MS: String(CONCESSAO_MS),
    MARGEM_EXECUTOR: 'falso',
    MARGEM_AUDITORIA: '0',
    MARGEM_ARTEFATOS: join(artefatos, 'resultados'),
  };

  const api = subir('api', ['servico/src/api.ts'], { ...ambiente, MARGEM_ROTEIRO: join(RAIZ, 'fixtures/codex/leitura/leitor-ok.json') });
  await ateQue('a API subir', 30_000, async () => {
    try { await pedir<EstadoDaApi>('/api/estado'); return true; } catch { return null; }
  });
  anotar(`API no ar em ${BASE} com banco ${BANCO}`);

  const worker = (roteiro: string, nome: string): ChildProcess =>
    subir(nome, ['servico/src/worker/main.ts'], { ...ambiente, MARGEM_ROTEIRO: roteiro });

  const importar = async (titulo: string, nome: string, formato: string, conteudo: string): Promise<string> => {
    const formulario = new FormData();
    formulario.set('titulo', titulo);
    formulario.set('autor', 'Fixture');
    formulario.set('formato', formato);
    formulario.set('arquivo', new File([conteudo], nome, { type: 'text/plain' }));
    const criado = await pedir<{ documento_id: string }>('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario });
    anotar(`documento ${criado.documento_id} importado (${nome})`);
    return criado.documento_id;
  };

  // ---------------------------------------------------------- 1. importar um Markdown
  const documentoId = await importar('Leitura e memória', 'unicode-dificil.md', 'md',
    await readFile(join(RAIZ, 'fixtures/unicode-dificil.md'), 'utf8'));

  const canonizador = worker(join(RAIZ, 'fixtures/codex/leitura/leitor-ok.json'), 'worker-canonizacao');
  await ateQue('a canonização terminar', 120_000, async () => (await documento(documentoId)).versao_id);
  await derrubar(canonizador, 'SIGTERM');
  anotar('worker parado depois da canonização');

  // ---------------------------------------------------------- 2. ler com o worker parado
  const detalheSemWorker = await documento(documentoId);
  conferir(detalheSemWorker.texto_disponivel, 'o texto fica disponível com o worker parado');
  const versaoId = detalheSemWorker.versao_id ?? '';
  const arvore = await pedir<Arvore>(`/api/versoes/${versaoId}/secoes`);
  const secaoId = arvore.capitulos[0]?.id ?? '';
  const capitulo = await pedir<Capitulo>(`/api/versoes/${versaoId}/capitulos/${secaoId}`);

  await mkdir(CAPTURAS, { recursive: true });
  const navegador = await chromium.launch();
  try {
    const paginaSemWorker = await abrirLeitor(navegador, documentoId, { width: 1440, height: 900 });
    await paginaSemWorker.screenshot({ path: join(CAPTURAS, 'computador-sem-worker.png') });
    const trechoVisivel = await paginaSemWorker.locator('.capitulo p').first().innerText();
    conferir(trechoVisivel.trim() !== '', 'o leitor desenha o texto sem o worker no ar');
    await paginaSemWorker.close();

    // -------------------------------------------------------- 3. iniciar a leitura
    const roteiros = await escreverRoteiros(capitulo, artefatos);
    await pedir('/api/documentos/' + documentoId + '/leituras', {
      method: 'POST', headers: { ...ESCRITA, 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    const aberto = await pedir<EstadoDaApi>('/api/estado');
    conferir(
      aberto.jobs_abertos.some((linha) => linha.tipo === 'ler_parte'),
      'a leitura entra na fila mesmo com o worker parado',
    );

    // -------------------------------------------------------- 4. matar o worker no meio
    const lento = worker(roteiros.lento, 'worker-lento');
    await ateQue('o job ficar reservado', 60_000, async () => {
      const estado = await pedir<EstadoDaApi>('/api/estado');
      return estado.jobs_abertos.some((linha) => linha.tipo === 'ler_parte' && linha.estado === 'reservado') ? true : null;
    });
    anotar('job ler_parte reservado; matando o worker com SIGKILL');
    await derrubar(lento, 'SIGKILL');

    const depoisDaMorte = await documento(documentoId);
    conferir(depoisDaMorte.texto_disponivel, 'o texto continua disponível com o worker morto');
    conferir(depoisDaMorte.marcas.total === 0, 'nada foi publicado pela tentativa interrompida');

    // -------------------------------------------------------- 5. retomar e publicar uma vez
    const rapido = worker(roteiros.rapido, 'worker-retomada');
    const publicado = await ateQue('a leitura publicar', 120_000, async () => {
      const atual = await documento(documentoId);
      return atual.partes_total > 0 && atual.partes_prontas === atual.partes_total
        && atual.jobs.some((job) => job.tipo === 'revisar_consistencia' && job.estado === 'ok') ? atual : null;
    });
    conferir(publicado.marcas.total === roteiros.marcas,
      `publicação única: ${String(publicado.marcas.total)} marcas para ${String(roteiros.marcas)} do roteiro`);
    const jobDaParte = publicado.jobs.find((job) => job.tipo === 'ler_parte');
    conferir(jobDaParte?.estado === 'ok', 'o job da parte terminou em ok depois da retomada');
    conferir((jobDaParte?.attempt ?? 0) >= 2, `a fila contou a tentativa perdida (attempt ${String(jobDaParte?.attempt ?? 0)})`);
    await derrubar(rapido, 'SIGTERM');

    // -------------------------------------------------------- 6. falha de marcação
    // O `dedup_key` da parte é o hash da entrada: repetir a leitura do mesmo texto não
    // cria job novo (é a idempotência do J05). A falha se força num segundo documento.
    const comFalha = worker(roteiros.falha, 'worker-falha');
    const segundo = await importar('Retomada de leitura', 'colado.txt', 'txt',
      await readFile(join(RAIZ, 'fixtures/colado.txt'), 'utf8'));
    await ateQue('a canonização do segundo documento', 120_000, async () => (await documento(segundo)).versao_id);
    await pedir(`/api/documentos/${segundo}/leituras`, {
      method: 'POST', headers: { ...ESCRITA, 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    const falhado = await ateQue('a marcação falhar', 120_000, async () => {
      const atual = await documento(segundo);
      return atual.jobs.some((job) => job.tipo === 'ler_parte' && job.estado === 'falhou') ? atual : null;
    });
    await derrubar(comFalha, 'SIGTERM');
    conferir(falhado.texto_disponivel, 'o texto continua disponível depois da falha de marcação');
    conferir(falhado.detalhe !== null && falhado.detalhe !== '', `a falha aparece com motivo: ${falhado.detalhe ?? '—'}`);
    const intacto = await documento(documentoId);
    conferir(intacto.marcas.total === roteiros.marcas, 'a falha ao lado não apagou nem duplicou as marcas já publicadas');

    const leitorDoFalhado = await abrirLeitor(navegador, segundo, { width: 1440, height: 900 });
    const textoApesarDaFalha = await leitorDoFalhado.locator('.capitulo p').first().innerText();
    conferir(textoApesarDaFalha.trim() !== '', 'o leitor abre o documento cuja marcação falhou');
    await leitorDoFalhado.goto(`${BASE}/documentos/${segundo}`, { waitUntil: 'networkidle' });
    conferir(await leitorDoFalhado.getByRole('link', { name: 'Ler', exact: true }).isVisible(),
      'o documento mantém o acesso à leitura depois da falha');
    await leitorDoFalhado.getByRole('button', { name: 'Opções do documento', exact: true }).click();
    await leitorDoFalhado.getByRole('button', { name: 'Diagnóstico', exact: true }).click();
    await leitorDoFalhado.getByText(`Último resultado: ${falhado.detalhe ?? ''}`, { exact: true }).waitFor();
    anotar('ok · o diagnóstico do documento mostra o motivo da falha');
    await leitorDoFalhado.close();

    // -------------------------------------------------------- 7. retomada da posição
    // Janela baixa de propósito: a fixture é curta e, em 900 px de altura, não há o que rolar.
    const leitor = await abrirLeitor(navegador, documentoId, { width: 1100, height: 320 });
    await leitor.waitForSelector('span[data-marcas]');
    // Posiciona um parágrafo real no topo; um deslocamento fixo pode ultrapassar
    // todo o texto desta fixture curta quando a tipografia muda.
    const alvo = leitor.locator('.capitulo p[data-bloco]').nth(1);
    const blocoDaRetomada = await alvo.getAttribute('data-bloco');
    if (!blocoDaRetomada) throw new Error('parágrafo sem identidade para testar a retomada');
    await alvo.evaluate((elemento) => {
      window.scrollBy({ top: elemento.getBoundingClientRect().top, left: 0, behavior: 'auto' });
    });
    await leitor.waitForFunction(({ documentoId, bloco }) => {
      const bruto = localStorage.getItem(`margem:progresso:${documentoId}`);
      if (!bruto) return false;
      const copia = JSON.parse(bruto) as { progresso: { ancora: { bloco_id: string } } };
      return copia.progresso.ancora.bloco_id === bloco;
    }, { documentoId, bloco: blocoDaRetomada });
    await leitor.reload({ waitUntil: 'networkidle' });
    await leitor.waitForSelector('span[data-marcas]');
    await leitor.waitForFunction((bloco) => {
      const caixa = document.querySelector(`[data-bloco="${bloco}"]`)?.getBoundingClientRect();
      return caixa !== undefined && caixa.top >= 60 && caixa.top <= 160;
    }, blocoDaRetomada);
    await leitor.screenshot({ path: join(CAPTURAS, 'computador-retomada.png') });
    conferir(await leitor.evaluate(() => window.scrollY > 0),
      'a leitura retoma o parágrafo salvo perto do topo, sem voltar ao início');
    await leitor.close();

    // -------------------------------------------------------- 8. celular e folha
    const celular = await abrirLeitor(navegador, documentoId, CELULAR, true);
    await celular.waitForSelector('span[data-marcas]');
    conferir(await celular.locator('.margem').count() === 0, 'em 412×915 a margem some');
    await celular.getByRole('button', { name: 'Nota 1: AUTOR · TESE', exact: true }).tap();
    const folha = celular.getByRole('dialog', { name: 'Nota do trecho', exact: true });
    await folha.waitFor();
    await celular.screenshot({ path: join(CAPTURAS, 'celular-412x915-folha.png') });
    const rolagemAntes = await celular.evaluate(() => window.scrollY);
    const larguras = await celular.evaluate(() => ({
      conteudo: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      janela: document.documentElement.clientWidth,
    }));
    conferir(larguras.conteudo <= larguras.janela + 1, 'em 412×915 não há rolagem horizontal');
    await folha.getByRole('button', { name: 'Fechar', exact: true }).click();
    await folha.waitFor({ state: 'detached' });
    const rolagemDepois = await celular.evaluate(() => window.scrollY);
    conferir(rolagemAntes === rolagemDepois, 'a folha abre e fecha sem mexer na rolagem');
    await celular.close();
  } finally {
    await navegador.close();
    await derrubar(api, 'SIGTERM');
  }

}

try {
  await principal();
} catch (erro) {
  falhas.push(erro instanceof Error ? erro.message : String(erro));
} finally {
  for (const filho of processos) await derrubar(filho, 'SIGKILL');
  if (bancoCriado !== undefined && psql(bancoCriado, 'dropdb', ['--if-exists', BANCO]) !== 0) {
    falhas.push(`não consegui remover o banco de teste ${BANCO}`);
  }
  for (const caminho of temporarios) await rm(caminho, { recursive: true, force: true });
}

if (falhas.length > 0) {
  for (const falha of falhas) console.error(`FALHA ${falha}`);
  process.exitCode = 1;
} else {
  console.log('e2e: worker morto no meio, sem publicação duplicada, texto sempre disponível, retomada e folha.');
}
