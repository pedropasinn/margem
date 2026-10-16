import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input, Textarea, Select, classesDoBotao, usarFoco } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import { segurarSaida, type AbaDeAdicionar, type Rota } from './rotas';
import { EVENTO_ARQUIVOS_ABERTOS } from './abrir-com';
import { usarOnboarding } from '../onboarding/ContextoDoOnboarding';
import { integracoes } from '../onboarding/integracoes';
import { ErroDaApi } from './api';
import {
  ACEITOS_POR_ABA, LIMITE_DOCUMENTO_BYTES, LIMITE_MIDIA_BYTES, ROTULO_DO_TIPO, SERVICOS_PADRAO,
  abaDoTipo, aceitaPoesia, guardarAba, classificarLink, documentoExistente, ehDocumento, ehMidia, emparelharTranscricoes, imagensColadas, lerTextoDoArquivo, lerTranscricao, motivoDaFalha,
  recusaLocal, tamanhoLegivel, textoDaTranscricao, tipoDoArquivo, tituloAutomatico, tituloDoNome, tituloDoTexto,
  type DocumentoCriado, type ServicosDaImportacao, type TipoDeArquivo, type TranscricaoV1,
} from './importacao';
import { FormularioDaObra } from '../quadros/NaBiblioteca';
import { OPERACOES_DOS_QUADROS, type OperacoesDosQuadros } from '../quadros/api';
import type { QuadroDaPessoaV1 } from '../quadros/tipos';
import { usarRecurso } from '../recursos';

/**
 * Adicionar (J108, V-D2): trazer qualquer coisa para a biblioteca, em três abas com rota própria.
 *
 * - Documento: PDF, EPUB, Markdown e TXT pela área de soltar, o texto colado e, para páginas da web,
 *   a extensão do navegador.
 * - Vídeo: o link do YouTube (o caminho principal) e, como opção avançada, o arquivo de vídeo ou áudio
 *   com a transcrição `.json`.
 * - Quadro: a imagem de uma obra, com título, artista e ano opcionais (`POST /api/arte`).
 *
 * Tudo o que é documento ou mídia vira uma linha da fila, que acompanha o envio e a preparação do
 * texto; a fila é uma só e cada aba mostra a sua parte. O que chega à aba errada vai para a certa,
 * com um aviso e o atalho. Imagem solta ou colada vai para Quadro e espera o botão: nada é enviado
 * sem confirmação.
 */
export interface PropsDoAdicionar {
  ir: (destino: Rota, substituir?: boolean) => void;
  aba?: AbaDeAdicionar;
  /** `colar`: abre o Documento com o foco no texto colado. */
  modo?: 'colar';
  /** Arquivos soltos (ou a imagem colada) no Início ou na Biblioteca. */
  arquivosIniciais?: File[];
  /** Atalho dos testes antigos: troca só o envio de documentos. */
  enviar?: (formulario: FormData) => Promise<DocumentoCriado>;
  servicos?: Partial<ServicosDaImportacao>;
  operacoesDosQuadros?: Pick<OperacoesDosQuadros, 'adicionar'>;
}

type TipoDoItem = TipoDeArquivo | 'colado' | 'youtube';
type TipoDoTexto = 'automatico' | 'prosa' | 'poesia';
type AbaDaFila = Exclude<AbaDeAdicionar, 'quadro'>;
type Estado =
  | { fase: 'na_fila' }
  | { fase: 'falta_transcricao' }
  | { fase: 'aguardando' }
  | { fase: 'enviando'; passo: string }
  | { fase: 'enviado'; documento_id: string; texto: 'preparando' | 'pronto' | 'falhou' | 'sem_resposta'; detalhe?: string | null;
    tentativas: number; semTexto?: number; transcricao?: 'pedida' | 'falhou';
    midia?: { sha256: string; tipo: 'video' | 'audio'; dados: TranscricaoV1; fase: 'esperando_texto' | 'publicando' | 'pronta' | 'falhou'; motivo?: string } }
  | { fase: 'recusado'; motivo: string; existente?: string };

interface Item {
  chave: number;
  tipo: TipoDoItem;
  /** A aba em que a linha aparece. */
  aba: AbaDaFila;
  nome: string;
  arquivo?: File;
  transcricao?: File;
  texto?: string;
  url?: string;
  titulo: string;
  autor: string;
  paginas: string;
  tipoDoTexto: TipoDoTexto;
  opcoesAbertas: boolean;
  estado: Estado;
}

/** Cerca de dez minutos esperando o texto ficar pronto; depois disso, a biblioteca acompanha. */
const TENTATIVAS_MAXIMAS = 240;
const FAIXA_DE_PAGINAS = /^[1-9][0-9]*-[1-9][0-9]*$/;

export const ROTULO_DA_ABA: Readonly<Record<AbaDeAdicionar, string>> = { documento: 'Documento', video: 'Vídeo', quadro: 'Quadro' };
const SUBTITULO: Readonly<Record<AbaDeAdicionar, string>> = {
  documento: 'PDFs, EPUBs, Markdown e TXT, ou um texto colado. O texto fica pronto em instantes; as marcas chegam depois.',
  video: 'Um vídeo do YouTube entra com a transcrição e toca ao lado dela, frase a frase.',
  quadro: 'A imagem de uma obra vira uma leitura guiada: as regiões da pintura, o que se vê e o que se sabe dela.',
};

let proximaChave = 1;
function novoItem(base: Omit<Item, 'chave' | 'titulo' | 'autor' | 'paginas' | 'tipoDoTexto' | 'opcoesAbertas' | 'estado' | 'aba'> & Partial<Item>): Item {
  const aba = abaDoTipo(base.tipo);
  return { titulo: '', autor: '', paginas: '', tipoDoTexto: 'automatico', opcoesAbertas: false, estado: { fase: 'na_fila' }, aba: aba === 'video' ? 'video' : 'documento', ...base, chave: proximaChave++ };
}

/** Os itens de um lote (sem as imagens): documentos, mídias com a sua transcrição, recusas com motivo. */
function itensDosArquivos(arquivos: File[], onde: AbaDaFila): Item[] {
  const tipos = new Map(arquivos.map((arquivo) => [arquivo, tipoDoArquivo(arquivo)]));
  const midias = arquivos.filter((arquivo) => ehMidia(tipos.get(arquivo)!));
  const { pares, sobras } = emparelharTranscricoes(midias, arquivos.filter((arquivo) => tipos.get(arquivo) === 'transcricao'));
  const itens: Item[] = [];
  for (const arquivo of arquivos) {
    const tipo = tipos.get(arquivo)!;
    if (tipo === 'transcricao' && !sobras.includes(arquivo)) continue;
    // O que nenhuma aba recebe fica onde foi solto, recusado com o motivo.
    const base = { tipo, nome: arquivo.name, arquivo, ...(abaDoTipo(tipo) === null ? { aba: onde } : {}) };
    if (tipo === 'transcricao') {
      itens.push(novoItem({ ...base, estado: { fase: 'recusado', motivo: 'Transcrição sem vídeo ou áudio: solte-a junto com o arquivo de mídia.' } }));
      continue;
    }
    const recusa = recusaLocal(arquivo, tipo);
    if (recusa) { itens.push(novoItem({ ...base, estado: { fase: 'recusado', motivo: recusa } })); continue; }
    if (ehMidia(tipo)) {
      const transcricao = pares.get(arquivo);
      itens.push(novoItem({ ...base, ...(transcricao ? { transcricao } : {}), estado: { fase: transcricao ? 'na_fila' : 'falta_transcricao' } }));
      continue;
    }
    itens.push(novoItem({ ...base, titulo: tituloAutomatico(tipo) ? '' : tituloDoNome(arquivo.name) }));
  }
  return itens;
}

const ICONE: Readonly<Record<TipoDoItem, string>> = {
  pdf: 'pdf', epub: 'livro', md: 'texto', txt: 'texto', colado: 'aspas', video: 'video-doc', audio: 'ouvir',
  youtube: 'video-doc', transcricao: 'arquivo', imagem: 'imagem', desconhecido: 'arquivo',
};

/**
 * U-02: o que ainda não terminou de entrar e se perde ao sair da tela (a fila vive nela): os arquivos
 * esperando ou em envio e as mídias cujo texto ainda não foi ligado ao vídeo ou ao áudio.
 */
export function pendentesDaImportacao(itens: readonly Pick<Item, 'estado'>[]): { envios: number; midias: number } {
  let envios = 0; let midias = 0;
  for (const { estado } of itens) {
    if (estado.fase === 'aguardando' || estado.fase === 'enviando') envios += 1;
    else if (estado.fase === 'enviado' && (estado.midia?.fase === 'esperando_texto' || estado.midia?.fase === 'publicando') && estado.texto !== 'falhou' && estado.texto !== 'sem_resposta') midias += 1;
  }
  return { envios, midias };
}

/** As frases da confirmação de saída. */
export function frasesDaSaida({ envios, midias }: { envios: number; midias: number }): string[] {
  return [
    ...(envios > 0 ? [`${String(envios)} ${envios === 1 ? 'arquivo ainda não foi enviado' : 'arquivos ainda não foram enviados'}.`] : []),
    ...(midias > 0 ? [`${String(midias)} ${midias === 1 ? 'vídeo ou áudio ainda está sendo ligado' : 'vídeos ou áudios ainda estão sendo ligados'} à transcrição.`] : []),
  ];
}

/** O que foi para outra aba no último lote, para o aviso com o atalho. */
interface Desvio { aba: AbaDeAdicionar; quantos: number }

export function Adicionar({ ir, aba: abaPedida = 'documento', modo, arquivosIniciais = [], enviar, servicos: parciais, operacoesDosQuadros = OPERACOES_DOS_QUADROS }: PropsDoAdicionar): ReactNode {
  const servicos: ServicosDaImportacao = { ...SERVICOS_PADRAO, ...(enviar ? { enviarDocumento: enviar } : {}), ...parciais };
  const servicosRef = useRef(servicos); servicosRef.current = servicos;
  const arte = usarRecurso('arte');
  // Com os quadros desligados, a aba Quadro some e o endereço dela mostra Documento.
  const aba: AbaDeAdicionar = abaPedida === 'quadro' && !arte ? 'documento' : abaPedida;
  const abaRef = useRef(aba); abaRef.current = aba;
  const abas = (['documento', 'video', 'quadro'] as const).filter((valor) => valor !== 'quadro' || arte);
  const { despachar } = usarOnboarding();
  const [itens, definirItensBrutos] = useState<Item[]>([]);
  const itensRef = useRef(itens);
  const mudar = (fazer: (atuais: Item[]) => Item[]) => { itensRef.current = fazer(itensRef.current); definirItensBrutos(itensRef.current); };
  const atualizar = (chave: number, parcial: Partial<Item>) => mudar((atuais) => atuais.map((item) => item.chave === chave ? { ...item, ...parcial } : item));
  const [ocupado, definirOcupado] = useState(false);
  const ocupadoRef = useRef(false);
  // Sair da tela encerra o lote: o item em curso termina, os seguintes não são enviados.
  const montado = useRef(true);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  // U-02: sair com envio ou vinculação pendente pede confirmação (navegação dentro do app e fechar a página).
  const pendentes = pendentesDaImportacao(itens);
  const haPendentes = pendentes.envios + pendentes.midias > 0;
  const haPendentesRef = useRef(haPendentes); haPendentesRef.current = haPendentes;
  const [saida, definirSaida] = useState<{ seguir: () => void } | null>(null);
  useEffect(() => segurarSaida((destino, seguir) => {
    if (destino.nome === 'adicionar' || !haPendentesRef.current) return false;
    definirSaida({ seguir });
    return true;
  }), []);
  useEffect(() => {
    if (!haPendentes) return undefined;
    const antesDeSair = (evento: BeforeUnloadEvent) => { evento.preventDefault(); evento.returnValue = ''; };
    window.addEventListener('beforeunload', antesDeSair);
    return () => { window.removeEventListener('beforeunload', antesDeSair); };
  }, [haPendentes]);
  // Terminou tudo enquanto a confirmação estava aberta: segue para onde a pessoa pediu.
  useEffect(() => { if (saida !== null && !haPendentes) { definirSaida(null); saida.seguir(); } }, [saida, haPendentes]);
  const [anuncio, anunciar] = useState('');
  const [desvios, definirDesvios] = useState<Desvio[]>([]);
  /** A imagem que espera na aba Quadro; `chave` refaz o formulário quando chega outra. */
  const [obra, definirObra] = useState<{ arquivo: File; chave: number } | null>(null);
  const [obraEnviada, definirObraEnviada] = useState<QuadroDaPessoaV1 | null>(null);
  /** Vídeo: o arquivo próprio (com a transcrição .json) é a opção avançada, atrás de um botão. */
  const [arquivoProprio, abrirArquivoProprio] = useState(false);
  const colado = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (modo === 'colar' && aba === 'documento') colado.current?.focus(); }, [modo, aba]);
  // Trocar de aba lembra a escolha (`/adicionar` volta a ela) e apaga o aviso do lote anterior.
  const abaAnterior = useRef(aba);
  useEffect(() => {
    guardarAba(aba);
    if (abaAnterior.current !== aba) definirDesvios([]);
    abaAnterior.current = aba;
  }, [aba]);
  const irPara = (destino: AbaDeAdicionar) => ir({ nome: 'adicionar', aba: destino });

  /**
   * Um lote solto, escolhido ou colado em `onde`. Documentos e mídias entram na fila (cada um na sua
   * aba); a imagem vai para Quadro e espera o botão. O que não é desta aba ganha o aviso com o atalho.
   */
  function acolher(arquivos: File[], onde: AbaDeAdicionar) {
    const imagens = arquivos.filter((arquivo) => tipoDoArquivo(arquivo) === 'imagem');
    const resto = arquivos.filter((arquivo) => tipoDoArquivo(arquivo) !== 'imagem');
    const novos = itensDosArquivos(resto, onde === 'quadro' ? 'documento' : onde);
    if (!arte) {
      for (const imagem of imagens) novos.push(novoItem({ tipo: 'imagem', nome: imagem.name, arquivo: imagem, aba: onde === 'video' ? 'video' : 'documento', estado: { fase: 'recusado', motivo: 'Imagens entram como quadros, e os quadros estão desligados nesta instalação.' } }));
    }
    acrescentar(novos);
    const contagem = new Map<AbaDeAdicionar, number>();
    for (const item of novos) if (item.aba !== onde && item.estado.fase !== 'recusado') contagem.set(item.aba, (contagem.get(item.aba) ?? 0) + 1);
    if (arte && imagens[0]) {
      definirObra({ arquivo: imagens[0], chave: proximaChave++ });
      definirObraEnviada(null);
      if (onde !== 'quadro') contagem.set('quadro', 1);
      if (imagens.length > 1) anunciar('Uma obra por vez: ficou a primeira imagem.');
    }
    definirDesvios([...contagem.entries()].map(([destino, quantos]) => ({ aba: destino, quantos })));
  }

  // Os arquivos soltos no Início ou na Biblioteca entram uma vez, ao abrir a página.
  const iniciais = useRef(arquivosIniciais);
  useEffect(() => { if (iniciais.current.length) acolher(iniciais.current, abaRef.current); iniciais.current = []; }, []);
  // Soltar fora das áreas leva cada arquivo à sua aba; colar uma imagem a leva para Quadro, sem enviar.
  useEffect(() => {
    const soltar = (evento: DragEvent) => {
      const arquivos = Array.from(evento.dataTransfer?.files ?? []);
      if (!arquivos.length || evento.defaultPrevented) return;
      evento.preventDefault();
      acolher(arquivos, abaRef.current);
    };
    const colar = (evento: ClipboardEvent) => {
      const imagens = imagensColadas(evento.clipboardData);
      if (imagens.length === 0) return;
      evento.preventDefault();
      acolher(imagens.slice(0, 1), 'quadro');
      if (arte && abaRef.current !== 'quadro') irPara('quadro');
    };
    // "Abrir com" com Adicionar já aberta (U-08): entram na fila do Documento, sem enviar.
    const abertos = (evento: Event) => {
      const arquivos = (evento as CustomEvent<unknown>).detail;
      if (!Array.isArray(arquivos) || arquivos.length === 0) return;
      acolher(arquivos.filter((arquivo): arquivo is File => arquivo instanceof File), 'documento');
      if (abaRef.current !== 'documento') irPara('documento');
    };
    window.addEventListener('drop', soltar); window.addEventListener('paste', colar); window.addEventListener(EVENTO_ARQUIVOS_ABERTOS, abertos);
    return () => { window.removeEventListener('drop', soltar); window.removeEventListener('paste', colar); window.removeEventListener(EVENTO_ARQUIVOS_ABERTOS, abertos); };
  }, [arte]);

  function acrescentar(novos: Item[]) {
    if (!novos.length) return;
    mudar((atuais) => [...atuais, ...novos]);
    const prontos = novos.filter((item) => item.estado.fase === 'na_fila').length;
    anunciar(`${String(novos.length)} ${novos.length === 1 ? 'item entrou' : 'itens entraram'} na fila${prontos < novos.length ? `; ${String(novos.length - prontos)} ${novos.length - prontos === 1 ? 'precisa' : 'precisam'} de atenção` : ''}.`);
  }

  function criado(chave: number, resposta: DocumentoCriado, extra: Partial<Extract<Estado, { fase: 'enviado' }>> = {}) {
    despachar({ tipo: 'registrar_documento', origem: 'importado', documento_id: resposta.documento_id });
    atualizar(chave, { estado: { fase: 'enviado', documento_id: resposta.documento_id, texto: 'preparando', tentativas: 0, ...extra } });
  }

  async function enviarItem(item: Item): Promise<void> {
    const s = servicosRef.current;
    const passo = (texto: string) => atualizar(item.chave, { estado: { fase: 'enviando', passo: texto } });
    try {
      if (item.tipo === 'youtube') {
        passo('Pedindo o vídeo…');
        criado(item.chave, await s.importarYoutube({ url: item.url!, ...(item.titulo.trim() ? { titulo: item.titulo.trim() } : {}), ...(item.autor.trim() ? { autor: item.autor.trim() } : {}) }));
        return;
      }
      if (ehMidia(item.tipo)) {
        passo('Lendo a transcrição…');
        const dados = lerTranscricao(JSON.parse(await lerTextoDoArquivo(item.transcricao!)) as unknown);
        passo(item.tipo === 'video' ? 'Enviando o vídeo…' : 'Enviando o áudio…');
        const midia = await s.enviarMidia(item.arquivo!);
        passo('Criando o texto da transcrição…');
        const formulario = new FormData();
        formulario.set('formato', 'txt');
        formulario.set('titulo', item.titulo.trim() || dados.titulo?.trim() || tituloDoNome(item.nome));
        const autor = item.autor.trim() || dados.canal?.trim() || '';
        if (autor) formulario.set('autor', autor);
        formulario.set('arquivo', new File([textoDaTranscricao(dados)], `${tituloDoNome(item.nome)}.txt`, { type: 'text/plain' }));
        criado(item.chave, await s.enviarDocumento(formulario), { midia: { sha256: midia.sha256, tipo: midia.tipo, dados, fase: 'esperando_texto' } });
        return;
      }
      const formulario = new FormData();
      const formato = item.tipo === 'colado' ? 'colado' : item.tipo;
      if (item.tipo === 'pdf' && item.paginas.trim() !== '') {
        if (!FAIXA_DE_PAGINAS.test(item.paginas.trim())) throw new Error('Páginas: use um intervalo como 12-25.');
        formulario.set('paginas', item.paginas.trim());
      }
      formulario.set('formato', formato);
      if (item.tipo === 'colado') formulario.set('texto', item.texto ?? '');
      else formulario.set('arquivo', item.arquivo!);
      // PDF e EPUB vão sem título quando a pessoa não digitou: o serviço usa o dos metadados.
      formulario.set('titulo', item.titulo.trim() || (tituloAutomatico(item.tipo) ? '' : item.tipo === 'colado' ? tituloDoTexto(item.texto ?? '') : tituloDoNome(item.nome)));
      if (item.autor.trim()) formulario.set('autor', item.autor.trim());
      if (aceitaPoesia(item.tipo) && item.tipoDoTexto === 'poesia') formulario.set('poesia', '1');
      passo('Enviando…');
      criado(item.chave, await s.enviarDocumento(formulario));
    } catch (falha) {
      const existente = documentoExistente(falha);
      const motivo = item.tipo === 'youtube' && falha instanceof ErroDaApi && falha.status === 404
        ? 'A importação de vídeos do YouTube ainda não está disponível nesta versão do Margem.'
        : item.tipo === 'youtube' && falha instanceof ErroDaApi && falha.status === 400 ? `O link não foi aceito: ${falha.detalhe ?? 'não parece um vídeo do YouTube.'}`
          : motivoDaFalha(falha);
      atualizar(item.chave, { estado: { fase: 'recusado', motivo, ...(existente ? { existente } : {}) } });
    }
  }

  async function processar() {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true; definirOcupado(true);
    try {
      for (;;) {
        if (!montado.current) break;
        const proximo = itensRef.current.find((item) => item.estado.fase === 'aguardando');
        if (!proximo) break;
        const pendentes = itensRef.current.filter((item) => ['aguardando', 'enviando'].includes(item.estado.fase)).length;
        anunciar(`Enviando ${proximo.nome}${pendentes > 1 ? ` (${String(pendentes - 1)} depois deste)` : ''}.`);
        await enviarItem(proximo);
      }
    } finally {
      ocupadoRef.current = false;
      if (montado.current) {
        definirOcupado(false);
        const atuais = itensRef.current;
        const enviados = atuais.filter((item) => item.estado.fase === 'enviado').length;
        const recusados = atuais.filter((item) => item.estado.fase === 'recusado').length;
        anunciar(`Envio concluído: ${String(enviados)} ${enviados === 1 ? 'enviado' : 'enviados'}, ${String(recusados)} ${recusados === 1 ? 'recusado' : 'recusados'}.`);
      }
    }
  }

  function agendar(filtro: (item: Item) => boolean) {
    mudar((atuais) => atuais.map((item) => filtro(item) && item.estado.fase === 'na_fila' ? { ...item, opcoesAbertas: false, estado: { fase: 'aguardando' } } : item));
    void processar();
  }

  // Depois do envio: acompanha a preparação do texto, publica a mídia e oferece transcrever o escaneado.
  const emConsulta = useRef(new Set<number>());
  const preparando = itens.some((item) => item.estado.fase === 'enviado' && item.estado.texto === 'preparando');
  useEffect(() => {
    if (!preparando) return;
    const relogio = setTimeout(() => {
      const s = servicosRef.current;
      const alvos = itensRef.current.filter((item) => item.estado.fase === 'enviado' && item.estado.texto === 'preparando' && !emConsulta.current.has(item.chave));
      void Promise.all(alvos.map(async (item) => {
        emConsulta.current.add(item.chave);
        const estado = item.estado as Extract<Estado, { fase: 'enviado' }>;
        let proximo: Extract<Estado, { fase: 'enviado' }> = { ...estado, tentativas: estado.tentativas + 1 };
        try {
          const documento = await s.obterDocumento(estado.documento_id);
          if (documento.versao_id) {
            proximo = { ...proximo, texto: 'pronto', ...(documento.formato === 'pdf' && (documento.paginas_sem_texto ?? 0) > 0 ? { semTexto: documento.paginas_sem_texto } : {}) };
            if (estado.midia) proximo = { ...proximo, midia: { ...estado.midia, fase: 'publicando' } };
          } else if (documento.estado === 'falhou') proximo = { ...proximo, texto: 'falhou', detalhe: documento.detalhe };
          else if (proximo.tentativas >= TENTATIVAS_MAXIMAS) proximo = { ...proximo, texto: 'sem_resposta' };
          if (!montado.current) return;
          atualizar(item.chave, { estado: proximo });
          if (proximo.texto === 'pronto') anunciar(`${item.nome}: texto pronto.`);
          if (proximo.midia?.fase === 'publicando' && documento.versao_id) await publicar(item.chave, proximo, documento.versao_id);
        } catch {
          // Falha passageira ao consultar: tenta de novo na próxima volta, até o limite.
          if (montado.current) atualizar(item.chave, { estado: proximo.tentativas >= TENTATIVAS_MAXIMAS ? { ...proximo, texto: 'sem_resposta' } : proximo });
        } finally { emConsulta.current.delete(item.chave); }
      }));
    }, servicos.intervalo);
    return () => { clearTimeout(relogio); };
  // `itens` reabre a espera a cada volta; a função lê o estado atual por `itensRef`.
  }, [itens, preparando, servicos.intervalo]);

  async function publicar(chave: number, estado: Extract<Estado, { fase: 'enviado' }>, versaoId: string) {
    const midia = estado.midia!;
    const t = midia.dados;
    const fonte = t.url && /^https:\/\//.test(t.url) ? { url: t.url, ...(t.canal ? { canal: t.canal } : {}), ...(t.publicado_em ? { publicado_em: t.publicado_em.slice(0, 10) } : {}) } : null;
    const item = itensRef.current.find((atual) => atual.chave === chave);
    try {
      await servicosRef.current.publicarMidia(estado.documento_id, {
        versao_id: versaoId, sha256: midia.sha256, titulo: item?.titulo.trim() || t.titulo?.trim() || tituloDoNome(item?.nome ?? 'Mídia'),
        ...(fonte ? { fonte } : {}), capitulos: t.capitulos,
        transcricao: { motor: t.motor, idioma: t.idioma ?? 'pt', palavras: t.palavras.map(({ texto, inicio_s, fim_s }) => ({ texto, inicio_s, fim_s })) },
      });
      atualizar(chave, { estado: { ...estado, midia: { ...midia, fase: 'pronta' } } });
      anunciar(`${item?.nome ?? 'Mídia'}: ${midia.tipo === 'video' ? 'vídeo' : 'áudio'} pronto.`);
    } catch (falha) {
      atualizar(chave, { estado: { ...estado, midia: { ...midia, fase: 'falhou', motivo: motivoDaFalha(falha) } } });
    }
  }

  async function transcreverEscaneado(item: Item) {
    const estado = item.estado as Extract<Estado, { fase: 'enviado' }>;
    try {
      await servicosRef.current.transcrever(estado.documento_id);
      atualizar(item.chave, { estado: { ...estado, transcricao: 'pedida' } });
      anunciar(`${item.nome}: transcrição das páginas pedida.`);
    } catch {
      atualizar(item.chave, { estado: { ...estado, transcricao: 'falhou' } });
    }
  }

  function anexarTranscricao(item: Item, arquivo: File) {
    if (tipoDoArquivo(arquivo) !== 'transcricao') { anunciar('A transcrição precisa ser um arquivo .json.'); return; }
    atualizar(item.chave, { transcricao: arquivo, estado: { fase: 'na_fila' } });
    anunciar(`${item.nome}: transcrição anexada.`);
  }

  const abrirDocumento = (id: string) => (e: React.MouseEvent) => {
    // Com a fila andando, abre em outra aba para não interromper os envios.
    if (ocupadoRef.current) return;
    e.preventDefault(); ir({ nome: 'documento', documento_id: id });
  };

  /** A fila da aba: só as linhas dela, com o botão que envia só elas. */
  const fila = (alvo: AbaDaFila) => {
    const lista = itens.filter((item) => item.aba === alvo);
    const naFila = lista.filter((item) => item.estado.fase === 'na_fila');
    if (lista.length === 0) return null;
    return <div className="fila">
      <div className="fila-topo">
        <h3 id={`fila-titulo-${alvo}`}>Fila</h3>
        {lista.some((item) => ['enviado', 'recusado'].includes(item.estado.fase)) && !ocupado && <Button variante="ghost" className="small" onClick={() => mudar((atuais) => atuais.filter((item) => item.aba !== alvo || !['enviado', 'recusado'].includes(item.estado.fase)))}>Limpar concluídos</Button>}
      </div>
      <ul className="fila-lista" aria-labelledby={`fila-titulo-${alvo}`}>
        {lista.map((item) => <LinhaDaFila key={item.chave} item={item} ocupado={ocupado} abrir={abrirDocumento}
          mudar={(parcial) => atualizar(item.chave, parcial)} remover={() => mudar((atuais) => atuais.filter((atual) => atual.chave !== item.chave))}
          repetir={() => atualizar(item.chave, { estado: { fase: 'na_fila' }, opcoesAbertas: true })}
          transcrever={() => void transcreverEscaneado(item)} anexar={(arquivo) => anexarTranscricao(item, arquivo)} />)}
      </ul>
      {naFila.length > 0 && <div className="button-row fila-acoes">
        <Button variante="primario" disabled={ocupado} onClick={() => agendar((item) => item.aba === alvo && item.estado.fase === 'na_fila')}>
          {naFila.length === 1 ? 'Adicionar 1 arquivo' : `Adicionar ${String(naFila.length)} arquivos`}
        </Button>
      </div>}
    </div>;
  };

  return <div className="importar">
    <header className="importar-topo">
      <h1 className="page-title">Adicionar à biblioteca</h1>
      <p className="importar-sub">{SUBTITULO[aba]}</p>
    </header>
    <nav className="biblioteca-abas importar-abas" aria-label="O que adicionar" data-abas={abas.length}>
      {abas.map((valor) => <Button key={valor} variante="ghost" aria-current={aba === valor ? 'page' : undefined} onClick={() => irPara(valor)}>{ROTULO_DA_ABA[valor]}</Button>)}
    </nav>
    {desvios.length > 0 && <div className="importar-desvio" role="status">
      {desvios.map(({ aba: destino, quantos }) => <p key={destino}>
        <span>{destino === 'quadro' ? 'A imagem foi para a aba Quadro e espera a sua confirmação.' : `${String(quantos)} ${quantos === 1 ? 'arquivo foi' : 'arquivos foram'} para a aba ${ROTULO_DA_ABA[destino]}.`}</span>
        <Button variante="ghost" className="small" onClick={() => irPara(destino)}>Ir para {ROTULO_DA_ABA[destino]} <Icon name="arrow" size={14} /></Button>
      </p>)}
    </div>}
    {aba === 'documento' && <div className="importar-grade">
      <section className="card importar-principal" aria-labelledby="importar-arquivos">
        <h2 id="importar-arquivos" className="apenas-leitores">Arquivos</h2>
        <AreaDeSoltar aceitos={ACEITOS_POR_ABA.documento} titulo="Solte PDFs, EPUBs, Markdown ou TXT" texto="Vários de uma vez."
          formatos={`.pdf · .epub · .md · .txt · até ${tamanhoLegivel(LIMITE_DOCUMENTO_BYTES)} por arquivo`} aoEscolher={(arquivos) => acolher(arquivos, 'documento')} />
        {fila('documento')}
      </section>
      <div className="importar-lado">
        <EntradaColada referencia={colado} aoAdicionar={(texto, titulo, autor, tipoDoTexto) => {
          acrescentar([novoItem({ tipo: 'colado', nome: titulo || tituloDoTexto(texto), texto, titulo, autor, tipoDoTexto, estado: { fase: 'aguardando' } })]);
          void processar();
        }} />
        <PaginaDaWeb ir={ir} />
      </div>
    </div>}
    {aba === 'video' && <div className="importar-coluna">
      <EntradaDeLink ir={ir} aoImportar={(url, link) => { acrescentar([novoItem({ tipo: 'youtube', nome: link, url, estado: { fase: 'aguardando' } })]); void processar(); }} />
      {itens.some((item) => item.aba === 'video') && <section className="card importar-principal" aria-label="Fila de vídeos">{fila('video')}</section>}
      {arquivoProprio || itens.some((item) => item.aba === 'video' && item.tipo !== 'youtube')
        ? <ArquivoProprio aoEscolher={(arquivos) => acolher(arquivos, 'video')} />
        : <Button variante="ghost" className="importar-mais" aria-expanded={false} onClick={() => abrirArquivoProprio(true)}><Icon name="upload" size={16} /> Tenho o arquivo do vídeo e a transcrição</Button>}
    </div>}
    {aba === 'quadro' && <div className="importar-grade">
      <section className="card importar-principal" aria-labelledby="importar-obra">
        <h2 id="importar-obra" className="apenas-leitores">Obra</h2>
        {obraEnviada ? <div className="importar-obra-enviada" role="status">
          <p><strong>A obra entrou na fila de preparo.</strong> Ela aparece em Quadros com o progresso; a análise leva alguns minutos.</p>
          <div className="button-row">
            <Button variante="primario" onClick={() => ir({ nome: 'biblioteca', tipo: 'quadros' })}>Ver em Quadros</Button>
            <Button variante="ghost" onClick={() => { definirObraEnviada(null); definirObra(null); }}>Adicionar outra</Button>
          </div>
        </div> : <FormularioDaObra key={obra?.chave ?? 0} arquivoInicial={obra?.arquivo ?? null} operacoes={operacoesDosQuadros} rotulo="Adicionar obra"
          aoAdicionar={(novo) => { definirObraEnviada(novo); definirObra(null); anunciar('Obra enviada.'); }} />}
      </section>
      <section className="card importar-entrada" aria-labelledby="importar-sobre-quadros">
        <h2 id="importar-sobre-quadros">Como fica</h2>
        <p className="importar-dica">O Margem reconhece a obra pela imagem, procura fontes públicas e prepara uma leitura guiada: percorre a pintura por regiões, separa o que se vê do que se sabe e narra.</p>
        <p className="importar-dica">Use uma imagem sua ou de domínio público. Sem título e artista, o reconhecimento é feito pela imagem, e você pode corrigir depois.</p>
      </section>
    </div>}
    <p className="apenas-leitores" role="status" aria-live="polite">{anuncio}</p>
    {saida !== null && haPendentes && <ConfirmarSaida frases={frasesDaSaida(pendentes)} total={pendentes.envios + pendentes.midias} aoContinuar={() => definirSaida(null)}
      aoSair={() => { const { seguir } = saida; definirSaida(null); seguir(); }} />}
  </div>;
}

/** U-02: sair de Adicionar com envio pendente. "Continuar importando" é o padrão (Enter e Esc). */
function ConfirmarSaida({ frases, total, aoContinuar, aoSair }: { frases: string[]; total: number; aoContinuar: () => void; aoSair: () => void }): ReactNode {
  const raiz = useRef<HTMLDivElement>(null);
  const continuar = useRef<HTMLButtonElement>(null);
  usarFoco(raiz, aoContinuar);
  useEffect(() => { continuar.current?.focus({ preventScroll: true }); }, []);
  return <div className="ui-veu veu-da-saida">
    <div ref={raiz} role="alertdialog" aria-modal="true" aria-labelledby="titulo-da-saida" aria-describedby="texto-da-saida" tabIndex={-1} className="dialogo-da-saida">
      <h2 id="titulo-da-saida">{frases[0]}</h2>
      <div id="texto-da-saida" className="texto-da-saida">
        {frases.slice(1).map((frase) => <p key={frase}>{frase}</p>)}
        <p>Se sair agora, {total === 1 ? 'ele não termina' : 'eles não terminam'} de entrar na biblioteca.</p>
      </div>
      <div className="ui-rodape">
        <Button variante="ghost" tamanho="md" onClick={aoSair}>Sair mesmo assim</Button>
        <Button ref={continuar} variante="primario" tamanho="md" onClick={aoContinuar}>Continuar importando</Button>
      </div>
    </div>
  </div>;
}

function AreaDeSoltar({ aceitos, titulo, texto, formatos, aoEscolher }: { aceitos: string; titulo: string; texto: string; formatos: string; aoEscolher: (arquivos: File[]) => void }): ReactNode {
  const entrada = useRef<HTMLInputElement>(null);
  const [arrastando, arrastar] = useState(false);
  return <div className="dropzone importar-soltar" data-arrastando={arrastando}
    onDragOver={(e) => { e.preventDefault(); arrastar(true); }} onDragLeave={() => arrastar(false)}
    onDrop={(e) => { e.preventDefault(); arrastar(false); const novos = Array.from(e.dataTransfer.files); if (novos.length) aoEscolher(novos); }}>
    <span className="importar-soltar-icone" aria-hidden="true"><Icon name="upload" size={26} /></span>
    <p className="importar-soltar-titulo">{titulo}</p>
    <p className="importar-soltar-texto">{texto}</p>
    <input ref={entrada} type="file" multiple hidden aria-label="Arquivo" accept={aceitos}
      onChange={(e) => { const novos = Array.from(e.target.files ?? []); if (novos.length) aoEscolher(novos); e.target.value = ''; }} />
    <Button onClick={() => entrada.current?.click()}>Escolher arquivos</Button>
    <small className="importar-limites">{formatos}</small>
  </div>;
}

/** Vídeo ou áudio do próprio computador: a opção avançada da aba Vídeo, explicada uma vez só. */
function ArquivoProprio({ aoEscolher }: { aoEscolher: (arquivos: File[]) => void }): ReactNode {
  return <section className="card importar-entrada" aria-labelledby="importar-arquivo-proprio">
    <h2 id="importar-arquivo-proprio">Arquivo próprio</h2>
    <p className="importar-dica">Um vídeo ou áudio do seu computador entra junto com a transcrição em JSON, no formato do Margem (feita pelo Whisper, fora do app). O Margem ainda não transcreve sozinho. O texto vira um documento e a mídia toca alinhada a ele.</p>
    <AreaDeSoltar aceitos={ACEITOS_POR_ABA.video} titulo="Solte o vídeo ou o áudio e a transcrição" texto="Os dois juntos; o par se forma pelo nome."
      formatos={`.mp4 · .mov · .webm · .mkv · .mp3 · .m4a · .ogg + .json · até ${tamanhoLegivel(LIMITE_MIDIA_BYTES)}`} aoEscolher={aoEscolher} />
  </section>;
}

/** Páginas da web não entram por aqui: o caminho é a extensão do navegador. */
function PaginaDaWeb({ ir }: { ir: (destino: Rota) => void }): ReactNode {
  const [extensao] = integracoes();
  return <section className="card importar-entrada" aria-labelledby="importar-web">
    <h2 id="importar-web">Página da web</h2>
    <p className="importar-dica">Artigos, notícias e PDFs abertos no navegador entram pela extensão do Margem, com um clique: ela guarda o texto limpo, com autor e data.</p>
    <div className="button-row">{extensao?.link
      ? <a className="button small" href={extensao.link} target="_blank" rel="noreferrer">Instalar a extensão<span className="apenas-leitores"> (nova aba)</span></a>
      : <a className="button small" href="/ajuda/extensao" onClick={(e) => { e.preventDefault(); ir({ nome: 'ajuda', pagina: 'extensao' }); }}>Instalar a extensão</a>}</div>
  </section>;
}

function textoDoEstado(item: Item): string {
  const e = item.estado;
  switch (e.fase) {
    case 'na_fila': return item.transcricao ? `Pronto para enviar, com ${item.transcricao.name}` : 'Pronto para enviar';
    case 'falta_transcricao': return 'Falta a transcrição';
    case 'aguardando': return 'Aguardando';
    case 'enviando': return e.passo;
    case 'recusado': return `Recusado: ${e.motivo}`;
    case 'enviado': {
      // U-04: o detalhe do serviço só vai à tela quando é uma frase (um código como `motor_falhou` fica no registro).
      if (e.texto === 'falhou') return `Não foi possível preparar o texto${e.detalhe && !/^[a-z0-9_]+$/iu.test(e.detalhe.trim()) ? `: ${e.detalhe}` : '.'}`;
      if (e.texto === 'sem_resposta') return 'Ainda preparando. Acompanhe pela biblioteca.';
      if (e.texto === 'preparando') return item.tipo === 'youtube' ? 'Preparando a transcrição do vídeo…' : 'Preparando o texto…';
      if (e.midia) {
        const nome = e.midia.tipo === 'video' ? 'vídeo' : 'áudio';
        if (e.midia.fase === 'pronta') return `Pronto: texto e ${nome} alinhados. As marcas chegam depois.`;
        if (e.midia.fase === 'falhou') return `Texto pronto, mas o ${nome} não foi ligado: ${e.midia.motivo ?? 'falha'}`;
        return `Texto pronto; ligando o ${nome}…`;
      }
      return 'Texto pronto. As marcas chegam depois.';
    }
  }
}

interface PropsDaLinha {
  item: Item; ocupado: boolean;
  abrir: (id: string) => (e: React.MouseEvent) => void;
  mudar: (parcial: Partial<Item>) => void; remover: () => void; repetir: () => void; transcrever: () => void; anexar: (arquivo: File) => void;
}

function LinhaDaFila({ item, ocupado, abrir, mudar, remover, repetir, transcrever, anexar }: PropsDaLinha): ReactNode {
  const e = item.estado;
  const seletorDaTranscricao = useRef<HTMLInputElement>(null);
  const editavel = e.fase === 'na_fila' || e.fase === 'falta_transcricao';
  const temOpcoes = editavel && item.tipo !== 'colado' && item.tipo !== 'youtube';
  const idDasOpcoes = `opcoes-${String(item.chave)}`;
  const tom = e.fase === 'recusado' || (e.fase === 'enviado' && (e.texto === 'falhou' || e.midia?.fase === 'falhou')) ? 'erro'
    : e.fase === 'enviado' && e.texto === 'pronto' && (!e.midia || e.midia.fase === 'pronta') ? 'pronto'
      : e.fase === 'falta_transcricao' ? 'atencao' : 'neutro';
  const documentoId = e.fase === 'enviado' ? e.documento_id : e.fase === 'recusado' ? e.existente : undefined;
  const tamanho = item.arquivo ? tamanhoLegivel(item.arquivo.size) : null;
  return <li className="item-fila" data-tom={tom}>
    <span className="item-icone" aria-hidden="true"><Icon name={ICONE[item.tipo]} size={20} /></span>
    <div className="item-corpo">
      <p className="item-nome">{item.nome}</p>
      <p className="item-meta"><span className="badge">{ROTULO_DO_TIPO[item.tipo]}</span>{tamanho && <span>{tamanho}</span>}<span className="item-estado">{textoDoEstado(item)}</span></p>
      {e.fase === 'falta_transcricao' && <div className="item-nota">
        <p>Junte a transcrição <code>.json</code> deste arquivo.</p>
        <input ref={seletorDaTranscricao} type="file" hidden accept=".json,application/json" aria-label={`Transcrição de ${item.nome}`}
          onChange={(ev) => { const arquivo = ev.target.files?.[0]; if (arquivo) anexar(arquivo); ev.target.value = ''; }} />
        <Button className="small" onClick={() => seletorDaTranscricao.current?.click()}>Escolher a transcrição</Button>
      </div>}
      {e.fase === 'enviado' && e.texto === 'pronto' && (e.semTexto ?? 0) > 0 && <div className="item-nota">
        {e.transcricao === 'pedida'
          ? <p>Transcrevendo {e.semTexto} {e.semTexto === 1 ? 'página' : 'páginas'} por visão. O texto delas chega aos poucos.</p>
          : <><p>{e.semTexto} {e.semTexto === 1 ? 'página não tem' : 'páginas não têm'} camada de texto (PDF escaneado). Dá para transcrevê-las por visão.{e.transcricao === 'falhou' ? ' A última tentativa falhou.' : ''}</p>
            <Button className="small" onClick={transcrever}>Transcrever as páginas</Button></>}
      </div>}
    </div>
    <div className="item-acoes">
      {temOpcoes && <Button variante="ghost" className="small" aria-expanded={item.opcoesAbertas} aria-controls={idDasOpcoes} onClick={() => mudar({ opcoesAbertas: !item.opcoesAbertas })}>
        Mais opções<span className="apenas-leitores">: {item.nome}</span>
      </Button>}
      {documentoId && <a className={classesDoBotao({ tamanho: 'md' })} href={`/documentos/${documentoId}`} target={ocupado ? '_blank' : undefined} rel="noreferrer" onClick={abrir(documentoId)}>
        {e.fase === 'recusado' ? 'Abrir o existente' : 'Abrir'}<span className="apenas-leitores">: {item.nome}{ocupado ? ' (nova aba)' : ''}</span>
      </a>}
      {e.fase === 'recusado' && !e.existente && (item.arquivo && ehDocumento(item.tipo) || item.tipo === 'colado' || (ehMidia(item.tipo) && item.transcricao)) && <Button variante="ghost" className="small" onClick={repetir}>Tentar de novo<span className="apenas-leitores">: {item.nome}</span></Button>}
    </div>
    {(editavel || e.fase === 'recusado') && <Button variante="ghost" className="small item-remover" aria-label={`Remover ${item.nome}`} onClick={remover}><Icon name="adicionar" size={16} /></Button>}
    {temOpcoes && item.opcoesAbertas && <OpcoesDoItem id={idDasOpcoes} item={item} mudar={mudar} />}
  </li>;
}

function OpcoesDoItem({ id, item, mudar }: { id: string; item: Item; mudar: (parcial: Partial<Item>) => void }): ReactNode {
  const marcador = item.tipo === 'pdf' ? 'Do próprio PDF' : item.tipo === 'epub' ? 'Do próprio livro' : ehMidia(item.tipo) ? 'Da transcrição' : undefined;
  return <div id={id} className="item-opcoes formulario">
    <div className="dupla">
      <label>Título<Input value={item.titulo} placeholder={marcador} autoComplete="off" onChange={(ev) => mudar({ titulo: ev.target.value })} /></label>
      <label>Autor<Input value={item.autor} placeholder={tituloAutomatico(item.tipo) ? 'Do próprio arquivo' : undefined} autoComplete="off" onChange={(ev) => mudar({ autor: ev.target.value })} /></label>
    </div>
    {item.tipo === 'pdf' && <label>Páginas<Input value={item.paginas} placeholder="Todas, ou um intervalo como 12-25" inputMode="numeric" onChange={(ev) => mudar({ paginas: ev.target.value })} /></label>}
    {aceitaPoesia(item.tipo) && <label>Tipo do texto<Select aria-label="Tipo do texto" value={item.tipoDoTexto} onChange={(ev) => mudar({ tipoDoTexto: ev.target.value as TipoDoTexto })}>
      <option value="automatico">Automático</option><option value="prosa">Prosa</option><option value="poesia">Poesia</option>
    </Select></label>}
  </div>;
}

function EntradaDeLink({ ir, aoImportar }: { ir: (destino: Rota) => void; aoImportar: (url: string, rotulo: string) => void }): ReactNode {
  const [valor, definirValor] = useState('');
  const [aviso, definirAviso] = useState<null | 'invalido' | 'pagina'>(null);
  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    const link = classificarLink(valor);
    if (link.tipo === 'invalido') { definirAviso('invalido'); return; }
    if (link.tipo === 'pagina') { definirAviso('pagina'); return; }
    definirAviso(null); aoImportar(link.url, valor.trim()); definirValor('');
  }
  return <section className="card importar-entrada" aria-labelledby="importar-link">
    <h2 id="importar-link">Link do YouTube</h2>
    <form className="importar-linha" onSubmit={aoEnviar}>
      <label className="apenas-leitores" htmlFor="importar-endereco">Endereço</label>
      <Input id="importar-endereco" value={valor} inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://youtu.be/…"
        aria-describedby="importar-link-dica" aria-invalid={aviso === 'invalido'} onChange={(e) => { definirValor(e.target.value); definirAviso(null); }} />
      <Button type="submit" variante="primario" disabled={valor.trim() === ''}>Trazer</Button>
    </form>
    <p id="importar-link-dica" className="importar-dica">O vídeo entra com a transcrição e toca pelo player oficial, alinhado ao texto: clique numa frase para ir ao momento.</p>
    {aviso === 'invalido' && <p className="aviso" role="alert">Isso não parece um endereço. Cole o link inteiro, como https://youtu.be/…</p>}
    {aviso === 'pagina' && <div className="aviso importar-extensao" role="alert">
      <p>Aqui entram vídeos do YouTube. Artigos e outras páginas entram pela extensão do Margem, no navegador: ela guarda o texto limpo, com autor e data.</p>
      <a href="/ajuda/extensao" onClick={(e) => { e.preventDefault(); ir({ nome: 'ajuda', pagina: 'extensao' }); }}>Como instalar a extensão <Icon name="arrow" size={14} /></a>
    </div>}
  </section>;
}

function EntradaColada({ referencia, aoAdicionar }: { referencia: React.RefObject<HTMLTextAreaElement>; aoAdicionar: (texto: string, titulo: string, autor: string, tipo: TipoDoTexto) => void }): ReactNode {
  const [texto, definirTexto] = useState('');
  const [titulo, definirTitulo] = useState('');
  const [autor, definirAutor] = useState('');
  const [tipo, definirTipo] = useState<TipoDoTexto>('automatico');
  const [mais, abrirMais] = useState(false);
  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    if (texto.trim() === '') return;
    aoAdicionar(texto, titulo.trim(), autor.trim(), tipo);
    definirTexto(''); definirTitulo(''); definirAutor(''); definirTipo('automatico'); abrirMais(false);
  }
  return <section className="card importar-entrada" aria-labelledby="importar-colar">
    <h2 id="importar-colar">Colar texto</h2>
    <form className="formulario importar-colado" onSubmit={aoEnviar}>
      <label>Título<Input value={titulo} placeholder="Da primeira linha" autoComplete="off" onChange={(e) => definirTitulo(e.target.value)} /></label>
      <label>Texto<Textarea ref={referencia} name="texto" rows={6} value={texto} onChange={(e) => definirTexto(e.target.value)} /></label>
      {mais && <div id="importar-colado-opcoes" className="dupla">
        <label>Autor<Input value={autor} autoComplete="off" onChange={(e) => definirAutor(e.target.value)} /></label>
        <label>Tipo do texto<Select aria-label="Tipo do texto" value={tipo} onChange={(e) => definirTipo(e.target.value as TipoDoTexto)}><option value="automatico">Automático</option><option value="prosa">Prosa</option><option value="poesia">Poesia</option></Select></label>
      </div>}
      <div className="button-row">
        <Button type="submit" variante="primario" disabled={texto.trim() === ''}>Adicionar texto</Button>
        <Button variante="ghost" className="small" aria-expanded={mais} aria-controls="importar-colado-opcoes" onClick={() => abrirMais(!mais)}>Mais opções</Button>
      </div>
    </form>
  </section>;
}
