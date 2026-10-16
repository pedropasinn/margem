/**
 * Importação (J108): o que a página "Adicionar" sabe sobre cada entrada, sem React.
 *
 * - Classifica o que a pessoa soltou pela extensão e pelo MIME: documento (PDF, EPUB, Markdown,
 *   TXT → `POST /api/documentos`), vídeo ou áudio (→ `PUT /api/midia/arquivos` + documento TXT da
 *   transcrição + `POST /api/documentos/:id/midias`) ou a transcrição `.json` que acompanha a mídia.
 * - Reconhece links do YouTube (→ `POST /api/importacoes/youtube`, rota do J109). Outras páginas web
 *   não são buscadas pelo servidor: entram pela extensão do navegador (`POST /api/importacoes/web`).
 * - Os limites espelham o serviço: 200 MB por documento (`LIMITE_UPLOAD_BYTES`) e 4 GB por mídia
 *   (`MARGEM_LIMITE_MIDIA`, padrão). O serviço continua sendo quem decide; aqui só se evita mandar
 *   para longe o que certamente volta recusado.
 * - Cada tipo tem a sua aba em Adicionar (V-D2): documentos, vídeo e áudio, e a imagem de uma obra,
 *   que vai para Quadros e só é enviada com confirmação. Imagem nunca vira questão por aqui; resolver
 *   uma questão é coisa do leitor, dentro do documento.
 */
import { ErroDaApi, escrever, obterDocumento, pedir } from './api';
import { mensagemDeErro } from './erros';
import type { AbaDeAdicionar } from './rotas';
import type { DetalheDoDocumento } from './tipos';
import type { ImportacaoYoutubeV1 } from '@margem/contratos';

export const LIMITE_DOCUMENTO_BYTES = 200 * 1024 * 1024;
export const LIMITE_MIDIA_BYTES = 4 * 1024 ** 3;

export type FormatoDeDocumento = 'pdf' | 'epub' | 'md' | 'txt';
export type TipoDeArquivo = FormatoDeDocumento | 'video' | 'audio' | 'transcricao' | 'imagem' | 'desconhecido';

const POR_EXTENSAO: Readonly<Record<string, TipoDeArquivo>> = {
  pdf: 'pdf', epub: 'epub', md: 'md', markdown: 'md', txt: 'txt', text: 'txt',
  // O serviço sonda com ffprobe e aceita MP4/MOV/M4A, WebM/Matroska, MP3 e Ogg (servico/src/midia/arquivos.ts).
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio',
  json: 'transcricao',
  png: 'imagem', jpg: 'imagem', jpeg: 'imagem', webp: 'imagem', heic: 'imagem', heif: 'imagem',
};

/** O `accept` do seletor de cada aba: só o que ela recebe (a de Quadro fica com o formulário da obra). */
export const ACEITOS_POR_ABA: Readonly<Record<Exclude<AbaDeAdicionar, 'quadro'>, string>> = {
  documento: ['.pdf', '.epub', '.md', '.markdown', '.txt', 'application/pdf', 'application/epub+zip', 'text/markdown', 'text/plain'].join(','),
  video: ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.json', 'video/*', 'audio/*', 'application/json'].join(','),
};

/** A aba de cada tipo; `null` para o que nenhuma recebe (fica onde foi solto, recusado). */
export function abaDoTipo(tipo: TipoDeArquivo | 'colado' | 'youtube'): AbaDeAdicionar | null {
  if (ehDocumento(tipo) || tipo === 'colado') return 'documento';
  if (ehMidia(tipo) || tipo === 'transcricao' || tipo === 'youtube') return 'video';
  if (tipo === 'imagem') return 'quadro';
  return null;
}

const CHAVE_DA_ABA = 'margem:aba-adicionar';
/** A última aba usada em Adicionar: `/adicionar` sem aba volta a ela. */
export function abaPreferida(): AbaDeAdicionar {
  try { const valor = localStorage.getItem(CHAVE_DA_ABA); return valor === 'video' || valor === 'quadro' ? valor : 'documento'; } catch { return 'documento'; }
}
export function guardarAba(aba: AbaDeAdicionar): void {
  try { localStorage.setItem(CHAVE_DA_ABA, aba); } catch { /* Armazenamento indisponível: vale a aba desta sessão. */ }
}

/** Para onde um lote solto fora de Adicionar leva: imagens a Quadro, mídias a Vídeo, o resto a Documento. */
export function abaDosArquivos(arquivos: readonly Pick<File, 'name' | 'type'>[]): AbaDeAdicionar {
  const abas = arquivos.map((arquivo) => abaDoTipo(tipoDoArquivo(arquivo)));
  if (abas.includes('documento')) return 'documento';
  if (abas.includes('video')) return 'video';
  return abas.includes('quadro') ? 'quadro' : 'documento';
}

export function extensaoDe(nome: string): string {
  const partes = nome.split('.');
  return partes.length > 1 ? (partes.at(-1) ?? '').toLowerCase() : '';
}

/** Tipo pela extensão; sem extensão conhecida, pelo MIME. */
export function tipoDoArquivo(arquivo: Pick<File, 'name' | 'type'>): TipoDeArquivo {
  const pelaExtensao = POR_EXTENSAO[extensaoDe(arquivo.name)];
  if (pelaExtensao) return pelaExtensao;
  const mime = arquivo.type.toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/epub+zip') return 'epub';
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return 'md';
  if (mime === 'text/plain') return 'txt';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/json') return 'transcricao';
  if (TIPOS_DE_IMAGEM.includes(mime)) return 'imagem';
  return 'desconhecido';
}

/** As imagens que o Margem lê (as da obra, em Quadros); GIF, SVG e outras ficam de fora. */
export const TIPOS_DE_IMAGEM: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];

export const ehDocumento = (tipo: string): tipo is FormatoDeDocumento => tipo === 'pdf' || tipo === 'epub' || tipo === 'md' || tipo === 'txt';
export const ehMidia = (tipo: string): tipo is 'video' | 'audio' => tipo === 'video' || tipo === 'audio';
/** PDF e EPUB trazem título (e às vezes autor) nos metadados: sem título digitado, o serviço usa o deles. */
export const tituloAutomatico = (tipo: string): boolean => tipo === 'pdf' || tipo === 'epub';
/** Prosa ou poesia só vale para texto simples (FORMATOS_COM_POESIA no serviço). */
export const aceitaPoesia = (tipo: string): boolean => tipo === 'md' || tipo === 'txt' || tipo === 'colado';

export const ROTULO_DO_TIPO: Readonly<Record<TipoDeArquivo | 'colado' | 'youtube', string>> = {
  pdf: 'PDF', epub: 'EPUB', md: 'Markdown', txt: 'TXT', video: 'Vídeo', audio: 'Áudio',
  transcricao: 'Transcrição', imagem: 'Imagem', desconhecido: 'Arquivo', colado: 'Texto colado', youtube: 'YouTube',
};

export function tituloDoNome(nome: string): string {
  const titulo = nome.replace(/\.[^.]+$/, '').replace(/\.transcricao$/i, '').replaceAll('_', ' ').trim();
  return titulo === '' ? 'Sem título' : titulo;
}

/** Título de um texto colado sem título: a primeira linha com conteúdo, encurtada. */
export function tituloDoTexto(texto: string): string {
  const linha = texto.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l !== '') ?? '';
  if (linha === '') return 'Texto colado';
  return linha.length > 80 ? `${linha.slice(0, 79).trimEnd()}…` : linha;
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  if (bytes >= 1024 ** 2) return `${String(Math.max(1, Math.round(bytes / 1024 ** 2)))} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** Recusa local, antes de enviar: formato fora do que o serviço lê ou tamanho acima do limite. */
export function recusaLocal(arquivo: Pick<File, 'name' | 'type' | 'size'>, tipo = tipoDoArquivo(arquivo)): string | null {
  if (tipo === 'desconhecido') return 'Formato não aceito. Documentos: PDF, EPUB, Markdown ou TXT. Vídeo e áudio, com a transcrição .json. Quadros: JPEG, PNG ou WebP.';
  if (ehDocumento(tipo) && arquivo.size > LIMITE_DOCUMENTO_BYTES) return `Maior que ${tamanhoLegivel(LIMITE_DOCUMENTO_BYTES)}, o limite por documento.`;
  if (ehMidia(tipo) && arquivo.size > LIMITE_MIDIA_BYTES) return `Maior que ${tamanhoLegivel(LIMITE_MIDIA_BYTES)}, o limite por vídeo ou áudio.`;
  if (arquivo.size === 0) return 'O arquivo está vazio.';
  return null;
}

/**
 * Junta cada vídeo ou áudio à sua transcrição `.json` no mesmo lote: pelo nome (`aula.mp4` +
 * `aula.json` ou `aula.transcricao.json`) ou, havendo uma mídia e uma transcrição só, uma à outra.
 * Devolve as transcrições que sobraram sem par.
 */
export function emparelharTranscricoes(midias: File[], transcricoes: File[]): { pares: Map<File, File>; sobras: File[] } {
  const pares = new Map<File, File>();
  const livres = [...transcricoes];
  const base = (nome: string) => nome.replace(/\.[^.]+$/, '').replace(/\.transcri[cç][aã]o$/i, '').toLowerCase();
  for (const midia of midias) {
    const indice = livres.findIndex((json) => base(json.name) === base(midia.name));
    if (indice >= 0) { pares.set(midia, livres[indice]!); livres.splice(indice, 1); }
  }
  const semPar = midias.filter((midia) => !pares.has(midia));
  if (semPar.length === 1 && livres.length === 1) { pares.set(semPar[0]!, livres[0]!); livres.length = 0; }
  return { pares, sobras: livres };
}

// ------------------------------------------------------------------ imagens coladas

/** As imagens de um evento de colar (Ctrl/Cmd+V de um print ou de uma obra), já com nome. */
export function imagensColadas(dados: DataTransfer | null): File[] {
  if (!dados) return [];
  const arquivos = Array.from(dados.files ?? []);
  const itens = arquivos.length > 0 ? arquivos : Array.from(dados.items ?? []).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((arquivo): arquivo is File => arquivo !== null);
  return itens.filter((arquivo) => tipoDoArquivo(arquivo) === 'imagem').map((arquivo, indice) => {
    // O print colado chega como "image.png" (ou sem nome): o nome vira o da questão.
    if (arquivo.name && arquivo.name !== 'image.png') return arquivo;
    const extensao = arquivo.type === 'image/jpeg' ? 'jpg' : (arquivo.type.split('/')[1] ?? 'png');
    return new File([arquivo], `print${indice > 0 ? `-${String(indice + 1)}` : ''}.${extensao}`, { type: arquivo.type || 'image/png' });
  });
}

/**
 * PNG e JPEG vão como estão; WebP, HEIC (onde o navegador abre) e outros viram PNG num canvas, na
 * resolução natural. O serviço só lê PNG e JPEG, sem dependência nova para decodificar o resto.
 */
export async function normalizarImagem(arquivo: File): Promise<File> {
  const assinatura = new Uint8Array(await lerBytes(arquivo.slice(0, 8)));
  const png = [0x89, 0x50, 0x4e, 0x47].every((valor, i) => assinatura[i] === valor);
  const jpeg = assinatura[0] === 0xff && assinatura[1] === 0xd8 && assinatura[2] === 0xff;
  if (png || jpeg) return arquivo;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(arquivo); } catch {
    throw new Error(/hei[cf]$/i.test(arquivo.name) || /heic|heif/.test(arquivo.type)
      ? 'Este navegador não abre HEIC. Exporte a foto como JPEG ou PNG e tente de novo.'
      : 'Não foi possível ler a imagem. Use PNG, JPEG ou WebP.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, 'image/png'));
  if (!blob) throw new Error('Não foi possível converter a imagem em PNG.');
  return new File([blob], `${tituloDoNome(arquivo.name)}.png`, { type: 'image/png' });
}

function lerBytes(parte: Blob): Promise<ArrayBuffer> {
  if (typeof parte.arrayBuffer === 'function') return parte.arrayBuffer();
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(leitor.result as ArrayBuffer);
    leitor.onerror = () => rejeitar(leitor.error ?? new Error('Não foi possível ler o arquivo.'));
    leitor.readAsArrayBuffer(parte);
  });
}

// ------------------------------------------------------------------ transcrição de mídia

/** O `transcricao.json` versão 1 (formato em tools/midia/transcricao_whisper.py). */
export interface TranscricaoV1 {
  versao: 1;
  titulo?: string;
  canal?: string;
  url?: string;
  publicado_em?: string;
  idioma?: string;
  motor: string;
  capitulos: { inicio_s: number; titulo: string }[];
  paragrafos: string[];
  palavras: { texto: string; inicio_s: number; fim_s: number }[];
}

/** Confere a transcrição como `tools/importar-videos.mjs`: tokens dos parágrafos = palavras, tempos crescentes. */
export function lerTranscricao(bruto: unknown): TranscricaoV1 {
  const t = bruto as Partial<TranscricaoV1> | null;
  if (typeof t !== 'object' || t === null || t.versao !== 1 || !Array.isArray(t.paragrafos) || !Array.isArray(t.palavras) || !Array.isArray(t.capitulos)) {
    throw new Error('A transcrição não está no formato do Margem (versao 1, com parágrafos, palavras e capítulos).');
  }
  if (typeof t.motor !== 'string' || t.motor.trim() === '') throw new Error('A transcrição não diz qual motor a fez (campo motor).');
  const tokens = t.paragrafos.join(' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new Error('A transcrição está vazia.');
  if (tokens.length !== t.palavras.length || tokens.some((token, i) => token !== t.palavras![i]?.texto)) {
    throw new Error('As palavras com tempo não batem com o texto dos parágrafos.');
  }
  let anterior = 0;
  for (const p of t.palavras) {
    if (!(Number.isFinite(p.inicio_s) && Number.isFinite(p.fim_s) && p.inicio_s >= anterior && p.fim_s >= p.inicio_s)) {
      throw new Error(`Tempo inválido na palavra "${p.texto}".`);
    }
    anterior = p.inicio_s;
  }
  return t as TranscricaoV1;
}

/** O texto do documento: um parágrafo por linha, separados por linha em branco. */
export function textoDaTranscricao(t: Pick<TranscricaoV1, 'paragrafos'>): string {
  return `${t.paragrafos.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n')}\n`;
}

// ------------------------------------------------------------------ links

export type Link = { tipo: 'youtube'; url: string } | { tipo: 'pagina'; url: string } | { tipo: 'invalido' };

export function classificarLink(bruto: string): Link {
  const texto = bruto.trim();
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(texto) ? texto : `https://${texto}`); } catch { return { tipo: 'invalido' }; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) return { tipo: 'invalido' };
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return { tipo: 'youtube', url: url.toString() };
  return { tipo: 'pagina', url: url.toString() };
}

// ------------------------------------------------------------------ chamadas

export interface DocumentoCriado { documento_id: string; job_id: string }


export interface ServicosDaImportacao {
  enviarDocumento: (formulario: FormData) => Promise<DocumentoCriado>;
  importarYoutube: (pedido: ImportacaoYoutubeV1) => Promise<DocumentoCriado>;
  enviarMidia: (arquivo: File) => Promise<{ sha256: string; tipo: 'video' | 'audio' }>;
  publicarMidia: (documentoId: string, corpo: unknown) => Promise<unknown>;
  obterDocumento: (id: string) => Promise<Pick<DetalheDoDocumento, 'id' | 'versao_id' | 'estado' | 'detalhe' | 'formato' | 'texto_disponivel' | 'paginas_sem_texto'>>;
  transcrever: (id: string) => Promise<{ job_id: string; paginas: number }>;
  /** Intervalo da consulta do estado do texto (ms). */
  intervalo: number;
}

export const SERVICOS_PADRAO: ServicosDaImportacao = {
  enviarDocumento: (formulario) => pedir('/api/documentos', { method: 'POST', body: formulario }),
  importarYoutube: (pedido) => escrever('/api/importacoes/youtube', pedido),
  enviarMidia: (arquivo) => pedir('/api/midia/arquivos', {
    method: 'PUT', body: arquivo, headers: { 'Content-Type': arquivo.type || 'application/octet-stream' },
  }),
  publicarMidia: (id, corpo) => escrever(`/api/documentos/${id}/midias`, corpo),
  obterDocumento,
  transcrever: (id) => pedir(`/api/documentos/${id}/transcrever`, { method: 'POST' }),
  intervalo: 2500,
};

/** O documento que já está na biblioteca, quando a API recusa por duplicado (409). */
export function documentoExistente(falha: unknown): string | undefined {
  if (!(falha instanceof ErroDaApi) || falha.status !== 409) return undefined;
  const corpo = falha.corpo;
  if (typeof corpo !== 'object' || corpo === null) return undefined;
  const registro = corpo as Record<string, unknown>;
  // `/api/documentos` devolve `documento_id`; a rota do YouTube (J109), `existente` (id ou objeto).
  const candidato = registro.existente ?? registro.documento_id;
  if (typeof candidato === 'string') return candidato;
  if (typeof candidato === 'object' && candidato !== null) {
    const objeto = candidato as Record<string, unknown>;
    const id = objeto.documento_id ?? objeto.id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

/** Motivo legível de uma recusa, sem códigos crus quando o serviço já explicou. */
export function motivoDaFalha(falha: unknown): string {
  if (falha instanceof ErroDaApi) {
    if (falha.status === 409 && documentoExistente(falha)) return 'Já está na biblioteca.';
    if (falha.status === 413) return 'Grande demais para esta instalação.';
    if (falha.status === 429) return 'Muitos envios seguidos. Espere um minuto e tente de novo.';
    if (falha.status === 415 && falha.codigo === 'pdf_invalido') return 'O arquivo não é um PDF válido.';
    return mensagemDeErro(falha, 'O Margem não aceitou este arquivo.');
  }
  return mensagemDeErro(falha, 'Não foi possível adicionar.');
}


/** Conteúdo de um arquivo de texto; `FileReader` onde `Blob.text` não existe (jsdom, navegadores antigos). */
export function lerTextoDoArquivo(arquivo: Blob): Promise<string> {
  if (typeof arquivo.text === 'function') return arquivo.text();
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(typeof leitor.result === 'string' ? leitor.result : '');
    leitor.onerror = () => rejeitar(leitor.error ?? new Error('Não foi possível ler o arquivo.'));
    leitor.readAsText(arquivo);
  });
}
