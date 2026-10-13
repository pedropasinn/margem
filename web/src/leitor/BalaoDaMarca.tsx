/**
 * O balão sobre o grifo: ao tocar numa marca, uma barra flutuante logo acima da primeira linha dela,
 * com quatro ações — remover a marca, anotar sobre ela, etiquetar e mais opções (copiar, perguntar,
 * conectar, ver a nota). Posiciona-se pelo desenho da marca (`[data-desenho]`), que existe tanto no
 * texto quanto no PDF, e acompanha a rolagem. Nada do modelo vai para `innerHTML`.
 */
import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { EtiquetaV1, Id, TipoDificuldadeTextual } from '@margem/contratos';
import { apagarEtiqueta, criarEtiqueta, etiquetasDaVersao } from '../biblioteca/api';
import { IconButton } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import type { MarcaDoLeitor } from './f2';
import { usarFuncoes } from './ContextoDosModos';
import { usarDesfazer } from './desfazer';
import { ROTULO_DA_DIFICULDADE } from './compreensao/rotulos';
import { atalhoDeUmaTeclaDesligado, digitando } from './teclado/comandos';

export interface FontesDasEtiquetas {
  listar: typeof etiquetasDaVersao;
  criar: typeof criarEtiqueta;
  apagar: typeof apagarEtiqueta;
}
export const FONTES_DAS_ETIQUETAS: FontesDasEtiquetas = { listar: etiquetasDaVersao, criar: criarEtiqueta, apagar: apagarEtiqueta };

export interface AcoesDoBalao {
  remover: () => void;
  /** Anotar sobre a marca (nota do leitor ligada a ela). */
  anotar?: (() => void) | undefined;
  perguntar?: (() => void) | undefined;
  conectar?: (() => void) | undefined;
  /** Criar um flashcard a partir do trecho grifado. */
  flashcard?: (() => void) | undefined;
  /** Abrir a nota da IA (no celular, a folha; no computador, a nota na margem). */
  verNota?: (() => void) | undefined;
}

/** A função da marca, quando dá para trocá-la; `daIa` é a que a IA deu, se o leitor já a trocou. */
export interface FuncaoDoBalao {
  trocar: (funcao: string) => Promise<void>;
  daIa?: string | undefined;
}

type Painel = null | 'etiquetas' | 'mais';
const ALTURA = 40;
const FOLGA = 8;

/** A caixa da primeira linha da marca na tela: o desenho dela, ou o trecho quando não há desenho. */
function caixaDaMarca(id: Id): DOMRect | null {
  const seletor = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
  const primeiro = document.querySelector(`[data-desenho="${seletor}"] path`) ?? document.querySelector(`span[data-marcas~="${seletor}"]`);
  const caixa = primeiro?.getBoundingClientRect();
  return caixa && caixa.width > 0 ? caixa : null;
}

/** A última linha da marca: com o balão abaixo, ele vem depois do trecho inteiro. */
function caixaDoFimDaMarca(id: Id): DOMRect | null {
  const seletor = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
  const linhas = [...document.querySelectorAll(`[data-desenho="${seletor}"] path`)].map((linha) => linha.getBoundingClientRect()).filter((caixa) => caixa.width > 0);
  return linhas.length === 0 ? null : linhas.reduce((ultima, caixa) => (caixa.bottom > ultima.bottom ? caixa : ultima));
}

export function BalaoDaMarca({ marca, versaoId, acoes, aoFechar, fontes = FONTES_DAS_ETIQUETAS, funcao, painelInicial = null }: {
  marca: MarcaDoLeitor; versaoId: Id; acoes: AcoesDoBalao; aoFechar: () => void; fontes?: FontesDasEtiquetas;
  funcao?: FuncaoDoBalao | undefined;
  /** O grifo recém-criado abre já nas etiquetas, para escolher a função. */
  painelInicial?: 'etiquetas' | null;
}): ReactNode {
  const raiz = useRef<HTMLDivElement>(null);
  const [posicao, definirPosicao] = useState<{ left: number; top: number; abaixo: boolean } | null>(null);
  const [painel, abrirPainel] = useState<Painel>(painelInicial);
  const [copiado, copiar] = useState(false);

  const posicionar = useCallback(() => {
    const caixa = caixaDaMarca(marca.id);
    if (!caixa) { definirPosicao(null); return; }
    const largura = raiz.current?.offsetWidth ?? 176;
    // Com um painel aberto o balão cresce; ele cresce para longe do grifo (para cima, ou para baixo
    // quando está abaixo), e os botões ficam colados à linha. Nunca cobre o trecho.
    const altura = Math.max(ALTURA, raiz.current?.offsetHeight ?? ALTURA);
    const left = Math.max(FOLGA, Math.min(window.innerWidth - largura - FOLGA, caixa.left));
    // Acima da primeira linha; se não couber (topo da tela, sob a barra), logo abaixo da última.
    const abaixo = caixa.top - altura - FOLGA < 56;
    const fim = caixaDoFimDaMarca(marca.id) ?? caixa;
    definirPosicao({ left, top: abaixo ? fim.bottom + FOLGA : caixa.top - altura - FOLGA, abaixo });
  }, [marca.id]);
  useLayoutEffect(() => { posicionar(); }, [posicionar, painel]);
  useEffect(() => {
    let quadro = 0;
    const agendar = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(posicionar); };
    window.addEventListener('scroll', agendar, true);
    window.addEventListener('resize', agendar);
    return () => { cancelAnimationFrame(quadro); window.removeEventListener('scroll', agendar, true); window.removeEventListener('resize', agendar); };
  }, [posicionar]);
  // Tocar fora do balão e fora de uma marca fecha; tocar noutra marca troca o balão (quem chama decide).
  useEffect(() => {
    const fora = (evento: PointerEvent) => {
      const alvo = evento.target;
      if (!(alvo instanceof Node) || raiz.current?.contains(alvo)) return;
      if (alvo instanceof Element && alvo.closest('span[data-marcas], .pdf-pagina, [data-nota]')) return;
      aoFechar();
    };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [aoFechar]);
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      if (digitando(evento.target)) return;
      if (evento.key === 'Escape') { if (painel) abrirPainel(null); else aoFechar(); return; }
      if (evento.metaKey || evento.ctrlKey || evento.altKey || atalhoDeUmaTeclaDesligado(evento)) return;
      const tecla = evento.key.toLowerCase();
      if (tecla === 'n' && acoes.anotar) { evento.preventDefault(); acoes.anotar(); }
      else if (tecla === 't') { evento.preventDefault(); abrirPainel('etiquetas'); }
      else if (tecla === 'p' && acoes.perguntar) { evento.preventDefault(); acoes.perguntar(); }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [acoes, aoFechar, painel]);

  const copiarTexto = () => {
    void navigator.clipboard?.writeText(marca.ancora.citacao).then(() => { copiar(true); setTimeout(() => copiar(false), 1200); }, () => undefined);
  };

  return <div ref={raiz} className={`balao-da-marca${posicao?.abaixo ? ' abaixo' : ''}`} role="toolbar" aria-label="Ações da marca"
    style={posicao ? { left: posicao.left, top: posicao.top } : { visibility: 'hidden', left: 0, top: 0 }}>
    <div className="balao-botoes">
      <IconButton className="balao-botao remover" aria-label={marca.origem === 'manual' ? 'Apagar grifo' : 'Remover marca'} title={marca.origem === 'manual' ? 'Apagar grifo' : 'Remover marca'} onClick={acoes.remover}><Icon name="xis" size={16} /></IconButton>
      {acoes.anotar && <IconButton className="balao-botao" aria-label="Anotar" title="Anotar  N" onClick={acoes.anotar}><Icon name="comentario" size={16} /></IconButton>}
      <IconButton className="balao-botao" aria-label="Etiquetas" title="Etiquetas  T" aria-expanded={painel === 'etiquetas'} onClick={() => abrirPainel(painel === 'etiquetas' ? null : 'etiquetas')}><Icon name="etiqueta" size={16} /></IconButton>
      <IconButton className="balao-botao" aria-label="Mais opções" title="Mais opções" aria-expanded={painel === 'mais'} onClick={() => abrirPainel(painel === 'mais' ? null : 'mais')}><Icon name="mais" size={16} /></IconButton>
    </div>
    {painel === 'etiquetas' && <PainelDeEtiquetas marca={marca} versaoId={versaoId} fontes={fontes} funcao={funcao} />}
    {painel === 'mais' && <ul className="balao-menu" role="menu">
      <li role="none"><button type="button" role="menuitem" onClick={copiarTexto}><span>{copiado ? 'Copiado' : 'Copiar texto'}</span><kbd>Ctrl C</kbd></button></li>
      {acoes.perguntar && <li role="none"><button type="button" role="menuitem" onClick={acoes.perguntar}><span>Perguntar sobre isto</span><kbd>P</kbd></button></li>}
      {acoes.conectar && <li role="none"><button type="button" role="menuitem" onClick={acoes.conectar}><span>Conectar a outro trecho</span></button></li>}
      {acoes.flashcard && <li role="none"><button type="button" role="menuitem" onClick={acoes.flashcard}><span>Criar flashcard</span></button></li>}
      {acoes.verNota && <li role="none"><button type="button" role="menuitem" onClick={acoes.verNota}><span>Ver a nota da marca</span></button></li>}
    </ul>}
  </div>;
}

const DIFICULDADES = Object.keys(ROTULO_DA_DIFICULDADE) as TipoDificuldadeTextual[];
const ehDificuldade = (nome: string) => DIFICULDADES.includes(nome.toLowerCase() as TipoDificuldadeTextual);
/** Sem modos no contexto (página de desenvolvimento), as três funções do método. */
const FUNCOES_DO_METODO = [{ chave: 'tese', rotulo: 'Tese' }, { chave: 'conceito', rotulo: 'Conceito' }, { chave: 'justificativa', rotulo: 'Justificativa' }];

/** Função, dificuldades do método e etiquetas livres; alterações podem ser desfeitas. */
function PainelDeEtiquetas({ marca, versaoId, fontes, funcao }: { marca: MarcaDoLeitor; versaoId: Id; fontes: FontesDasEtiquetas; funcao: FuncaoDoBalao | undefined }): ReactNode {
  const { funcoes: doModo, cor } = usarFuncoes();
  const pilha = usarDesfazer();
  const [etiquetas, definirEtiquetas] = useState<EtiquetaV1[] | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [nomeLivre, definirNomeLivre] = useState('');
  const [sugestoes, definirSugestoes] = useState<string[]>([]);
  const [salvando, definirSalvando] = useState(false);
  const listaId = useId();
  const primeira = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let vivo = true;
    void fontes.listar(versaoId).then((resposta) => {
      if (vivo) {
        definirEtiquetas(resposta.etiquetas.filter((etiqueta) => etiqueta.alvo.tipo === 'marca' && etiqueta.alvo.id === marca.id));
        definirSugestoes(resposta.sugestoes);
      }
    }, () => { if (vivo) { definirEtiquetas([]); definirErro('Não foi possível carregar as etiquetas.'); } });
    primeira.current?.focus({ preventScroll: true });
    return () => { vivo = false; };
  }, [fontes, marca.id, versaoId]);

  const funcoes = [...(doModo.length > 0 ? doModo : FUNCOES_DO_METODO), { chave: 'nenhuma', rotulo: 'Nenhuma' }];
  const rotuloDa = (chave: string) => funcoes.find((item) => item.chave === chave)?.rotulo ?? chave;
  const escolherFuncao = (chave: string) => {
    if (!funcao || chave === marca.funcao) return;
    definirErro(null);
    void funcao.trocar(chave).catch((falha: unknown) => definirErro(falha instanceof Error ? falha.message : 'Não foi possível trocar a função.'));
  };
  // 1, 2, 3… escolhem a função pela ordem dos botões.
  const escolherRef = useRef(escolherFuncao); escolherRef.current = escolherFuncao;
  const chaves = funcoes.map((item) => item.chave).join(' ');
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      if (evento.metaKey || evento.ctrlKey || evento.altKey || digitando(evento.target) || atalhoDeUmaTeclaDesligado(evento)) return;
      const chave = chaves.split(' ')[Number(evento.key) - 1];
      if (/^[1-9]$/.test(evento.key) && chave) { evento.preventDefault(); escolherRef.current(chave); }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [chaves]);
  const criar = (nome: string) => fontes.criar(versaoId, { tipo: 'marca', id: marca.id }, nome).then(({ etiqueta }) => {
    definirEtiquetas((atuais) => [...(atuais ?? []).filter((item) => item.nome.toLowerCase() !== etiqueta.nome.toLowerCase()), etiqueta]);
    definirSugestoes((atuais) => [...atuais.filter((item) => item.toLowerCase() !== etiqueta.nome.toLowerCase()), etiqueta.nome]);
    return etiqueta;
  });
  const apagar = (etiqueta: EtiquetaV1) => {
    definirEtiquetas((atuais) => (atuais ?? []).filter((item) => item.id !== etiqueta.id));
    return fontes.apagar(etiqueta.id).then(() => undefined, (falha: unknown) => {
      definirEtiquetas((atuais) => [...(atuais ?? []), etiqueta]);
      throw falha;
    });
  };
  const livres = etiquetas?.filter((item) => !ehDificuldade(item.nome)) ?? [];
  const alternar = (nome: string) => {
    definirErro(null);
    const existente = etiquetas?.find((etiqueta) => etiqueta.nome.toLowerCase() === nome.toLowerCase());
    const rotulo = DIFICULDADES.includes(nome as TipoDificuldadeTextual) ? ROTULO_DA_DIFICULDADE[nome as TipoDificuldadeTextual] : nome;
    if (existente) {
      void apagar(existente).then(
        () => pilha.registrar({ rotulo: `Etiqueta “${rotulo}” retirada`, desfazer: () => criar(nome).then(() => undefined) }),
        () => definirErro('Não foi possível tirar a etiqueta.'),
      );
    } else {
      void criar(nome).then(
        (etiqueta) => pilha.registrar({ rotulo: `Etiqueta “${rotulo}”`, desfazer: () => apagar(etiqueta) }),
        (falha: unknown) => definirErro(falha instanceof Error ? falha.message : 'Não foi possível etiquetar.'),
      );
    }
  };

  return <div className="balao-etiquetas">
    <p className="balao-rotulo" id={`funcao-${marca.id}`}>Função</p>
    <div className="chips-de-funcao" role="radiogroup" aria-labelledby={`funcao-${marca.id}`}>
      {funcoes.map((item, indice) => <button key={item.chave} ref={indice === 0 ? primeira : undefined} type="button" role="radio" aria-checked={marca.funcao === item.chave}
        disabled={!funcao} className="chip" title={`${item.rotulo}  ${String(indice + 1)}`} onClick={() => escolherFuncao(item.chave)}>
        <span className="chip-cor" aria-hidden="true" style={{ background: cor(item.chave, 'modo' in marca ? marca.modo : undefined) }} />{item.rotulo}
      </button>)}
    </div>
    {funcao?.daIa !== undefined && funcao.daIa !== marca.funcao && <p className="balao-nota-de-edicao">
      A IA marcou como {rotuloDa(funcao.daIa).toLocaleLowerCase('pt-BR')}. <button type="button" onClick={() => escolherFuncao(funcao.daIa ?? marca.funcao)}>Voltar</button>
    </p>}
    <p className="balao-rotulo" id={`duvida-${marca.id}`}>? Dificuldade</p>
    <ul className="chips-de-dificuldade" aria-labelledby={`duvida-${marca.id}`}>
      {DIFICULDADES.map((nome) => <li key={nome}><button type="button" className="chip" aria-pressed={etiquetas?.some((etiqueta) => etiqueta.nome.toLowerCase() === nome) ?? false}
        disabled={etiquetas === null} onClick={() => alternar(nome)}>{ROTULO_DA_DIFICULDADE[nome]}</button></li>)}
    </ul>
    <form className="etiqueta-livre" onSubmit={(evento) => {
      evento.preventDefault();
      const nome = nomeLivre.trim();
      if (salvando || etiquetas === null || !nome || [...nome].length > 40) return;
      if (etiquetas.some((item) => item.nome.toLowerCase() === nome.toLowerCase())) { definirNomeLivre(''); return; }
      definirErro(null); definirSalvando(true);
      void criar(nome).then((etiqueta) => {
        definirNomeLivre('');
        pilha.registrar({ rotulo: `Etiqueta “${etiqueta.nome}”`, desfazer: () => apagar(etiqueta) });
      }, (falha: unknown) => definirErro(falha instanceof Error ? falha.message : 'Não foi possível etiquetar.'))
        .finally(() => definirSalvando(false));
    }}>
      <label className="balao-rotulo" htmlFor={`${listaId}-nome`}>Etiqueta livre</label>
      <div className="etiqueta-livre-entrada">
        <input id={`${listaId}-nome`} list={listaId} value={nomeLivre} placeholder="Nova ou já usada"
          disabled={etiquetas === null || salvando} onChange={(evento) => definirNomeLivre(evento.target.value)} />
        <button type="submit" className="chip" disabled={etiquetas === null || salvando || !nomeLivre.trim() || [...nomeLivre.trim()].length > 40}>Adicionar</button>
      </div>
      <datalist id={listaId}>{sugestoes.filter((nome) => !ehDificuldade(nome) && !etiquetas?.some((item) => item.nome.toLowerCase() === nome.toLowerCase()))
        .map((nome) => <option key={nome} value={nome} />)}</datalist>
    </form>
    {livres.length > 0 && <ul className="chips-de-dificuldade" aria-label="Etiquetas livres">
      {livres.map((item) =>
        <li key={item.id}><button type="button" className="chip" aria-label={`Remover etiqueta ${item.nome}`} onClick={() => alternar(item.nome)}>{item.nome} ×</button></li>)}
    </ul>}
    {erro && <p className="balao-erro" role="alert">{erro}</p>}
  </div>;
}
