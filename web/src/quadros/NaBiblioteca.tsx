/**
 * Quadros como um tipo da Biblioteca: a capa é a própria pintura (a miniatura do serviço), na linha da
 * lista, no painel de informações e nos cartões do Início. Abrir um quadro vai para `/quadros/<slug>`.
 *
 * O Margem não distribui acervo (J118): a pessoa adiciona as imagens das obras que quer estudar
 * ("Adicionar obra") e o worker prepara a análise. Enquanto prepara, a obra aparece na lista com o
 * progresso; com falha, com o motivo, "Tentar de novo" e a identificação para corrigir.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ErroDaApi } from '../biblioteca/api';
import { BarraDeProgresso, Icon } from '../ui/Icon';
import { Button, Drawer, IconButton, Input } from '../ui/Primitives';
import { TipoDoDocumento } from '../ui/TipoDoDocumento';
import type { Rota } from '../biblioteca/rotas';
import { listarQuadros, OPERACOES_DOS_QUADROS, quadrosVistos, type OperacoesDosQuadros } from './api';
import type { ListaDeQuadros, PalpiteDaObra, QuadroDaPessoaV1, ResumoDoQuadro } from './tipos';
import { PalpiteDoCodex, SemIdentificacao } from './SemIdentificacao';
import { usarRecursos } from '../recursos';
import './biblioteca.css';

/** De quanto em quanto tempo a lista se atualiza enquanto alguma obra está na fila ou sendo preparada. */
export const INTERVALO_DO_PREPARO_MS = 3000;

export interface ListaDosQuadros {
  quadros: ResumoDoQuadro[] | null;
  /** Obras da pessoa ainda não prontas (na fila, preparando ou com falha). */
  preparando: QuadroDaPessoaV1[];
  recarregar: () => void;
}

/**
 * A lista de quadros e as obras em preparo; sem o serviço de arte (rotas desligadas), uma lista vazia,
 * sem erro na Biblioteca. Com o recurso `arte` desligado (J102), nem pergunta à API. Enquanto alguma
 * obra está na fila ou sendo preparada, a lista se atualiza sozinha.
 */
export function usarListaDeQuadros(carregar: () => Promise<ListaDeQuadros> = listarQuadros): ListaDosQuadros {
  const { carregado, ativos } = usarRecursos();
  const arte = ativos.has('arte');
  const [lista, definir] = useState<{ quadros: ResumoDoQuadro[]; preparando: QuadroDaPessoaV1[] } | null>(null);
  const [revisao, recarregarAgora] = useState(0);
  const recarregar = useCallback(() => recarregarAgora((n) => n + 1), []);
  useEffect(() => {
    if (!arte) return;
    let vivo = true;
    carregar().then(
      (r) => { if (vivo) definir({ quadros: Array.isArray(r.obras) ? r.obras : [], preparando: Array.isArray(r.preparando) ? r.preparando : [] }); },
      () => { if (vivo) definir((atual) => atual ?? { quadros: [], preparando: [] }); },
    );
    return () => { vivo = false; };
  }, [carregar, arte, revisao]);
  const andando = lista?.preparando.some((q) => q.estado === 'na_fila' || q.estado === 'preparando') ?? false;
  useEffect(() => {
    if (!andando) return;
    const relogio = setTimeout(recarregar, INTERVALO_DO_PREPARO_MS);
    return () => clearTimeout(relogio);
  }, [andando, lista, recarregar]);
  if (!arte) return { quadros: carregado ? SEM_QUADROS : null, preparando: SEM_PREPARO, recarregar };
  return { quadros: lista?.quadros ?? null, preparando: lista?.preparando ?? SEM_PREPARO, recarregar };
}
export function usarQuadros(carregar: () => Promise<ListaDeQuadros> = listarQuadros): ResumoDoQuadro[] | null {
  return usarListaDeQuadros(carregar).quadros;
}
const SEM_QUADROS: ResumoDoQuadro[] = [];
const SEM_PREPARO: QuadroDaPessoaV1[] = [];

/** Sem nenhuma obra da pessoa: o que são os Quadros, em uma frase, e o convite para a primeira. */
export function QuadrosVazios({ aoAdicionar }: { aoAdicionar: () => void }): ReactNode {
  return <div className="biblioteca-vazia conduzir quadros-vazios" data-quadros-vazios>
    <Icon name="quadro" size={56} />
    <div className="conduzir-texto">
      <h2>Nenhum quadro ainda.</h2>
      <p>Adicione a imagem de uma obra que você quer estudar. O Margem reconhece a obra, procura fontes públicas e prepara uma leitura guiada: as regiões da pintura, o que se vê e o que se sabe dela.</p>
    </div>
    <Button variante="primario" onClick={aoAdicionar}><Icon name="adicionar" size={16} />Adicionar obra</Button>
  </div>;
}

// ---------------------------------------------------------------- adicionar e corrigir

/** O mesmo teto e os mesmos formatos do serviço (`servico/src/arte/imagem-enviada.ts`). */
export const LIMITE_DA_IMAGEM_BYTES = 40 * 1024 * 1024;
const ACEITAS = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
const MENSAGEM_HEIC = 'Fotos HEIC/HEIF ainda não são aceitas. Exporte a foto como JPEG (no iPhone: Ajustes → Câmera → Formatos → Mais compatível) e envie de novo.';

/** Recusa local, antes de enviar: o serviço confere de novo pelo conteúdo. */
export function recusaDaImagem(arquivo: File): string | null {
  const nome = arquivo.name.toLowerCase();
  if (/\.(heic|heif|avif)$/u.test(nome) || /image\/(heic|heif|avif)/u.test(arquivo.type)) return MENSAGEM_HEIC;
  if (!/\.(jpe?g|png|webp)$/u.test(nome) && !/^image\/(jpeg|png|webp)$/u.test(arquivo.type)) return 'Escolha uma imagem JPEG, PNG ou WebP.';
  if (arquivo.size > LIMITE_DA_IMAGEM_BYTES) return `A imagem passa de 40 MB (${(arquivo.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB).`;
  return null;
}

const mensagemDoErro = (erro: unknown, padrao: string): string => (erro instanceof ErroDaApi ? erro.detalhe ?? padrao : padrao);

/**
 * A imagem da obra e, se a pessoa souber, título, artista e ano. Nada é enviado sem o botão: a imagem
 * solta ou colada em outro lugar chega como `arquivoInicial` e espera a confirmação (V-D2).
 */
export function FormularioDaObra({ aoAdicionar, aoCancelar, operacoes = OPERACOES_DOS_QUADROS, arquivoInicial = null, rotulo = 'Adicionar' }: {
  aoAdicionar: (quadro: QuadroDaPessoaV1) => void; aoCancelar?: () => void; operacoes?: Pick<OperacoesDosQuadros, 'adicionar'>;
  arquivoInicial?: File | null; rotulo?: string;
}): ReactNode {
  const [arquivo, escolher] = useState<File | null>(() => arquivoInicial && !recusaDaImagem(arquivoInicial) ? arquivoInicial : null);
  const [previa, definirPrevia] = useState<string | null>(null);
  const [titulo, definirTitulo] = useState('');
  const [artista, definirArtista] = useState('');
  const [ano, definirAno] = useState('');
  const [erro, definirErro] = useState<string | null>(() => arquivoInicial ? recusaDaImagem(arquivoInicial) : null);
  const [enviando, enviar] = useState(false);
  const [arrastando, arrastar] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!arquivo || typeof URL.createObjectURL !== 'function') { definirPrevia(null); return; }
    const url = URL.createObjectURL(arquivo);
    definirPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);
  const tomar = (novo: File | undefined) => {
    if (!novo) return;
    const recusa = recusaDaImagem(novo);
    definirErro(recusa);
    escolher(recusa ? null : novo);
  };
  async function concluir(evento: FormEvent) {
    evento.preventDefault();
    if (!arquivo || enviando) return;
    const formulario = new FormData();
    formulario.append('arquivo', arquivo);
    for (const [nome, valor] of [['titulo', titulo], ['artista', artista], ['ano', ano]] as const) if (valor.trim()) formulario.append(nome, valor.trim());
    enviar(true); definirErro(null);
    try { aoAdicionar(await operacoes.adicionar(formulario)); }
    catch (falha) { definirErro(mensagemDoErro(falha, 'Não foi possível enviar a imagem.')); }
    finally { enviar(false); }
  }
  return <form className="formulario adicionar-obra" onSubmit={(e) => void concluir(e)}>
    <div className="dropzone dropzone-da-obra" data-arrastando={arrastando} onDragOver={(e) => { e.preventDefault(); arrastar(true); }} onDragLeave={() => arrastar(false)}
      onDrop={(e) => { e.preventDefault(); arrastar(false); tomar(e.dataTransfer.files[0]); }}>
      {previa ? <img className="previa-da-obra" src={previa} alt="Prévia da imagem escolhida" /> : <Icon name="imagem" size={32} />}
      <p>{arquivo ? arquivo.name : 'Solte a imagem da obra aqui ou escolha abaixo'}</p>
      <input ref={entrada} type="file" hidden accept={ACEITAS} aria-label="Imagem da obra" onChange={(e) => { tomar(e.target.files?.[0]); e.target.value = ''; }} />
      <Button disabled={enviando} onClick={() => entrada.current?.click()}>{arquivo ? 'Trocar imagem' : 'Escolher imagem'}</Button>
      <small>JPEG · PNG · WebP · até 40 MB</small>
    </div>
    <label>Título<Input value={titulo} autoComplete="off" maxLength={300} placeholder="Opcional" onChange={(e) => definirTitulo(e.target.value)} /></label>
    <label>Artista<Input value={artista} autoComplete="off" maxLength={300} placeholder="Opcional" onChange={(e) => definirArtista(e.target.value)} /></label>
    <label>Ano<Input value={ano} autoComplete="off" maxLength={40} placeholder="Opcional" inputMode="numeric" onChange={(e) => definirAno(e.target.value)} /></label>
    <p className="nota-da-obra">Sem título e artista, o Codex tenta reconhecer a obra pela imagem; você pode corrigir depois. A análise usa a sua conta do ChatGPT e leva alguns minutos.</p>
    {erro && <p role="alert" className="aviso">{erro}</p>}
    <div className="button-row"><Button variante="primario" type="submit" disabled={!arquivo || enviando}>{enviando ? 'Enviando…' : rotulo}</Button>{aoCancelar && <Button variante="ghost" onClick={aoCancelar}>Cancelar</Button>}</div>
  </form>;
}

/** O que a análise só pela imagem (V-W5) põe no lugar do título e do artista: não serve de valor inicial. */
const MARCADORES_SEM_IDENTIFICACAO = new Set(['Obra não identificada', 'Artista não identificado']);
const valorInicial = (valor: string | null): string => (valor === null || MARCADORES_SEM_IDENTIFICACAO.has(valor) ? '' : valor);

/**
 * Título, artista e ano para a pessoa corrigir (ou informar, numa obra não identificada); salvar prepara a
 * obra de novo. Com `palpite`, o que o Codex arriscou aparece como palpite e "Usar o palpite" preenche.
 */
export function IdentificarObra({ quadro, palpite = null, aoFechar, aoSalvar, operacoes = OPERACOES_DOS_QUADROS }: {
  quadro: { slug: string; titulo: string | null; artista: string | null; ano: string | null };
  palpite?: PalpiteDaObra | null;
  aoFechar: () => void; aoSalvar: (atualizado: QuadroDaPessoaV1) => void; operacoes?: Pick<OperacoesDosQuadros, 'corrigir'>;
}): ReactNode {
  const [titulo, definirTitulo] = useState(valorInicial(quadro.titulo));
  const [artista, definirArtista] = useState(valorInicial(quadro.artista));
  const [ano, definirAno] = useState(quadro.ano ?? '');
  const [erro, definirErro] = useState<string | null>(null);
  const [salvando, salvar] = useState(false);
  const usarPalpite = palpite?.titulo && palpite.artista
    ? () => { definirTitulo(palpite.titulo ?? ''); definirArtista(palpite.artista ?? ''); definirAno(palpite.ano ?? ''); } : null;
  async function concluir(evento: FormEvent) {
    evento.preventDefault();
    if (!titulo.trim() || !artista.trim()) { definirErro('Informe o título e o artista.'); return; }
    salvar(true); definirErro(null);
    try { aoSalvar(await operacoes.corrigir(quadro.slug, { titulo: titulo.trim(), artista: artista.trim(), ano: ano.trim() || null })); }
    catch (falha) { definirErro(mensagemDoErro(falha, 'Não foi possível salvar.')); }
    finally { salvar(false); }
  }
  return <Drawer rotulo="Identificar a obra" aoFechar={aoFechar}>
    <form className="formulario" onSubmit={(e) => void concluir(e)}>
      <p className="nota-da-obra">Com o título e o artista certos, o Margem procura a obra de novo no Wikidata e na Wikipédia e prepara uma análise nova. A anterior continua guardada.</p>
      {palpite && <PalpiteDoCodex palpite={palpite} />}
      {usarPalpite && <div className="button-row"><Button onClick={usarPalpite}>Usar o palpite</Button></div>}
      <label>Título<Input value={titulo} autoComplete="off" maxLength={300} aria-required="true" onChange={(e) => definirTitulo(e.target.value)} /></label>
      <label>Artista<Input value={artista} autoComplete="off" maxLength={300} aria-required="true" onChange={(e) => definirArtista(e.target.value)} /></label>
      <label>Ano<Input value={ano} autoComplete="off" maxLength={40} placeholder="Opcional" onChange={(e) => definirAno(e.target.value)} /></label>
      {erro && <p role="alert" className="aviso">{erro}</p>}
      <div className="button-row"><Button variante="primario" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar e preparar de novo'}</Button><Button variante="ghost" onClick={aoFechar}>Cancelar</Button></div>
    </form>
  </Drawer>;
}

// ---------------------------------------------------------------- obra em preparo

const ETAPAS: Record<NonNullable<QuadroDaPessoaV1['etapa']>, string> = {
  imagem: 'Preparando a imagem', identificacao: 'Reconhecendo a obra', dossie: 'Procurando fontes', analise: 'Escrevendo a análise', narracao: 'Gravando a narração',
};

/** Uma frase curta para o estado da obra em preparo. */
export function fraseDoPreparo(q: QuadroDaPessoaV1): string {
  if (q.estado === 'na_fila') return 'Na fila';
  if (q.estado === 'falhou') return 'Não ficou pronta';
  if (q.estado === 'pronto') return 'Pronta';
  // Não reconhecida (V-W5): não há fontes a procurar; a análise segue só pela imagem.
  if (q.palpite && q.etapa === 'analise') return 'Analisando só pela imagem';
  return q.etapa ? ETAPAS[q.etapa] : 'Preparando';
}
export const tituloDoPreparo = (q: QuadroDaPessoaV1): string => q.identificacao?.titulo ?? q.imagem.nome?.replace(/\.[^.]+$/u, '') ?? 'Obra sem título';
const miniaturaDoPreparo = (q: QuadroDaPessoaV1): string => `/api/arte/${encodeURIComponent(q.slug)}/miniatura`;

/** Ações sobre uma obra da pessoa ainda não pronta: tentar de novo, corrigir a identificação e remover. */
export function usarAcoesDoPreparo(recarregar: () => void, operacoes: OperacoesDosQuadros = OPERACOES_DOS_QUADROS) {
  const [ocupado, ocupar] = useState<string | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const executar = async (slug: string, acao: () => Promise<unknown>, padrao: string) => {
    ocupar(slug); definirErro(null);
    try { await acao(); recarregar(); }
    catch (falha) { definirErro(mensagemDoErro(falha, padrao)); }
    finally { ocupar(null); }
  };
  return {
    ocupado, erro,
    tentarDeNovo: (slug: string) => executar(slug, () => operacoes.tentarDeNovo(slug), 'Não foi possível tentar de novo.'),
    remover: (slug: string, titulo: string) => {
      if (!window.confirm(`Remover “${titulo}”? A imagem e a análise saem da sua biblioteca.`)) return Promise.resolve();
      return executar(slug, () => operacoes.remover(slug), 'Não foi possível remover a obra.');
    },
  };
}

export function LinhaDoQuadroEmPreparo({ quadro, atual, aoFocar, aoTentar, aoCorrigir, aoRemover, ocupado }: {
  quadro: QuadroDaPessoaV1; atual: boolean; aoFocar: () => void; aoTentar: () => void; aoCorrigir: () => void; aoRemover: () => void; ocupado: boolean;
}): ReactNode {
  const titulo = tituloDoPreparo(quadro);
  const enviado = new Date(quadro.enviado_em);
  const falhou = quadro.estado === 'falhou';
  return <div data-linha data-quadro-em-preparo={quadro.slug} data-estado={quadro.estado} tabIndex={atual ? 0 : -1} className={`linha-documento linha-quadro linha-em-preparo ${atual ? 'em-foco' : ''}`} onMouseEnter={aoFocar} onFocus={aoFocar} onClick={aoFocar}>
    <div className="capa capa-mini capa-do-quadro" aria-hidden="true"><img src={miniaturaDoPreparo(quadro)} alt="" loading="lazy" decoding="async" /><span className="capa-icone capa-icone-quadro"><Icon name="quadro" size={12} /></span></div>
    <div className="linha-conteudo"><span className="titulo">{titulo}</span>
      <div className="linha-meta">{quadro.identificacao && <span>{quadro.identificacao.artista}</span>}<span>Quadro</span><span className={`badge ${falhou ? 'erro' : 'ativo'}`}>{fraseDoPreparo(quadro)}</span>{quadro.progresso && <span>{`${String(quadro.progresso.feitas)} de ${String(quadro.progresso.total)}`}</span>}</div>
      {quadro.estado === 'preparando' && quadro.progresso && <BarraDeProgresso valor={100 * quadro.progresso.feitas / quadro.progresso.total} rotulo={`Preparo de ${titulo}`} />}
      {quadro.aviso && <p className="preparo-nota">{quadro.aviso}</p>}
      {!quadro.identificacao && quadro.palpite && !falhou && <p className="preparo-nota">Não reconhecida: a análise segue só pela imagem. Você pode informar título e artista depois.</p>}
      {falhou && <div className="preparo-falha" onClick={(e) => e.stopPropagation()}>
        <p>{quadro.erro?.mensagem}</p>
        <div className="button-row"><Button disabled={ocupado} onClick={aoTentar}><Icon name="restaurar" size={16} />Tentar de novo</Button><Button variante="ghost" disabled={ocupado} onClick={aoCorrigir}>{quadro.identificacao ? 'Corrigir a identificação' : 'Informar título e artista'}</Button><Button variante="ghost" disabled={ocupado} onClick={aoRemover}>Remover</Button></div>
      </div>}
    </div>
    <time dateTime={enviado.toISOString()}>{enviado.toDateString() === new Date().toDateString() ? enviado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : enviado.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</time>
    {!falhou && <div className="acoes-da-linha" onClick={(e) => e.stopPropagation()}><IconButton aria-label="Remover a obra" title="Remover" disabled={ocupado} onClick={aoRemover}><Icon name="xis" size={18} /></IconButton></div>}
  </div>;
}

/** De onde veio a identificação, numa frase curta. */
function origemDaIdentificacao(id: NonNullable<QuadroDaPessoaV1['identificacao']>): string {
  if (id.origem === 'acervo') return 'Reconhecida pela imagem: é uma obra de exemplo do Margem';
  if (id.origem === 'codex') return `Proposta pelo Codex${id.confianca ? ` (confiança ${id.confianca === 'media' ? 'média' : id.confianca})` : ''}`;
  return 'Informada por você';
}

/** O painel da Biblioteca para uma obra em preparo: a imagem, o estado e o que dá para fazer. */
export function PainelDoQuadroEmPreparo({ quadro, fechar, aoTentar, aoCorrigir, aoRemover, ocupado }: {
  quadro: QuadroDaPessoaV1; fechar: () => void; aoTentar: () => void; aoCorrigir: () => void; aoRemover: () => void; ocupado: boolean;
}): ReactNode {
  const titulo = tituloDoPreparo(quadro);
  const id = quadro.identificacao;
  return <aside className="painel-biblioteca" aria-label="Informações do quadro">
    <header className="painel-abas"><Button variante="ghost" aria-pressed>Info</Button><IconButton aria-label="Fechar informações" title="Fechar informações (])" onClick={fechar}><Icon name="painel" /></IconButton></header>
    <div className="painel-corpo">
      <div className="capa-do-painel"><img src={miniaturaDoPreparo(quadro)} alt={titulo} /></div>
      <h2>{titulo}</h2><p className="autor">{id?.artista ?? 'Artista ainda não identificado'}</p>
      {!id && quadro.palpite && <SemIdentificacao palpite={quadro.palpite} emPreparo={quadro.estado !== 'falhou'} />}
      <h3 className="eyebrow">Preparo</h3>
      <dl>
        <dt>Estado</dt><dd>{fraseDoPreparo(quadro)}{quadro.progresso ? <small>{`${String(quadro.progresso.feitas)} de ${String(quadro.progresso.total)} etapas`}</small> : null}{quadro.aviso && <small>{quadro.aviso}</small>}{quadro.erro && <small>{quadro.erro.mensagem}</small>}</dd>
        <dt>Identificação</dt><dd>{id ? `${id.titulo}, ${id.artista}${id.ano ? `, ${id.ano}` : ''}` : quadro.palpite ? 'Não reconhecida' : 'Ainda não'}{id && <small>{origemDaIdentificacao(id)}</small>}</dd>
        <dt>Imagem</dt><dd>{`${quadro.imagem.formato.toUpperCase()} · ${(quadro.imagem.bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`}{quadro.imagem.nome && <small>{quadro.imagem.nome}</small>}</dd>
        <dt>Enviada em</dt><dd>{new Date(quadro.enviado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</dd>
      </dl>
    </div>
    <footer className="painel-rodape"><div className="button-row">
      {quadro.estado === 'falhou' && <Button variante="primario" disabled={ocupado} onClick={aoTentar}>Tentar de novo</Button>}
      <Button disabled={ocupado} onClick={aoCorrigir}>{id ? 'Corrigir' : 'Identificar'}</Button>
      <Button variante="ghost" disabled={ocupado} onClick={aoRemover}>Remover</Button>
    </div></footer>
  </aside>;
}

export const rotuloDoQuadro = (q: Pick<ResumoDoQuadro, 'data'>): string => `Quadro · ${q.data}`;
export const vistoEm = (slug: string): string | null => quadrosVistos()[slug] ?? null;

/** A capa de um quadro: a pintura inteira, sem corte, sobre o fundo da capa. */
export function CapaDoQuadro({ quadro, tamanho }: { quadro: ResumoDoQuadro; tamanho: 'mini' | 'cartao' }): ReactNode {
  return <div className={`capa capa-${tamanho} capa-do-quadro`} aria-hidden="true">
    <img src={quadro.miniatura} alt="" loading="lazy" decoding="async" width={quadro.largura} height={quadro.altura} />
    {tamanho === 'mini' && <span className="capa-icone capa-icone-quadro"><Icon name="quadro" size={12} /></span>}
  </div>;
}

export function LinhaDoQuadro({ quadro, atual, ordem, ir, aoFocar }: { quadro: ResumoDoQuadro; atual: boolean; ordem: string; ir: (rota: Rota) => void; aoFocar: () => void }): ReactNode {
  const visto = vistoEm(quadro.slug);
  const data = new Date(ordem === 'leitura' && visto ? visto : quadro.adicionado_em);
  const analises = quadro.analises.length;
  return <div data-linha data-quadro={quadro.slug} tabIndex={atual ? 0 : -1} className={`linha-documento linha-quadro ${atual ? 'em-foco' : ''}`} onMouseEnter={aoFocar} onFocus={aoFocar} onClick={() => ir({ nome: 'quadro', slug: quadro.slug })}>
    <CapaDoQuadro quadro={quadro} tamanho="mini" />
    <div className="linha-conteudo"><a className="titulo" href={`/quadros/${quadro.slug}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); ir({ nome: 'quadro', slug: quadro.slug }); }}>{quadro.titulo}</a>
      <div className="linha-meta"><span>{quadro.nao_identificada ? 'Analisada só pela imagem' : quadro.artista}</span><span>{quadro.nao_identificada ? 'Quadro' : rotuloDoQuadro(quadro)}</span><span>{analises === 1 ? '1 análise' : `${String(analises)} análises`}</span>{quadro.analises.some((a) => a.audio) && <span>com voz</span>}{!visto && <span>não aberto</span>}</div>
    </div>
    <time dateTime={data.toISOString()}>{data.toDateString() === new Date().toDateString() ? data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</time>
    <div className="acoes-da-linha" onClick={(e) => e.stopPropagation()}><IconButton aria-label="Abrir o quadro" title="Abrir (Enter)" onClick={() => ir({ nome: 'quadro', slug: quadro.slug })}><Icon name="quadro" size={18} /></IconButton></div>
  </div>;
}

/** O painel de informações da Biblioteca para um quadro (a mesma casca do `PainelDoItem`). */
export function PainelDoQuadroNaBiblioteca({ quadro, ir, fechar, aoCorrigir, aoRemover, ocupado = false }: {
  quadro: ResumoDoQuadro; ir: (rota: Rota) => void; fechar: () => void;
  /** Só nas obras que a pessoa adicionou (`removivel`). */
  aoCorrigir?: () => void; aoRemover?: () => void; ocupado?: boolean;
}): ReactNode {
  const visto = vistoEm(quadro.slug);
  return <aside className="painel-biblioteca" aria-label="Informações do quadro">
    <header className="painel-abas"><Button variante="ghost" aria-pressed>Info</Button><IconButton aria-label="Fechar informações" title="Fechar informações (])" onClick={fechar}><Icon name="painel" /></IconButton></header>
    <div className="painel-corpo">
      <div className="capa-do-painel"><img src={quadro.miniatura} alt={`${quadro.titulo}, ${quadro.artista}`} width={quadro.largura} height={quadro.altura} /></div>
      <h2>{quadro.titulo}</h2>
      {quadro.nao_identificada ? <SemIdentificacao palpite={quadro.palpite ?? null} /> : <p className="autor">{quadro.artista}</p>}
      <h3 className="eyebrow">Metadados</h3>
      <dl>
        <dt>Tipo</dt><dd><TipoDoDocumento icone="quadro" rotulo="Quadro" /></dd>
        {!quadro.nao_identificada && <><dt>Data</dt><dd>{quadro.data}</dd>
          <dt>Técnica</dt><dd>{quadro.tecnica}</dd>
          <dt>Título original</dt><dd>{quadro.titulo_original}</dd></>}
        <dt>Análises</dt><dd>{quadro.analises.map((a) => `${a.titulo}${a.publicada ? ' (publicada)' : ''}${a.audio ? ' · com voz' : ''}`).join(', ')}</dd>
        <dt>Adicionado em</dt><dd>{new Date(quadro.adicionado_em).toLocaleDateString('pt-BR')}</dd>
        <dt>Última visita</dt><dd>{visto ? new Date(visto).toLocaleDateString('pt-BR') : 'Não aberto'}</dd>
      </dl>
    </div>
    <footer className="painel-rodape"><div className="button-row"><Button variante="primario" onClick={() => ir({ nome: 'quadro', slug: quadro.slug })}>Abrir <Icon name="arrow" size={16} /></Button>
      {quadro.removivel && aoCorrigir && <Button disabled={ocupado} onClick={aoCorrigir}>{quadro.nao_identificada ? 'Informar título e artista' : 'Corrigir'}</Button>}
      {quadro.removivel && aoRemover && <Button variante="ghost" disabled={ocupado} onClick={aoRemover}>Remover</Button>}
    </div></footer>
  </aside>;
}

/** O cartão do Início: a pintura no lugar da capa. */
export function CartaoDoQuadro({ quadro, ir }: { quadro: ResumoDoQuadro; ir: (rota: Rota) => void }): ReactNode {
  const destino: Rota = { nome: 'quadro', slug: quadro.slug };
  const analises = quadro.analises.length;
  return <article className="cartao-documento cartao-quadro" onClick={() => ir(destino)}>
    <CapaDoQuadro quadro={quadro} tamanho="cartao" />
    <div className="cartao-dados"><span className="eyebrow">{rotuloDoQuadro(quadro)}</span>
      <h3><a href={`/quadros/${quadro.slug}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); ir(destino); }}>{quadro.titulo}</a></h3>
      <p className="autor">{quadro.artista}</p>
      <p className="dados">{analises === 1 ? '1 análise' : `${String(analises)} análises`}{quadro.analises.some((a) => a.audio) ? ' · com voz' : ''}</p>
    </div>
  </article>;
}
