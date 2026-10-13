/**
 * "Margem: sincronizar": lê o índice da exportação (`GET /api/obsidian/indice`), baixa as notas que
 * mudaram (`GET /api/documentos/:id/obsidian.md`) e as escreve no cofre com `mesclarNota`.
 *
 * Separado do Obsidian por duas interfaces (`CofreDaSincronizacao` e `ClienteDoMargem`) para poder
 * ser testado sem o aplicativo. Nunca apaga nota: um documento que saiu do índice (arquivado, ou
 * sem mais nada do leitor) deixa a nota onde está.
 */
import { margemIdDaNota, mesclarNota } from './mesclar';

/** Espelho de `IndiceObsidianV1` (contratos/schemas/IndiceObsidianV1.schema.json). */
export interface DocumentoDoIndice {
  documento_id: string;
  versao_id: string;
  titulo: string;
  arquivo: string;
  sha256: string;
  itens: number;
  atualizado_em: string;
}
export interface IndiceDoMargem {
  versao: 1;
  url_base: string;
  marcas: 'minhas' | 'todas';
  documentos: DocumentoDoIndice[];
}

export interface ClienteDoMargem {
  indice: () => Promise<IndiceDoMargem>;
  nota: (documentoId: string) => Promise<string>;
}

export interface CofreDaSincronizacao {
  ler: (caminho: string) => Promise<string | null>;
  /** Cria ou substitui o arquivo (criando as pastas que faltarem). */
  escrever: (caminho: string, conteudo: string) => Promise<void>;
  /** Notas da pasta com `margem_id` no frontmatter: id → caminho. */
  notasDoMargem: () => Promise<Map<string, string>>;
}

/** O que o plugin guarda entre uma sincronização e outra, por documento. */
export interface EstadoDoDocumento { sha256: string; caminho: string }
export type EstadoDaSincronizacao = Record<string, EstadoDoDocumento>;

export interface RelatorioDaSincronizacao {
  criadas: string[];
  atualizadas: string[];
  iguais: number;
  conflitos: { caminho: string; motivo: string }[];
  erros: { titulo: string; motivo: string }[];
}

export function validarIndice(valor: unknown): IndiceDoMargem {
  const indice = valor as Partial<IndiceDoMargem> | null;
  if (indice === null || typeof indice !== 'object' || indice.versao !== 1 || !Array.isArray(indice.documentos)) {
    throw new Error('O servidor não respondeu um índice do Margem (IndiceObsidianV1). Confira o endereço.');
  }
  for (const documento of indice.documentos) {
    if (typeof documento.documento_id !== 'string' || typeof documento.arquivo !== 'string' || !/\.md$/.test(documento.arquivo)
      || /[\\/]/.test(documento.arquivo) || typeof documento.sha256 !== 'string') {
      throw new Error('O índice do Margem tem um documento malformado.');
    }
  }
  return indice as IndiceDoMargem;
}

export function juntarCaminho(pasta: string, arquivo: string): string {
  const limpa = pasta.replace(/\\/g, '/').split('/').map((parte) => parte.trim())
    .filter((parte) => parte !== '' && parte !== '.' && parte !== '..').join('/');
  return limpa === '' ? arquivo : `${limpa}/${arquivo}`;
}

/** Caminho para uma nota nova: o nome do índice; se já houver outra nota (de outro documento) com ele, com o fim do id. */
async function caminhoNovo(cofre: CofreDaSincronizacao, pasta: string, documento: DocumentoDoIndice): Promise<string> {
  const preferido = juntarCaminho(pasta, documento.arquivo);
  const existente = await cofre.ler(preferido);
  if (existente === null) return preferido;
  const dono = margemIdDaNota(existente);
  if (dono === null || dono === documento.documento_id) return preferido;
  return juntarCaminho(pasta, `${documento.arquivo.slice(0, -3)} (${documento.documento_id.slice(-6)}).md`);
}

export async function sincronizar(entrada: {
  cofre: CofreDaSincronizacao; cliente: ClienteDoMargem; pasta: string; estado: EstadoDaSincronizacao;
}): Promise<{ relatorio: RelatorioDaSincronizacao; estado: EstadoDaSincronizacao }> {
  const { cofre, cliente, pasta } = entrada;
  const estado: EstadoDaSincronizacao = { ...entrada.estado };
  const relatorio: RelatorioDaSincronizacao = { criadas: [], atualizadas: [], iguais: 0, conflitos: [], erros: [] };
  const indice = validarIndice(await cliente.indice());
  const porId = await cofre.notasDoMargem();
  for (const documento of indice.documentos) {
    try {
      const anterior = estado[documento.documento_id];
      // A nota é achada pelo margem_id (sobrevive a renomear e mover), depois pelo caminho guardado.
      let caminho = porId.get(documento.documento_id) ?? null;
      if (caminho === null && anterior && (await cofre.ler(anterior.caminho)) !== null) caminho = anterior.caminho;
      if (caminho !== null && anterior?.sha256 === documento.sha256) {
        relatorio.iguais++;
        estado[documento.documento_id] = { sha256: documento.sha256, caminho };
        continue;
      }
      const gerada = await cliente.nota(documento.documento_id);
      const destino = caminho ?? await caminhoNovo(cofre, pasta, documento);
      const atual = await cofre.ler(destino);
      const mescla = mesclarNota(atual, gerada);
      if (mescla.estado === 'conflito') {
        relatorio.conflitos.push({ caminho: destino, motivo: mescla.motivo });
        continue;
      }
      if (atual === null) {
        await cofre.escrever(destino, mescla.conteudo);
        relatorio.criadas.push(destino);
      } else if (atual.replace(/\r\n?/g, '\n') !== mescla.conteudo) {
        await cofre.escrever(destino, mescla.conteudo);
        relatorio.atualizadas.push(destino);
      } else {
        relatorio.iguais++;
      }
      estado[documento.documento_id] = { sha256: documento.sha256, caminho: destino };
    } catch (erro) {
      relatorio.erros.push({ titulo: documento.titulo, motivo: erro instanceof Error ? erro.message : String(erro) });
    }
  }
  return { relatorio, estado };
}

export function resumoDoRelatorio(relatorio: RelatorioDaSincronizacao): string {
  const partes = [
    `${String(relatorio.criadas.length)} nova${relatorio.criadas.length === 1 ? '' : 's'}`,
    `${String(relatorio.atualizadas.length)} atualizada${relatorio.atualizadas.length === 1 ? '' : 's'}`,
    `${String(relatorio.iguais)} sem mudança`,
  ];
  if (relatorio.conflitos.length > 0) partes.push(`${String(relatorio.conflitos.length)} com marcadores quebrados (não mexi)`);
  if (relatorio.erros.length > 0) partes.push(`${String(relatorio.erros.length)} com erro`);
  return `Margem: ${partes.join(', ')}.`;
}
