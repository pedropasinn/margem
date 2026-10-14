/**
 * O balão do grifo (J138, modelo D: "o trecho no centro, um dono por pergunta"). Abre ao grifar e ao
 * tocar num grifo, logo acima (ou abaixo) do trecho, e reúne o que é do trecho:
 *
 * - as funções do modo do grifo, em chips coloridos (escolher = cor + papel), "sem função" discreto, e
 *   "Outros olhares": as funções de todos os modos, pesquisáveis e agrupadas por modo — o vocabulário não
 *   fica preso ao tipo de leitura; os olhares usados há pouco no documento sobem para a fileira;
 * - "Sua anotação": texto simples, sem tipo, que se salva sozinho (com "Salvo");
 * - o comentário do Codex, abaixo, na voz do Assistente;
 * - o sinal de dificuldade do trecho, com confirmar e descartar;
 * - as conexões e o "⋯" (conectar, flashcard, marcar dificuldade, copiar, remover).
 *
 * Posiciona-se pelo desenho da marca (`[data-desenho]`), no texto e no PDF, e acompanha a rolagem.
 * Nada do modelo vai para `innerHTML`.
 */
import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AnotacaoV1, Id, ModoDeLeituraV1, NotaDoGrifoV1, ReferenciaModo, TipoDificuldadeTextual } from '@margem/contratos';
import { TIPOS_DE_DIFICULDADE } from '@margem/contratos/grifo';
import {
  ErroDaApi, apagarNotaDoGrifo, decidirDificuldadeDoCodex, gravarNotaDoGrifo, marcarDificuldade, mudarDificuldade,
} from '../biblioteca/api';
import { apagarItemDaAnalise } from '../apagar/api';
import { ConfirmarApagar } from '../apagar/ConfirmarApagar';
import { Button, Chip, IconButton, Input, Select, Textarea } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import type { MarcaDoLeitor } from './f2';
import { mesmaReferencia, modoDaMarca, usarFuncoes, type Olhar } from './ContextoDosModos';
import { MODO_DO_METODO, MenuDeMais, type ItemDoMenu } from './BarraDeSelecao';
import { ROTULO_DA_DIFICULDADE } from './compreensao/rotulos';
import type { SinalDeDificuldade } from './dificuldades';
import { atalhoDeUmaTeclaDesligado, digitando } from './teclado/comandos';

export interface FontesDoBalao {
  gravarNota: (marcaId: Id, texto: string, revisao?: number) => Promise<{ nota: NotaDoGrifoV1 }>;
  apagarNota: (marcaId: Id, revisao: number) => Promise<unknown>;
  marcarDificuldade: typeof marcarDificuldade;
  decidirDoCodex: typeof decidirDificuldadeDoCodex;
  mudarDificuldade: typeof mudarDificuldade;
  /** Apaga de vez um item da análise do Codex (aqui, uma dificuldade apontada por ele; V-T8). */
  apagarDaAnalise?: (execucaoId: Id, secaoId: Id, itemId: Id) => Promise<unknown>;
}
export const FONTES_DO_BALAO: FontesDoBalao = {
  gravarNota: gravarNotaDoGrifo, apagarNota: apagarNotaDoGrifo, marcarDificuldade, decidirDoCodex: decidirDificuldadeDoCodex, mudarDificuldade,
  apagarDaAnalise: apagarItemDaAnalise,
};

export interface AcoesDoBalao {
  /**
   * Apaga o grifo de vez, do leitor ou do Codex, com a nota e os sinais dele (V-T8): quem chama pede a
   * confirmação (`ConfirmarApagar`) antes.
   */
  remover: () => void;
  perguntar?: (() => void) | undefined;
  conectar?: (() => void) | undefined;
  /** Criar um flashcard a partir do trecho grifado. */
  flashcard?: (() => void) | undefined;
  /** Abre as conexões do trecho (no painel do trecho). */
  conexoes?: (() => void) | undefined;
}

/** Trocar a função do grifo; com `modo`, a função é de outro modo (outro olhar). `daIa`: a que a IA deu, se o leitor já trocou. */
export interface FuncaoDoBalao {
  trocar: (funcao: string, modo?: ReferenciaModo) => Promise<void>;
  daIa?: string | undefined;
}

const FOLGA = 8;
/** A faixa da barra do leitor no topo: o balão não sobe para debaixo dela. */
const TOPO_UTIL = 56;
/** Espera depois da última tecla antes de salvar a nota. */
export const ESPERA_PARA_SALVAR = 700;

/** A caixa da primeira linha da marca na tela: o desenho dela, ou o trecho quando não há desenho. */
function caixaDaMarca(id: Id): DOMRect | null {
  const seletor = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
  const primeiro = document.querySelector(`[data-desenho="${seletor}"] path`) ?? document.querySelector(`span[data-marcas~="${seletor}"]`) ?? document.querySelector(`[data-marcas="${seletor}"]`);
  const caixa = primeiro?.getBoundingClientRect();
  return caixa && caixa.width > 0 ? caixa : null;
}

/** A última linha da marca: com o balão abaixo, ele vem depois do trecho inteiro. */
function caixaDoFimDaMarca(id: Id): DOMRect | null {
  const seletor = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
  const linhas = [...document.querySelectorAll(`[data-desenho="${seletor}"] path`)].map((linha) => linha.getBoundingClientRect()).filter((caixa) => caixa.width > 0);
  return linhas.length === 0 ? null : linhas.reduce((ultima, caixa) => (caixa.bottom > ultima.bottom ? caixa : ultima));
}

const semAcento = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

export interface PropsDoBalao {
  marca: MarcaDoLeitor;
  acoes: AcoesDoBalao;
  aoFechar: () => void;
  funcao?: FuncaoDoBalao | undefined;
  /** A nota do leitor sobre este grifo (a anotação ligada a ele), se houver. */
  nota?: Pick<AnotacaoV1, 'id' | 'texto' | 'revisao_edicao'> | null;
  /** Os sinais de dificuldade que cruzam o trecho. */
  dificuldades?: readonly SinalDeDificuldade[];
  /** Quantas conexões passam pelo trecho. */
  conexoes?: number;
  /** Abre já com o cursor na nota (N, "Anotar"). */
  focarNota?: boolean;
  /** Abre já com "Outros olhares" aberto. */
  olharesAbertos?: boolean;
  /** Depois de salvar a nota ou decidir uma dificuldade: quem chama recarrega o capítulo. */
  aoMudar?: (() => void) | undefined;
  fontes?: FontesDoBalao;
}

const SEM_SINAIS: readonly SinalDeDificuldade[] = [];

export function BalaoDaMarca({ marca, acoes, aoFechar, funcao, nota = null, dificuldades = SEM_SINAIS, conexoes = 0, focarNota = false, olharesAbertos = false, aoMudar, fontes = FONTES_DO_BALAO }: PropsDoBalao): ReactNode {
  const raiz = useRef<HTMLDivElement>(null);
  const [posicao, definirPosicao] = useState<{ left: number; top: number; abaixo: boolean } | null>(null);
  const [olhares, abrirOlhares] = useState(olharesAbertos);
  const [erro, definirErro] = useState<string | null>(null);
  const [copiado, copiar] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const notaDoGrifo = usarNotaDoGrifo(marca.id, nota, fontes, aoMudar);
  const { rotulo, lembrarOlhar } = usarFuncoes();
  const { fileira, rotuloAtual, modoAtual } = usarFileiraDoBalao(marca);

  const posicionar = useCallback(() => {
    const caixa = caixaDaMarca(marca.id);
    if (!caixa) { definirPosicao(null); return; }
    const largura = raiz.current?.offsetWidth ?? 340;
    const altura = raiz.current?.offsetHeight ?? 200;
    const left = Math.max(FOLGA, Math.min(window.innerWidth - largura - FOLGA, caixa.left));
    // Acima da primeira linha quando cabe; senão, logo abaixo da última. Nunca cobre o trecho.
    const fim = caixaDoFimDaMarca(marca.id) ?? caixa;
    const abaixo = caixa.top - altura - FOLGA < TOPO_UTIL;
    const top = abaixo ? fim.bottom + FOLGA : caixa.top - altura - FOLGA;
    definirPosicao({ left, top, abaixo });
  }, [marca.id]);
  useLayoutEffect(() => { posicionar(); }, [posicionar, olhares, dificuldades.length]);
  useEffect(() => {
    let quadro = 0;
    const agendar = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(posicionar); };
    window.addEventListener('scroll', agendar, true);
    window.addEventListener('resize', agendar);
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(agendar) : null;
    if (raiz.current) observador?.observe(raiz.current);
    return () => { cancelAnimationFrame(quadro); observador?.disconnect(); window.removeEventListener('scroll', agendar, true); window.removeEventListener('resize', agendar); };
  }, [posicionar]);
  useEffect(() => { if (focarNota) campo.current?.focus({ preventScroll: true }); }, [focarNota]);
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

  const lembrar = useRef(lembrarOlhar); lembrar.current = lembrarOlhar;
  const escolher = useCallback((olhar: { funcao: string; modo?: ReferenciaModo | undefined }, recente?: Olhar) => {
    if (!funcao) return;
    const outroModo = olhar.modo !== undefined && !mesmaReferencia(olhar.modo, modoAtual) ? olhar.modo : undefined;
    if (olhar.funcao === marca.funcao && outroModo === undefined) return;
    definirErro(null);
    void funcao.trocar(olhar.funcao, outroModo).then(() => { if (recente) lembrar.current(recente); },
      (falha: unknown) => definirErro(falha instanceof Error ? falha.message : 'Não foi possível trocar a função.'));
  }, [funcao, marca.funcao, modoAtual]);

  const teclas = useRef({ fileira, escolher, acoes, aoFechar, olhares });
  teclas.current = { fileira, escolher, acoes, aoFechar, olhares };
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      const atual = teclas.current;
      if (evento.key === 'Escape') {
        if (atual.olhares) { abrirOlhares(false); return; }
        if (digitando(evento.target) && !(evento.target instanceof Node && raiz.current?.contains(evento.target))) return;
        atual.aoFechar(); return;
      }
      if (digitando(evento.target) || evento.metaKey || evento.ctrlKey || evento.altKey || atalhoDeUmaTeclaDesligado(evento)) return;
      const tecla = evento.key.toLowerCase();
      const daTecla = /^[1-9]$/.test(tecla) ? atual.fileira[Number(tecla) - 1] : undefined;
      if (daTecla) { evento.preventDefault(); atual.escolher(daTecla, daTecla.recente && daTecla.modo ? { modo: daTecla.modo, funcao: daTecla.funcao } : undefined); }
      else if (tecla === 'n') { evento.preventDefault(); campo.current?.focus({ preventScroll: true }); }
      else if (tecla === 'p' && atual.acoes.perguntar) { evento.preventDefault(); atual.acoes.perguntar(); }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, []);

  const doLeitor = dificuldades.some((d) => d.origem === 'leitor' && d.estado !== 'descartada');
  const agir = (acao: () => Promise<unknown>, padrao: string) => {
    definirErro(null);
    void acao().then(() => aoMudar?.(), (falha: unknown) => definirErro(falha instanceof Error ? falha.message : padrao));
  };
  const mais: ItemDoMenu[] = [
    ...(acoes.conectar ? [{ id: 'conectar', rotulo: 'Conectar a outro trecho', icone: 'relacao', executar: acoes.conectar }] : []),
    ...(acoes.flashcard ? [{ id: 'flashcard', rotulo: 'Criar flashcard', icone: 'cartoes', executar: acoes.flashcard }] : []),
    ...(doLeitor ? [] : [{ id: 'dificuldade', rotulo: 'Marcar dificuldade', icone: 'alerta', executar: () => agir(() => fontes.marcarDificuldade(marca.ancora, marca.id), 'Não foi possível marcar a dificuldade.') }]),
    { id: 'copiar', rotulo: copiado ? 'Copiado' : 'Copiar texto', icone: 'copiar', executar: () => {
      void navigator.clipboard?.writeText(marca.ancora.citacao).then(() => { copiar(true); setTimeout(() => copiar(false), 1200); }, () => undefined);
    } },
    { id: 'remover', rotulo: 'Remover grifo', icone: 'lixeira', perigo: true, executar: acoes.remover },
  ];
  const comentario = marca.origem !== 'manual' ? marca.comentario : null;

  return <div ref={raiz} className={`balao-da-marca${posicao?.abaixo ? ' abaixo' : ''}`} role="dialog" aria-label={`Grifo: ${rotuloAtual}`}
    style={posicao ? { left: posicao.left, top: posicao.top } : { left: FOLGA, top: TOPO_UTIL + FOLGA }}>
    <FileiraDoBalao fileira={fileira} atual={marca.funcao} modoAtual={modoAtual} desabilitada={!funcao} aoEscolher={escolher}
      olhares={olhares} aoAlternarOlhares={() => abrirOlhares(!olhares)} />
    {funcao?.daIa !== undefined && funcao.daIa !== marca.funcao && <p className="balao-nota-de-edicao">
      O Codex marcou como {rotulo(funcao.daIa, modoAtual).toLocaleLowerCase('pt-BR')}. <button type="button" onClick={() => escolher({ funcao: funcao.daIa ?? marca.funcao })}>Voltar</button>
    </p>}
    {olhares && <OutrosOlhares modoAtual={modoAtual} atual={marca.funcao} aoEscolher={(olhar) => { abrirOlhares(false); escolher(olhar, olhar); }} />}

    <CampoDaNota ref={campo} estado={notaDoGrifo} />

    {comentario && <section className="balao-assistente" aria-label="Comentário do Codex">
      <p className="balao-voz">Assistente · {comentario.rotulo}</p>
      <p className="balao-assistente-texto">{comentario.texto}</p>
    </section>}

    {dificuldades.map((sinal) => <LinhaDaDificuldade key={sinal.chave} sinal={sinal} fontes={fontes} aoMudar={aoMudar} aoErro={definirErro} />)}

    <footer className="balao-rodape">
        {conexoes > 0 && acoes.conexoes
          ? <Button variante="ghost" tamanho="sm" className="balao-conexoes" onClick={acoes.conexoes}><Icon name="relacao" size={14} />{conexoes === 1 ? '1 conexão' : `${String(conexoes)} conexões`}</Button>
          : <span />}
        <span className="balao-acoes">
          {acoes.perguntar && <Button variante="ghost" tamanho="sm" onClick={acoes.perguntar} title="Perguntar  P">Perguntar</Button>}
          <MenuDeMais itens={mais} rotulo="Mais ações do grifo" />
          <IconButton tamanho="sm" icone="xis" aria-label="Fechar" onClick={aoFechar} />
        </span>
      </footer>
    {erro && <p className="balao-erro" role="alert">{erro}</p>}
  </div>;
}

/** Uma função na fileira do balão: do modo do grifo, ou um olhar recente de outro modo. */
export interface FuncaoDaFileira { funcao: string; rotulo: string; cor: string; modo?: ReferenciaModo | undefined; recente?: boolean }

/**
 * A fileira: as funções do modo do grifo (sem o modo no catálogo, as do método) e, depois, até três olhares
 * recentes de outros modos usados no documento.
 */
function usarFileiraDoBalao(marca: MarcaDoLeitor): { fileira: FuncaoDaFileira[]; rotuloAtual: string; modoAtual: ReferenciaModo } {
  const { modos, cor, rotuloDaMarca, recentes, rotulo, nomeDoModo } = usarFuncoes();
  const modoAtual = modoDaMarca(marca) ?? MODO_DO_METODO;
  const doModo = modos.find((m) => mesmaReferencia(m, modoAtual));
  const proprias: FuncaoDaFileira[] = doModo
    ? doModo.funcoes.map((f) => ({ funcao: f.chave, rotulo: f.rotulo, cor: cor(f.chave, modoAtual), modo: modoAtual }))
    : ['tese', 'conceito', 'justificativa'].map((chave) => ({ funcao: chave, rotulo: rotulo(chave), cor: cor(chave), modo: modoAtual }));
  // Um olhar recente cujo rótulo já está na fileira (a "Tese" de outro modo, ao lado da "Tese" deste) só repetiria o chip.
  const deFora = recentes.filter((o) => !mesmaReferencia(o.modo, modoAtual) && !proprias.some((f) => f.rotulo === rotulo(o.funcao, o.modo))).slice(0, 3)
    .map((o): FuncaoDaFileira => ({ funcao: o.funcao, rotulo: `${rotulo(o.funcao, o.modo)} · ${nomeDoModo(o.modo)}`, cor: cor(o.funcao, o.modo), modo: o.modo, recente: true }));
  return { fileira: [...proprias, ...deFora], rotuloAtual: rotuloDaMarca(marca), modoAtual };
}

function FileiraDoBalao({ fileira, atual, modoAtual, desabilitada, aoEscolher, olhares, aoAlternarOlhares }: {
  fileira: readonly FuncaoDaFileira[]; atual: string; modoAtual: ReferenciaModo; desabilitada: boolean;
  aoEscolher: (olhar: { funcao: string; modo?: ReferenciaModo | undefined }, recente?: Olhar) => void; olhares: boolean; aoAlternarOlhares: () => void;
}): ReactNode {
  const { cor } = usarFuncoes();
  const id = useId();
  const marcada = (item: FuncaoDaFileira) => item.funcao === atual && mesmaReferencia(item.modo, modoAtual);
  return <div className="balao-funcoes">
    <span id={`${id}-funcao`} className="balao-oculto">Função do grifo</span>
    <div className="chips-de-funcao" role="radiogroup" aria-labelledby={`${id}-funcao`}>
      {fileira.map((item, indice) => <Chip key={`${item.modo?.id ?? ''}:${item.funcao}`} role="radio" aria-checked={marcada(item)} disabled={desabilitada}
        className={item.recente ? 'chip-recente' : undefined} title={`${item.rotulo}${indice < 9 ? `  ${String(indice + 1)}` : ''}`} cor={item.cor}
        onClick={() => aoEscolher(item, item.recente && item.modo ? { modo: item.modo, funcao: item.funcao } : undefined)}>{item.rotulo}</Chip>)}
      <Chip role="radio" aria-checked={atual === 'nenhuma'} disabled={desabilitada} className="chip-sem-funcao" cor={cor('nenhuma')}
        onClick={() => aoEscolher({ funcao: 'nenhuma' })}>Sem função</Chip>
    </div>
    <Button variante="ghost" tamanho="sm" className="balao-olhares" aria-expanded={olhares} onClick={aoAlternarOlhares} disabled={desabilitada}>
      Outros olhares<Icon name="abaixo" size={14} />
    </Button>
  </div>;
}

/** "Outros olhares": as funções de todos os modos, pesquisáveis, agrupadas por modo. */
function OutrosOlhares({ modoAtual, atual, aoEscolher }: { modoAtual: ReferenciaModo; atual: string; aoEscolher: (olhar: Olhar) => void }): ReactNode {
  const { modos, cor, recentes } = usarFuncoes();
  const [busca, buscar] = useState('');
  const entrada = useRef<HTMLInputElement>(null);
  useEffect(() => { entrada.current?.focus({ preventScroll: true }); }, []);
  // Uma revisão por modo (a mais nova): o catálogo guarda as anteriores para os grifos antigos.
  const ultimas = useMemo(() => modos.filter((m) => !modos.some((outro) => outro.id === m.id && outro.revisao > m.revisao)), [modos]);
  const termo = semAcento(busca.trim());
  // Os modos usados há pouco vêm primeiro; depois, em ordem alfabética.
  const ordem = (m: ModoDeLeituraV1) => { const i = recentes.findIndex((o) => o.modo.id === m.id); return i < 0 ? Infinity : i; };
  const grupos = ultimas.filter((m) => m.id !== modoAtual.id)
    .map((m) => ({ modo: m, funcoes: m.funcoes.filter((f) => termo === '' || semAcento(`${f.rotulo} ${m.nome} ${f.chave}`).includes(termo)) }))
    .filter((g) => g.funcoes.length > 0)
    .sort((a, b) => ordem(a.modo) - ordem(b.modo) || a.modo.nome.localeCompare(b.modo.nome, 'pt-BR'));
  return <div className="balao-olhares-lista">
    <Input ref={entrada} type="search" value={busca} onChange={(evento) => buscar(evento.target.value)} placeholder="Procurar função ou modo" aria-label="Procurar entre outros olhares" />
    <div className="balao-olhares-grupos" role="listbox" aria-label="Outros olhares">
      {grupos.length === 0 && <p className="balao-vazio">Nenhuma função com esse nome.</p>}
      {grupos.map(({ modo, funcoes }) => <div key={`${modo.id}@${String(modo.revisao)}`} role="group" aria-label={modo.nome}>
        <p className="balao-grupo" aria-hidden="true">{modo.nome}</p>
        {funcoes.map((f) => {
          const ref = { id: modo.id, revisao: modo.revisao };
          return <button key={f.chave} type="button" role="option" aria-selected={f.chave === atual && mesmaReferencia(ref, modoAtual)} className="balao-olhar"
            title={f.descricao} onClick={() => aoEscolher({ modo: ref, funcao: f.chave })}>
            <span className="chip-cor" aria-hidden="true" style={{ background: cor(f.chave, ref) }} />{f.rotulo}<span className="balao-olhar-modo">{modo.nome}</span>
          </button>;
        })}
      </div>)}
    </div>
  </div>;
}

// ------------------------------------------------------------------ a nota do grifo

type EstadoDoSalvamento = 'ocioso' | 'salvando' | 'salvo' | 'erro';
export interface EstadoDaNota {
  texto: string; mudar: (texto: string) => void; salvamento: EstadoDoSalvamento; erro: string | null; temNota: boolean; salvarAgora: () => void;
}

/**
 * A nota do grifo com salvamento sozinho: espera uma pausa na digitação, grava (cria ou troca o texto) e
 * mostra "Salvo". Apagar o texto inteiro tira a nota (o grifo fica). Ao fechar, o que faltava é gravado.
 */
export function usarNotaDoGrifo(marcaId: Id, nota: Pick<AnotacaoV1, 'texto' | 'revisao_edicao'> | null, fontes: Pick<FontesDoBalao, 'gravarNota' | 'apagarNota'>, aoMudar?: () => void): EstadoDaNota {
  const [texto, definirTexto] = useState(nota?.texto ?? '');
  const [salvamento, definirSalvamento] = useState<EstadoDoSalvamento>('ocioso');
  const [erro, definirErro] = useState<string | null>(null);
  const [temNota, definirTemNota] = useState(nota !== null);
  const gravado = useRef<{ texto: string; revisao: number | undefined }>({ texto: nota?.texto ?? '', revisao: nota?.revisao_edicao });
  const fila = useRef<Promise<void>>(Promise.resolve());
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atual = useRef(texto); atual.current = texto;
  const externos = useRef({ fontes, aoMudar, marcaId }); externos.current = { fontes, aoMudar, marcaId };
  // Outra tela trocou a nota (o capítulo recarregou com outra revisão) e não há nada pendente aqui: vale a de fora.
  useEffect(() => {
    if (nota && (gravado.current.revisao === undefined || nota.revisao_edicao > gravado.current.revisao) && atual.current === gravado.current.texto && relogio.current === null) {
      gravado.current = { texto: nota.texto, revisao: nota.revisao_edicao };
      definirTexto(nota.texto); definirTemNota(true);
    }
  }, [nota]);

  const gravar = useCallback(() => {
    if (relogio.current) { clearTimeout(relogio.current); relogio.current = null; }
    fila.current = fila.current.then(async () => {
      const { fontes: f, marcaId: id } = externos.current;
      const alvo = atual.current.trim();
      if (alvo === gravado.current.texto.trim()) return;
      definirSalvamento('salvando'); definirErro(null);
      try {
        if (alvo === '') {
          if (gravado.current.revisao !== undefined) await f.apagarNota(id, gravado.current.revisao);
          gravado.current = { texto: '', revisao: undefined };
          definirTemNota(false);
        } else {
          const { nota: salva } = await f.gravarNota(id, alvo, gravado.current.revisao);
          gravado.current = { texto: salva.texto, revisao: salva.revisao_edicao };
          definirTemNota(true);
        }
        definirSalvamento('salvo');
        externos.current.aoMudar?.();
      } catch (falha) {
        definirSalvamento('erro');
        definirErro(falha instanceof ErroDaApi && falha.status === 409 ? 'A nota mudou em outro lugar. Feche e abra o grifo para ver a versão atual.'
          : falha instanceof Error && falha.message ? falha.message : 'Não foi possível salvar a nota.');
      }
    });
  }, []);
  const mudar = useCallback((novo: string) => {
    definirTexto(novo);
    definirSalvamento('ocioso');
    if (relogio.current) clearTimeout(relogio.current);
    relogio.current = setTimeout(gravar, ESPERA_PARA_SALVAR);
  }, [gravar]);
  // Ao fechar o balão, grava o que faltava.
  useEffect(() => () => { if (relogio.current) gravar(); }, [gravar]);
  return { texto, mudar, salvamento, erro, temNota, salvarAgora: gravar };
}

/** O campo "Sua anotação": texto simples, sem tipo; salva sozinho. */
export const CampoDaNota = forwardRef<HTMLTextAreaElement, { estado: EstadoDaNota; rotulo?: string }>(function CampoDaNota({ estado, rotulo = 'Sua anotação' }, ref) {
  const id = useId();
  const situacao = estado.salvamento === 'salvando' ? 'Salvando…' : estado.salvamento === 'salvo' ? 'Salvo' : '';
  return <div className="campo-da-nota">
    <div className="campo-da-nota-cabeca">
      <label htmlFor={id}>{rotulo}</label>
      <span className="campo-da-nota-estado" role="status" aria-live="polite">{situacao}</span>
    </div>
    <Textarea id={id} ref={ref} rows={2} maxLength={8000} value={estado.texto} placeholder="Escreva sobre este trecho"
      onChange={(evento) => estado.mudar(evento.target.value)} onBlur={estado.salvarAgora} />
    {estado.erro && <p className="balao-erro" role="alert">{estado.erro}</p>}
  </div>;
});

// ------------------------------------------------------------------ o sinal de dificuldade

export function LinhaDaDificuldade({ sinal, fontes = FONTES_DO_BALAO, aoMudar, aoErro }: { sinal: SinalDeDificuldade; fontes?: FontesDoBalao; aoMudar?: (() => void) | undefined; aoErro: (erro: string | null) => void }): ReactNode {
  const [ocupado, ocupar] = useState(false);
  const agir = (acao: () => Promise<unknown>) => {
    ocupar(true); aoErro(null);
    void acao().then(() => aoMudar?.(), (falha: unknown) => aoErro(falha instanceof Error ? falha.message : 'Não foi possível registrar.')).finally(() => ocupar(false));
  };
  const decidir = (estado: 'confirmada' | 'descartada' | 'sugerida') => agir(() => sinal.origem === 'codex' && sinal.codex
    ? fontes.decidirDoCodex(sinal.codex.modelo_id, sinal.codex.dificuldade_id, estado)
    : fontes.mudarDificuldade(sinal.gravada!.id, { estado }));
  const nome = sinal.tipo ? ROTULO_DA_DIFICULDADE[sinal.tipo] : 'Dificuldade';
  // A apontada pelo Codex na análise aberta pode sair de vez (V-T8); descartar continua só escondendo.
  const [removendo, confirmarRemocao] = useState(false);
  const { analise, codex } = sinal;
  const apagavel = sinal.origem === 'codex' && analise && codex && fontes.apagarDaAnalise
    ? () => fontes.apagarDaAnalise!(analise.execucao_id, analise.secao_id, codex.dificuldade_id) : null;
  if (sinal.estado === 'descartada') return <div className="balao-dificuldade descartada">
    <p className="balao-dificuldade-cabeca"><span className="sinal-de-dificuldade" aria-hidden="true">!</span>{nome} · descartada</p>
    <Button variante="ghost" tamanho="sm" disabled={ocupado} onClick={() => decidir(sinal.origem === 'codex' ? 'sugerida' : 'confirmada')}>Desfazer</Button>
  </div>;
  return <section className="balao-dificuldade" aria-label={`Dificuldade: ${nome}`}>
    <p className="balao-dificuldade-cabeca"><span className="sinal-de-dificuldade" aria-hidden="true">!</span><strong>{nome}</strong>
      <span className="balao-dificuldade-origem">{sinal.origem === 'leitor' ? 'marcada por você' : sinal.estado === 'sugerida' ? 'sugerida pelo Codex' : 'do Codex, confirmada'}</span></p>
    {sinal.descricao && <p className="balao-dificuldade-texto">{sinal.descricao}</p>}
    <div className="balao-dificuldade-acoes">
      {sinal.origem === 'leitor' && sinal.gravada && <Select aria-label="Categoria da dificuldade (opcional)" className="balao-categoria" value={sinal.tipo ?? ''} disabled={ocupado}
        onChange={(evento) => { const tipo = evento.target.value as TipoDificuldadeTextual | ''; agir(() => fontes.mudarDificuldade(sinal.gravada!.id, { tipo: tipo === '' ? null : tipo })); }}>
        <option value="">Categoria (opcional)</option>
        {TIPOS_DE_DIFICULDADE.map((tipo) => <option key={tipo} value={tipo}>{ROTULO_DA_DIFICULDADE[tipo]}</option>)}
      </Select>}
      {sinal.estado === 'sugerida' && <Button variante="ghost" tamanho="sm" disabled={ocupado} onClick={() => decidir('confirmada')}>Confirmar</Button>}
      <Button variante="ghost" tamanho="sm" disabled={ocupado} onClick={() => decidir('descartada')}>Descartar</Button>
      {apagavel && <Button variante="ghost" tamanho="sm" disabled={ocupado} onClick={() => confirmarRemocao(true)}>Remover</Button>}
    </div>
    {removendo && apagavel && createPortal(<ConfirmarApagar titulo="Remover esta dificuldade?"
      texto="Ela sai da análise do Codex deste capítulo; para só escondê-la, use Descartar." rotuloDoBotao="Remover" itens={[`${nome}: “${sinal.ancora.citacao}”`]}
      aoConfirmar={async () => { await apagavel(); aoMudar?.(); }} aoFechar={() => confirmarRemocao(false)} />, document.body)}
  </section>;
}
