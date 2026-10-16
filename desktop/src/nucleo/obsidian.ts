/**
 * "Exportar para o Obsidian…" no app de computador: grava as notas do Margem direto numa pasta
 * escolhida (o cofre), com a mesma mescla e a mesma sincronização do plugin do Obsidian
 * (`core/src/obsidian.ts`). O serviço roda neste computador: as notas vêm da API local
 * (`/api/obsidian/v2/*`), com a chave local da instalação (S-01) e sem CORS.
 *
 * As notas ficam em `<cofre>/Margem/<Documento>/…` (formato 2). O estado da última exportação (por
 * nota: o sha256 e o caminho) fica em `<cofre>/Margem/.margem/estado.json`, e o índice exportado em
 * `<cofre>/Margem/.margem/manifesto.json`. A nota é achada pelo `margem_id` em qualquer lugar do cofre:
 * renomear ou mover não duplica. Nada é apagado.
 */
import { mkdir, open, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  margemIdDaNota, sincronizarV2, type ClienteDoMargemV2, type CofreDaSincronizacao, type EstadoDaSincronizacao,
  type IndiceDoMargemV2, type NotaGeradaV2, type RelatorioDaSincronizacao,
} from '../../../core/src/obsidian.js';

export const PASTA_DO_MARGEM_NO_COFRE = 'Margem';
const PASTAS_IGNORADAS = new Set(['node_modules']);

/** Caminho do cofre (com `/`) → caminho no disco, sem sair da raiz. */
function noDisco(raiz: string, caminho: string): string {
  const absoluto = resolve(raiz, ...caminho.split('/'));
  if (absoluto !== raiz && !absoluto.startsWith(raiz + sep)) throw new Error(`Caminho fora do cofre: ${caminho}`);
  return absoluto;
}

function dentro(raiz: string, caminho: string): boolean {
  return caminho === raiz || caminho.startsWith(raiz.endsWith(sep) ? raiz : raiz + sep);
}

/**
 * S-07 · A pasta onde se vai gravar, conferida pelo caminho real: um `Margem` (ou qualquer pasta do
 * caminho) que seja link simbólico ou junção para fora do cofre é recusado antes de criar ou gravar
 * qualquer coisa. Confere a pasta existente mais funda (o `realpath` resolve os links do caminho todo),
 * cria o que falta e confere de novo.
 */
export async function pastaRealNoCofre(raiz: string, pasta: string): Promise<void> {
  const raizReal = await realpath(raiz);
  const conferir = async (): Promise<boolean> => {
    let atual = pasta;
    for (;;) {
      try {
        const real = await realpath(atual);
        if (!dentro(raizReal, real)) throw new Error(`A pasta ${relative(raiz, atual) || '.'} do cofre aponta para fora dele (link simbólico ou junção). Nada foi gravado.`);
        return atual === pasta;
      } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(atual) === atual) throw erro;
        atual = dirname(atual);
      }
    }
  };
  if (await conferir()) return;
  await mkdir(pasta, { recursive: true });
  await conferir();
}

/** O começo do arquivo, o bastante para o frontmatter (o arquivo inteiro, se o frontmatter não fechar). */
async function cabecalho(caminho: string): Promise<string> {
  const arquivo = await open(caminho, 'r');
  try {
    const { buffer, bytesRead } = await arquivo.read({ buffer: Buffer.alloc(8192), position: 0 });
    const inicio = buffer.subarray(0, bytesRead).toString('utf8');
    if (!inicio.startsWith('---') || /\n---(\r?\n|$)/.test(inicio.slice(3)) || bytesRead < 8192) return inicio;
  } finally {
    await arquivo.close();
  }
  return readFile(caminho, 'utf8');
}

/** O cofre como uma pasta do disco. As pastas ocultas (`.obsidian`, `.trash`, `.margem`) ficam de fora da busca. */
export function cofreNoDisco(raizBruta: string): CofreDaSincronizacao {
  const raiz = resolve(raizBruta);
  return {
    ler: async (caminho) => {
      try { return await readFile(noDisco(raiz, caminho), 'utf8'); } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw erro;
      }
    },
    escrever: async (caminho, conteudo) => {
      const destino = noDisco(raiz, caminho);
      await pastaRealNoCofre(raiz, dirname(destino));
      // Atômico: o Obsidian (ou o Dropbox) nunca vê a nota pela metade.
      const temporario = `${destino}.${String(process.pid)}.margem-tmp`;
      await writeFile(temporario, conteudo, 'utf8');
      await rename(temporario, destino);
    },
    notasDoMargem: async () => {
      const mapa = new Map<string, string>();
      const visitar = async (pasta: string): Promise<void> => {
        let entradas;
        try { entradas = await readdir(pasta, { withFileTypes: true }); } catch { return; }
        for (const entrada of entradas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
          if (entrada.name.startsWith('.') || PASTAS_IGNORADAS.has(entrada.name)) continue;
          const caminho = join(pasta, entrada.name);
          if (entrada.isDirectory()) { await visitar(caminho); continue; }
          if (!entrada.isFile() || !entrada.name.toLowerCase().endsWith('.md')) continue;
          const id = margemIdDaNota(await cabecalho(caminho).catch(() => ''));
          if (id !== null && !mapa.has(id)) mapa.set(id, relative(raiz, caminho).split(sep).join('/'));
        }
      };
      await visitar(raiz);
      return mapa;
    },
  };
}

export interface OpcoesDaExportacao {
  /** Endereço do serviço local (`http://127.0.0.1:<porta>`). */
  servico: string;
  /** A pasta escolhida: o cofre do Obsidian (as notas vão para `<cofre>/Margem`). */
  cofre: string;
  marcas?: 'minhas' | 'todas';
  /** Só este documento (o botão da página do documento); sem ele, a biblioteca inteira. */
  documentoId?: string;
  /** S-01: a chave local da instalação, que o serviço do app exige (`Authorization: Bearer`). */
  chave?: string;
  /** Para os testes. */
  buscar?: typeof fetch;
}

export interface ResultadoDaExportacao { pasta: string; relatorio: RelatorioDaSincronizacao }

async function pedirJson(buscar: typeof fetch, url: string, chave: string | undefined): Promise<unknown> {
  const resposta = await buscar(url, { headers: { Accept: 'application/json', ...(chave === undefined ? {} : { Authorization: `Bearer ${chave}` }) } });
  if (resposta.status === 404 && url.includes('/api/obsidian/v2/')) throw new Error('O serviço do Margem não tem a exportação por item. Atualize o app.');
  if (!resposta.ok) throw new Error(`O Margem respondeu ${String(resposta.status)} ao exportar.`);
  return resposta.json();
}

/** O cliente da API local; com `documentoId`, o índice só com as notas daquele documento. */
export function clienteLocal(opcoes: Pick<OpcoesDaExportacao, 'servico' | 'marcas' | 'documentoId' | 'buscar' | 'chave'>): ClienteDoMargemV2 {
  const buscar = opcoes.buscar ?? fetch;
  const servico = opcoes.servico.replace(/\/+$/, '');
  const consulta = new URLSearchParams({ marcas: opcoes.marcas ?? 'minhas', base: servico });
  if (opcoes.documentoId !== undefined) consulta.set('todos', '1');
  return {
    indice: async () => {
      const indice = await pedirJson(buscar, `${servico}/api/obsidian/v2/indice?${consulta.toString()}`, opcoes.chave) as IndiceDoMargemV2;
      if (opcoes.documentoId === undefined || !Array.isArray(indice.notas)) return indice;
      return { ...indice, notas: indice.notas.filter((nota) => nota.documento_id === opcoes.documentoId) };
    },
    documento: async (documentoId) => {
      const corpo = await pedirJson(buscar, `${servico}/api/obsidian/v2/documentos/${encodeURIComponent(documentoId)}?${consulta.toString()}`, opcoes.chave) as { notas?: unknown };
      if (!Array.isArray(corpo.notas)) throw new Error('O Margem não devolveu as notas do documento.');
      return { notas: corpo.notas as NotaGeradaV2[] };
    },
  };
}

async function lerEstado(caminho: string): Promise<EstadoDaSincronizacao> {
  try {
    const bruto = JSON.parse(await readFile(caminho, 'utf8')) as { notas?: unknown };
    if (typeof bruto.notas !== 'object' || bruto.notas === null) return {};
    const estado: EstadoDaSincronizacao = {};
    for (const [id, valor] of Object.entries(bruto.notas as Record<string, unknown>)) {
      const nota = valor as { sha256?: unknown; caminho?: unknown };
      if (typeof nota.sha256 === 'string' && typeof nota.caminho === 'string') estado[id] = { sha256: nota.sha256, caminho: nota.caminho };
    }
    return estado;
  } catch {
    return {};
  }
}

async function gravarJson(cofre: string, caminho: string, valor: unknown): Promise<void> {
  await pastaRealNoCofre(cofre, dirname(caminho));
  const temporario = `${caminho}.${String(process.pid)}.tmp`;
  await writeFile(temporario, `${JSON.stringify(valor, null, 2)}\n`, 'utf8');
  await rename(temporario, caminho);
}

/** Exporta (ou atualiza) as notas no cofre. O que a pessoa escreveu fora do bloco do Margem fica. */
export async function exportarParaOCofre(opcoes: OpcoesDaExportacao): Promise<ResultadoDaExportacao> {
  const cofre = resolve(opcoes.cofre);
  const interna = join(cofre, PASTA_DO_MARGEM_NO_COFRE, '.margem');
  const caminhoDoEstado = join(interna, 'estado.json');
  // S-07: `<cofre>/Margem` como link para fora recusa a exportação inteira antes de ler ou gravar nada.
  await pastaRealNoCofre(cofre, join(cofre, PASTA_DO_MARGEM_NO_COFRE));
  const anterior = await lerEstado(caminhoDoEstado);
  const { relatorio, estado, indice } = await sincronizarV2({
    cofre: cofreNoDisco(cofre), cliente: clienteLocal(opcoes), pasta: PASTA_DO_MARGEM_NO_COFRE, estado: anterior,
  });
  const ordenado = Object.fromEntries(Object.entries(estado).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  await gravarJson(cofre, caminhoDoEstado, { versao: 2, notas: ordenado });
  if (opcoes.documentoId === undefined) await gravarJson(cofre, join(interna, 'manifesto.json'), indice);
  return { pasta: join(cofre, PASTA_DO_MARGEM_NO_COFRE), relatorio };
}

/** A frase do resultado para a caixa de mensagem. */
export function resumoDaExportacao(resultado: ResultadoDaExportacao): { titulo: string; detalhe: string } {
  const { relatorio } = resultado;
  const novas = relatorio.criadas.length;
  const atualizadas = relatorio.atualizadas.length;
  const partes = [
    `${String(novas)} ${novas === 1 ? 'nota nova' : 'notas novas'}`,
    `${String(atualizadas)} ${atualizadas === 1 ? 'atualizada' : 'atualizadas'}`,
    `${String(relatorio.iguais)} sem mudança`,
  ];
  const problemas = [
    ...relatorio.conflitos.map((conflito) => `${conflito.caminho}: os marcadores do Margem estão quebrados; a nota não foi tocada.`),
    ...relatorio.erros.map((erro) => `${erro.titulo}: ${erro.motivo}`),
  ];
  return {
    titulo: problemas.length === 0 ? 'Exportado para o Obsidian.' : 'Exportado para o Obsidian, com avisos.',
    detalhe: [`${partes.join(', ')}.`, `Pasta: ${resultado.pasta}`, ...problemas.slice(0, 10)].join('\n'),
  };
}
