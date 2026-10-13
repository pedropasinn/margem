/**
 * Quadros como um tipo da Biblioteca: a capa é a própria pintura (a miniatura do serviço), na linha da
 * lista, no painel de informações e nos cartões do Início. Abrir um quadro vai para `/quadros/<slug>`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button, IconButton } from '../ui/Primitives';
import { TipoDoDocumento } from '../ui/TipoDoDocumento';
import type { Rota } from '../biblioteca/rotas';
import { listarQuadros, quadrosVistos } from './api';
import type { EstadoDoAcervo, ListaDeQuadros, ResumoDoQuadro } from './tipos';
import { usarRecursos } from '../recursos';
import './biblioteca.css';

/**
 * A lista de quadros e o estado do acervo; sem o serviço de arte (rotas desligadas), uma lista vazia,
 * sem erro na Biblioteca. Com o recurso `arte` desligado (J102), nem pergunta à API: lista vazia assim
 * que a configuração chega. `acervo` é `null` enquanto não se sabe (ou quando a API não diz).
 */
export function usarListaDeQuadros(carregar: () => Promise<ListaDeQuadros> = listarQuadros): { quadros: ResumoDoQuadro[] | null; acervo: EstadoDoAcervo | null } {
  const { carregado, ativos } = usarRecursos();
  const arte = ativos.has('arte');
  const [lista, definir] = useState<{ quadros: ResumoDoQuadro[]; acervo: EstadoDoAcervo | null } | null>(null);
  useEffect(() => {
    if (!arte) return;
    let vivo = true;
    carregar().then((r) => { if (vivo) definir({ quadros: Array.isArray(r.obras) ? r.obras : [], acervo: r.acervo ?? null }); }, () => { if (vivo) definir({ quadros: [], acervo: null }); });
    return () => { vivo = false; };
  }, [carregar, arte]);
  if (!arte) return { quadros: carregado ? SEM_QUADROS : null, acervo: null };
  return { quadros: lista?.quadros ?? null, acervo: lista?.acervo ?? null };
}
export function usarQuadros(carregar: () => Promise<ListaDeQuadros> = listarQuadros): ResumoDoQuadro[] | null {
  return usarListaDeQuadros(carregar).quadros;
}
const SEM_QUADROS: ResumoDoQuadro[] = [];

const megabytes = (bytes: number): string => `${Math.round(bytes / 1_000_000).toLocaleString('pt-BR')} MB`;

/**
 * Sem acervo instalado (J110): o que são os Quadros, em uma frase, e como trazê-los. O botão baixa o
 * pacote publicado; o comando baixa e instala de uma vez. Enquanto o pacote não tem URL de release, o
 * botão fica indisponível e o comando aceita o arquivo recebido por outro caminho.
 */
export function AcervoAusente({ acervo }: { acervo: EstadoDoAcervo }): ReactNode {
  const { pacote } = acervo;
  const rotulo = `Baixar o acervo de quadros (${String(pacote.obras)} obras, ${megabytes(pacote.bytes)})`;
  // `npm run` precisa do `--` antes do argumento; o comando da instalação (`margem arte instalar`), não.
  const comando = pacote.url ? acervo.comando : `${acervo.comando}${acervo.comando.startsWith('npm ') ? ' --' : ''} <arquivo do acervo>`;
  const [copiado, definirCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const relogio = setTimeout(() => definirCopiado(false), 2000);
    return () => clearTimeout(relogio);
  }, [copiado]);
  return <div className="biblioteca-vazia conduzir acervo-ausente" data-acervo-ausente>
    <Icon name="quadro" size={56} />
    <div className="conduzir-texto">
      <h2>Nenhum quadro ainda.</h2>
      <p>Quadros são pinturas em domínio público com uma leitura guiada: as regiões da obra, o que se vê, o que se sabe dela e uma visita curta.</p>
    </div>
    {pacote.url
      ? <a className="button primary" href={pacote.url} download>{rotulo}</a>
      : <span className="acervo-em-preparacao"><Button variante="primario" disabled>{rotulo}</Button><span>Download em preparação.</span></span>}
    <div className="acervo-comando">
      <span>{pacote.url ? 'Ou baixe e instale de uma vez, no terminal da instalação:' : 'Com o arquivo em mãos, no terminal da instalação:'}</span>
      <span className="acervo-comando-linha">
        <code>{comando}</code>
        <IconButton aria-label={copiado ? 'Copiado' : `Copiar o comando: ${comando}`} title={copiado ? 'Copiado' : 'Copiar'}
          onClick={() => { void navigator.clipboard?.writeText(comando).then(() => definirCopiado(true), () => { /* o texto continua selecionável */ }); }}>
          <Icon name={copiado ? 'check' : 'copiar'} size={16} />
        </IconButton>
      </span>
    </div>
  </div>;
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
      <div className="linha-meta"><span>{quadro.artista}</span><span>{rotuloDoQuadro(quadro)}</span><span>{analises === 1 ? '1 análise' : `${String(analises)} análises`}</span>{quadro.analises.some((a) => a.audio) && <span>com voz</span>}{!visto && <span>não aberto</span>}</div>
    </div>
    <time dateTime={data.toISOString()}>{data.toDateString() === new Date().toDateString() ? data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</time>
    <div className="acoes-da-linha" onClick={(e) => e.stopPropagation()}><IconButton aria-label="Abrir o quadro" title="Abrir (Enter)" onClick={() => ir({ nome: 'quadro', slug: quadro.slug })}><Icon name="quadro" size={18} /></IconButton></div>
  </div>;
}

/** O painel de informações da Biblioteca para um quadro (a mesma casca do `PainelDoItem`). */
export function PainelDoQuadroNaBiblioteca({ quadro, ir, fechar }: { quadro: ResumoDoQuadro; ir: (rota: Rota) => void; fechar: () => void }): ReactNode {
  const visto = vistoEm(quadro.slug);
  return <aside className="painel-biblioteca" aria-label="Informações do quadro">
    <header className="painel-abas"><Button variante="ghost" aria-pressed>Info</Button><IconButton aria-label="Fechar informações" title="Fechar informações (])" onClick={fechar}><Icon name="painel" /></IconButton></header>
    <div className="painel-corpo">
      <div className="capa-do-painel"><img src={quadro.miniatura} alt={`${quadro.titulo}, ${quadro.artista}`} width={quadro.largura} height={quadro.altura} /></div>
      <h2>{quadro.titulo}</h2><p className="autor">{quadro.artista}</p>
      <h3 className="eyebrow">Metadados</h3>
      <dl>
        <dt>Tipo</dt><dd><TipoDoDocumento icone="quadro" rotulo="Quadro" /></dd>
        <dt>Data</dt><dd>{quadro.data}</dd>
        <dt>Técnica</dt><dd>{quadro.tecnica}</dd>
        <dt>Título original</dt><dd>{quadro.titulo_original}</dd>
        <dt>Análises</dt><dd>{quadro.analises.map((a) => `${a.titulo}${a.publicada ? ' (publicada)' : ''}${a.audio ? ' · com voz' : ''}`).join(', ')}</dd>
        <dt>Adicionado em</dt><dd>{new Date(quadro.adicionado_em).toLocaleDateString('pt-BR')}</dd>
        <dt>Última visita</dt><dd>{visto ? new Date(visto).toLocaleDateString('pt-BR') : 'Não aberto'}</dd>
      </dl>
    </div>
    <footer className="painel-rodape"><div className="button-row"><Button variante="primario" onClick={() => ir({ nome: 'quadro', slug: quadro.slug })}>Abrir <Icon name="arrow" size={16} /></Button></div></footer>
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
