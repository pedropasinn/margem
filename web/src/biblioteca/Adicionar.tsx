import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input, Textarea, Select } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import type { Rota } from './rotas';
import { usarOnboarding } from '../onboarding/ContextoDoOnboarding';
import { ErroDaApi } from './api';
import {
  ACEITOS, LIMITE_DOCUMENTO_BYTES, LIMITE_MIDIA_BYTES, ROTULO_DO_TIPO, SERVICOS_PADRAO,
  aceitaPoesia, classificarLink, documentoExistente, ehDocumento, ehMidia, emparelharTranscricoes, lerTextoDoArquivo, lerTranscricao, motivoDaFalha,
  recusaLocal, tamanhoLegivel, textoDaTranscricao, tipoDoArquivo, tituloAutomatico, tituloDoNome, tituloDoTexto,
  type DocumentoCriado, type ServicosDaImportacao, type TipoDeArquivo, type TranscricaoV1,
} from './importacao';
import { ImportacaoAvancada, OutrasFontes } from './OutrasFontes';

/**
 * Adicionar (J108): o lugar único para trazer qualquer coisa para a biblioteca. Uma área de soltar
 * aceita documento, vídeo e áudio de uma vez e encaminha cada um para a rota certa; ao lado, um link
 * (YouTube pelo serviço, outras páginas pela extensão) e o texto colado. Tudo o que entra vira uma
 * linha da fila, que acompanha o envio e depois a preparação do texto.
 */
export interface PropsDoAdicionar {
  ir: (destino: Rota) => void;
  arquivosIniciais?: File[];
  /** Atalho dos testes antigos: troca só o envio de documentos. */
  enviar?: (formulario: FormData) => Promise<DocumentoCriado>;
  servicos?: Partial<ServicosDaImportacao>;
  entradaInicial?: 'arquivo' | 'colado';
}

type TipoDoItem = TipoDeArquivo | 'colado' | 'youtube';
type TipoDoTexto = 'automatico' | 'prosa' | 'poesia';
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

let proximaChave = 1;
function novoItem(base: Omit<Item, 'chave' | 'titulo' | 'autor' | 'paginas' | 'tipoDoTexto' | 'opcoesAbertas' | 'estado'> & Partial<Item>): Item {
  return { titulo: '', autor: '', paginas: '', tipoDoTexto: 'automatico', opcoesAbertas: false, estado: { fase: 'na_fila' }, ...base, chave: proximaChave++ };
}

/** Os itens de um lote solto ou escolhido: documentos, mídias com a sua transcrição, recusas com motivo. */
function itensDosArquivos(arquivos: File[]): Item[] {
  const tipos = new Map(arquivos.map((arquivo) => [arquivo, tipoDoArquivo(arquivo)]));
  const midias = arquivos.filter((arquivo) => ehMidia(tipos.get(arquivo)!));
  const { pares, sobras } = emparelharTranscricoes(midias, arquivos.filter((arquivo) => tipos.get(arquivo) === 'transcricao'));
  const itens: Item[] = [];
  for (const arquivo of arquivos) {
    const tipo = tipos.get(arquivo)!;
    if (tipo === 'transcricao' && !sobras.includes(arquivo)) continue;
    const base = { tipo, nome: arquivo.name, arquivo };
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
  youtube: 'video-doc', transcricao: 'arquivo', desconhecido: 'arquivo',
};

export function Adicionar({ ir, arquivosIniciais = [], enviar, servicos: parciais, entradaInicial = 'arquivo' }: PropsDoAdicionar): ReactNode {
  const servicos: ServicosDaImportacao = { ...SERVICOS_PADRAO, ...(enviar ? { enviarDocumento: enviar } : {}), ...parciais };
  const servicosRef = useRef(servicos); servicosRef.current = servicos;
  const { despachar } = usarOnboarding();
  const [itens, definirItensBrutos] = useState<Item[]>(() => itensDosArquivos(arquivosIniciais));
  const itensRef = useRef(itens);
  const mudar = (fazer: (atuais: Item[]) => Item[]) => { itensRef.current = fazer(itensRef.current); definirItensBrutos(itensRef.current); };
  const atualizar = (chave: number, parcial: Partial<Item>) => mudar((atuais) => atuais.map((item) => item.chave === chave ? { ...item, ...parcial } : item));
  const [ocupado, definirOcupado] = useState(false);
  const ocupadoRef = useRef(false);
  // Sair da tela encerra o lote: o item em curso termina, os seguintes não são enviados.
  const montado = useRef(true);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  const [anuncio, anunciar] = useState('');
  const colado = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (entradaInicial === 'colado') colado.current?.focus(); }, [entradaInicial]);

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

  const naFila = itens.filter((item) => item.estado.fase === 'na_fila');
  const abrirDocumento = (id: string) => (e: React.MouseEvent) => {
    // Com a fila andando, abre em outra aba para não interromper os envios.
    if (ocupadoRef.current) return;
    e.preventDefault(); ir({ nome: 'documento', documento_id: id });
  };

  return <div className="importar">
    <header className="importar-topo">
      <h1 className="page-title">Adicionar à biblioteca</h1>
      <p className="importar-sub">Arquivos, links e textos entram por aqui. O texto fica pronto em instantes; as marcas chegam depois.</p>
    </header>
    <div className="importar-grade">
      <section className="card importar-principal" aria-labelledby="importar-arquivos">
        <h2 id="importar-arquivos" className="apenas-leitores">Arquivos</h2>
        <AreaDeSoltar aoEscolher={(arquivos) => acrescentar(itensDosArquivos(arquivos))} />
        {itens.length > 0 && <div className="fila">
          <div className="fila-topo">
            <h3 id="fila-titulo">Fila</h3>
            {itens.some((item) => ['enviado', 'recusado'].includes(item.estado.fase)) && !ocupado && <Button variante="ghost" className="small" onClick={() => mudar((atuais) => atuais.filter((item) => !['enviado', 'recusado'].includes(item.estado.fase)))}>Limpar concluídos</Button>}
          </div>
          <ul className="fila-lista" aria-labelledby="fila-titulo">
            {itens.map((item) => <LinhaDaFila key={item.chave} item={item} ocupado={ocupado} abrir={abrirDocumento}
              mudar={(parcial) => atualizar(item.chave, parcial)} remover={() => mudar((atuais) => atuais.filter((atual) => atual.chave !== item.chave))}
              repetir={() => atualizar(item.chave, { estado: { fase: 'na_fila' }, opcoesAbertas: true })}
              transcrever={() => void transcreverEscaneado(item)} anexar={(arquivo) => anexarTranscricao(item, arquivo)} />)}
          </ul>
          {naFila.length > 0 && <div className="button-row fila-acoes">
            <Button variante="primario" disabled={ocupado} onClick={() => agendar((item) => item.estado.fase === 'na_fila')}>
              {naFila.length === 1 ? 'Adicionar 1 arquivo' : `Adicionar ${String(naFila.length)} arquivos`}
            </Button>
          </div>}
        </div>}
        <p className="apenas-leitores" role="status" aria-live="polite">{anuncio}</p>
      </section>
      <div className="importar-lado">
        <EntradaDeLink ir={ir} aoImportar={(url, link) => { acrescentar([novoItem({ tipo: 'youtube', nome: link, url, estado: { fase: 'aguardando' } })]); void processar(); }} />
        <EntradaColada referencia={colado} aoAdicionar={(texto, titulo, autor, tipoDoTexto) => {
          acrescentar([novoItem({ tipo: 'colado', nome: titulo || tituloDoTexto(texto), texto, titulo, autor, tipoDoTexto, estado: { fase: 'aguardando' } })]);
          void processar();
        }} />
      </div>
    </div>
    <OutrasFontes ir={ir} />
    <ImportacaoAvancada ir={ir} servicos={servicos} />
  </div>;
}

function AreaDeSoltar({ aoEscolher }: { aoEscolher: (arquivos: File[]) => void }): ReactNode {
  const entrada = useRef<HTMLInputElement>(null);
  const [arrastando, arrastar] = useState(false);
  return <div className="dropzone importar-soltar" data-arrastando={arrastando}
    onDragOver={(e) => { e.preventDefault(); arrastar(true); }} onDragLeave={() => arrastar(false)}
    onDrop={(e) => { e.preventDefault(); arrastar(false); const novos = Array.from(e.dataTransfer.files); if (novos.length) aoEscolher(novos); }}>
    <span className="importar-soltar-icone" aria-hidden="true"><Icon name="upload" size={26} /></span>
    <p className="importar-soltar-titulo">Solte arquivos aqui</p>
    <p className="importar-soltar-texto">PDF, EPUB, Markdown, TXT, vídeo ou áudio. Vários de uma vez.</p>
    <input ref={entrada} type="file" multiple hidden aria-label="Arquivo" accept={ACEITOS}
      onChange={(e) => { const novos = Array.from(e.target.files ?? []); if (novos.length) aoEscolher(novos); e.target.value = ''; }} />
    <Button onClick={() => entrada.current?.click()}>Escolher arquivos</Button>
    <small className="importar-limites">Até {tamanhoLegivel(LIMITE_DOCUMENTO_BYTES)} por documento e {tamanhoLegivel(LIMITE_MIDIA_BYTES)} por vídeo ou áudio</small>
  </div>;
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
      if (e.texto === 'falhou') return `Não foi possível preparar o texto${e.detalhe ? `: ${e.detalhe}` : '.'}`;
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
        <p>O Margem ainda não transcreve vídeo e áudio sozinho. Junte a transcrição em JSON no formato do Margem (gerada pelo Whisper, com as ferramentas de <code>tools/midia</code>): o texto vira um documento e a mídia toca alinhada a ele.</p>
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
      {documentoId && <a className="button small" href={`/documentos/${documentoId}`} target={ocupado ? '_blank' : undefined} rel="noreferrer" onClick={abrir(documentoId)}>
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
    <h2 id="importar-link">Link</h2>
    <form className="importar-linha" onSubmit={aoEnviar}>
      <label className="apenas-leitores" htmlFor="importar-endereco">Endereço</label>
      <Input id="importar-endereco" value={valor} inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://youtu.be/…"
        aria-describedby="importar-link-dica" aria-invalid={aviso === 'invalido'} onChange={(e) => { definirValor(e.target.value); definirAviso(null); }} />
      <Button type="submit" disabled={valor.trim() === ''}>Trazer</Button>
    </form>
    <p id="importar-link-dica" className="importar-dica">Vídeos do YouTube entram com a transcrição. Artigos e outras páginas, pela extensão do navegador.</p>
    {aviso === 'invalido' && <p className="aviso" role="alert">Isso não parece um endereço. Cole o link inteiro, como https://exemplo.com/artigo.</p>}
    {aviso === 'pagina' && <div className="aviso importar-extensao" role="alert">
      <p>O Margem não busca páginas da internet sozinho. Abra o artigo no navegador e use a extensão do Margem: ela guarda o texto limpo, com autor e data.</p>
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
