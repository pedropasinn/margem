import { Children, forwardRef, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type RefObject, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './primitives.css';

/**
 * O sistema de botões (J132): três tamanhos — `sm` 32 px (44 com toque) para ações de item e de lista,
 * `md` 40 px para formulários e cabeçalhos, `lg` 44 px para a ação principal da página — e quatro
 * variantes: `primario` (uma por formulário ou página), `secundario` (o 3D do cânone), `ghost` (Cancelar,
 * ações por item) e `perigo` (Apagar, só dentro de menu ou confirmação). Sem tamanho, vale o 44 de antes.
 */
export type VarianteDoBotao = 'primario' | 'secundario' | 'ghost' | 'perigo';
export type TamanhoDoBotao = 'sm' | 'md' | 'lg';
type PropsBotao = ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteDoBotao; tamanho?: TamanhoDoBotao | undefined };
/** As classes de um botão, para um link (`<a>`) com a mesma cara. */
export function classesDoBotao({ variante = 'secundario', tamanho }: { variante?: VarianteDoBotao; tamanho?: TamanhoDoBotao | undefined } = {}): string {
  return `ui-button ui-${variante}${tamanho ? ` ui-${tamanho}` : ''}`;
}
export const Button = forwardRef<HTMLButtonElement, PropsBotao>(function Button({ variante = 'secundario', tamanho, className = '', type = 'button', ...props }, ref) {
  return <button {...props} ref={ref} type={type} className={`${classesDoBotao({ variante, tamanho })} ${className}`} />;
});
/** Botão só de ícone: `icone` desenha o `Icon` do sistema (nunca um glifo de texto como × ou •••). */
export const IconButton = forwardRef<HTMLButtonElement, Omit<PropsBotao, 'variante'> & { 'aria-label': string; icone?: string }>(function IconButton({ className = '', tamanho = 'md', icone, children, ...props }, ref) {
  return <Button {...props} variante="ghost" tamanho={tamanho} ref={ref} className={`ui-icon ${className}`}>{icone ? <Icon name={icone} size={tamanho === 'sm' ? 16 : 18} /> : children}</Button>;
});
/** O chip único (filtros, etiquetas, dificuldades): `sm` 28 px, `md` 32 px; ligado, o fundo de destaque. */
export const Chip = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { tamanho?: 'sm' | 'md'; pressionado?: boolean; cor?: string | undefined; conta?: number | undefined }>(
  function Chip({ tamanho = 'sm', pressionado, cor, conta, className = '', type = 'button', children, style, ...props }, ref) {
    return <button {...props} ref={ref} type={type} aria-pressed={pressionado ?? props['aria-pressed']} className={`ui-chip ui-chip-${tamanho} ${className}`}
      style={cor ? { ...style, '--cor-chip': cor } as CSSProperties : style}>
      {cor && <span className="ui-chip-ponto" aria-hidden="true" />}{children}{conta !== undefined && <span className="ui-chip-conta">{conta}</span>}
    </button>;
  });
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...props }, ref) {
  return <input {...props} ref={ref} className={`ui-input ${className}`} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...props }, ref) {
  return <textarea {...props} ref={ref} className={`ui-input ui-textarea ${className}`} />;
});
interface PropsEscolha { checked: boolean; onChange: (valor: boolean) => void; children?: ReactNode; disabled?: boolean; name?: string; value?: string; 'aria-label'?: string }
function Escolha({ checked, onChange, children, name, value = '1', disabled, 'aria-label': nome, papel }: PropsEscolha & { papel: 'switch' | 'checkbox' }) {
  return <span className="ui-escolha"><Button variante="ghost" role={papel} aria-checked={checked} aria-label={nome} disabled={disabled} onClick={() => onChange(!checked)} className={`ui-${papel}`}><span className="ui-indicador" aria-hidden="true">{papel === 'checkbox' && checked ? '✓' : ''}</span>{children}</Button>{name && checked && <input type="hidden" name={name} value={value} disabled={disabled} />}</span>;
}
export function Switch(props: PropsEscolha) { return <Escolha {...props} papel="switch" />; }
export function Checkbox(props: PropsEscolha) { return <Escolha {...props} papel="checkbox" />; }

const FOCAVEIS = 'summary, button:not(:disabled), [href], input:not(:disabled):not([type=hidden]), textarea:not(:disabled), [tabindex="0"]';
const paineis: HTMLElement[] = [];
export function usarFoco(raiz: RefObject<HTMLElement>, fechar: () => void, ancora?: RefObject<HTMLElement>) {
  const fecharRef = useRef(fechar); fecharRef.current = fechar;
  useEffect(() => {
    const elemento = raiz.current;
    if (!elemento) return;
    const anterior = document.activeElement;
    paineis.push(elemento);
    (elemento.querySelector<HTMLElement>(FOCAVEIS) ?? elemento).focus({ preventScroll: true });
    const teclado = (e: KeyboardEvent) => {
      if (paineis.at(-1) !== elemento) return;
      if (e.key === 'Escape' && elemento.querySelector('[role=combobox][aria-expanded=true]')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharRef.current(); }
      if (e.key !== 'Tab') return;
      const alvos = [...elemento.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((a) => !a.closest('[hidden]'));
      const primeiro = alvos[0]; const ultimo = alvos.at(-1);
      if (!primeiro) { e.preventDefault(); elemento.focus(); }
      else if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === elemento)) { e.preventDefault(); ultimo?.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    const fora = (e: PointerEvent) => {
      const menu = e.target instanceof Element ? e.target.closest('[data-dono-select]') : null;
      if (menu && [...elemento.querySelectorAll('[aria-controls]')].some((controle) => controle.getAttribute('aria-controls') === menu.id)) return;
      if (paineis.at(-1) === elemento && e.target instanceof Node && !elemento.contains(e.target) && !ancora?.current?.contains(e.target)) fecharRef.current(); };
    document.addEventListener('keydown', teclado, true); document.addEventListener('pointerdown', fora);
    return () => {
      paineis.splice(paineis.indexOf(elemento), 1);
      document.removeEventListener('keydown', teclado, true); document.removeEventListener('pointerdown', fora);
      const retorno = ancora?.current ?? anterior;
      if (retorno instanceof HTMLElement && retorno.isConnected) retorno.focus({ preventScroll: true });
    };
  }, [raiz, ancora]);
}
/**
 * Popover e menu ancorado num botão. Renderiza num portal no `body`, na camada de sobreposição (acima
 * dos painéis laterais, do vídeo e das gavetas): nenhum contêiner com rolagem ou com camada própria o
 * corta, e o iframe do vídeo nunca fica por cima dele (V-T1). Abre abaixo do botão, alinhado à esquerda
 * dele; se não couber, alinha pela direita do botão e, se faltar altura embaixo, abre acima.
 */
export function Popover({ ancora, aoFechar, children, rotulo, largura = 280, className = '' }: { ancora: RefObject<HTMLElement>; aoFechar: () => void; children: ReactNode; rotulo: string; largura?: number; className?: string }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [posicao, posicionar] = useState({ left: 12, top: 60 });
  usarFoco(raiz, aoFechar, ancora);
  useLayoutEffect(() => {
    const medir = () => {
      const caixa = ancora.current?.getBoundingClientRect();
      const altura = raiz.current?.getBoundingClientRect().height ?? 0;
      posicionar(posicaoDoPopover(caixa ?? null, { largura: Math.min(largura, window.innerWidth - 24), altura }, { largura: window.innerWidth, altura: window.innerHeight }));
    };
    medir(); window.addEventListener('resize', medir); window.addEventListener('scroll', medir, true);
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    if (raiz.current) observador?.observe(raiz.current);
    return () => { window.removeEventListener('resize', medir); window.removeEventListener('scroll', medir, true); observador?.disconnect(); };
  }, [ancora, largura]);
  return createPortal(<div ref={raiz} role="dialog" aria-label={rotulo} tabIndex={-1} className={`ui-popover ${className}`} style={{ ...posicao, position: 'fixed', width: largura }}>{children}</div>, document.body);
}

type Caixa = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
/**
 * Onde o popover abre, em px da janela: logo abaixo da âncora e alinhado à esquerda dela; se passar da
 * borda direita, alinhado à direita da âncora; se faltar altura embaixo e houver mais em cima, acima
 * dela. Sempre a 12 px das bordas da janela.
 */
export function posicaoDoPopover(ancora: Caixa | null, popover: { largura: number; altura: number }, janela: { largura: number; altura: number }): { left: number; top: number } {
  const margem = 12; const distancia = 8;
  const base = ancora ?? { left: margem, right: margem, top: 40, bottom: 40 };
  const maxLeft = janela.largura - popover.largura - margem;
  const left = base.left + popover.largura <= janela.largura - margem ? base.left : base.right - popover.largura;
  const abaixo = janela.altura - base.bottom - distancia - margem;
  const acima = base.top - distancia - margem;
  const subir = popover.altura > abaixo && acima > abaixo;
  const top = subir ? base.top - distancia - popover.altura : base.bottom + distancia;
  return { left: Math.max(margem, Math.min(left, maxLeft)), top: Math.max(margem, Math.min(top, janela.altura - popover.altura - margem)) };
}
export function Drawer({ rotulo, aoFechar, children, lado = 'direita' }: { rotulo: string; aoFechar: () => void; children: ReactNode; lado?: 'esquerda' | 'direita' }) {
  const raiz = useRef<HTMLDivElement>(null); usarFoco(raiz, aoFechar);
  return <div className="ui-veu"><div ref={raiz} role="dialog" aria-modal="true" aria-label={rotulo} tabIndex={-1} className={`ui-drawer ui-drawer-${lado}`}><header><h2>{rotulo}</h2><IconButton aria-label="Fechar" icone="xis" onClick={aoFechar} /></header>{children}</div></div>;
}
interface Opcao { value: string; rotulo: ReactNode; disabled: boolean }
function opcoesDosFilhos(children: ReactNode): Opcao[] {
  return Children.toArray(children).flatMap((filho): Opcao[] => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(filho)) return [];
    if (filho.type === 'option') return [{ value: String(filho.props.value ?? ''), rotulo: filho.props.children, disabled: filho.props.disabled ?? false }];
    return opcoesDosFilhos(filho.props.children);
  });
}
interface PropsSelect { children: ReactNode; rotuloFechado?: ReactNode; value?: string | number; defaultValue?: string; onChange?: (e: { target: { value: string } }) => void; name?: string; required?: boolean; disabled?: boolean; 'aria-label'?: string; className?: string; 'data-estado'?: 'hover' | 'focus' }
/** Combobox com listbox: setas percorrem, Home/End saltam, Enter escolhe e Esc cancela. */
export function Select({ children, rotuloFechado, value, defaultValue, onChange, name, disabled, required, 'aria-label': nome, 'data-estado': estado, className = '' }: PropsSelect) {
  const opcoes = opcoesDosFilhos(children);
  const [local, definir] = useState(defaultValue ?? opcoes[0]?.value ?? '');
  const escolhido = String(value ?? local);
  const [aberto, abrir] = useState(false);
  const [indice, destacar] = useState(0);
  const botao = useRef<HTMLButtonElement>(null); const lista = useRef<HTMLDivElement>(null); const id = useId();
  const [posicao, posicionar] = useState({ left: 12, top: 12, width: 200, maxHeight: 240 });
  const habilitadas = opcoes.filter((o) => !o.disabled);
  const selecionar = (valor: string) => { definir(valor); onChange?.({ target: { value: valor } }); abrir(false); botao.current?.focus(); };
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (e.target instanceof Node && !lista.current?.contains(e.target) && !botao.current?.contains(e.target)) abrir(false); };
    document.addEventListener('pointerdown', fora); return () => document.removeEventListener('pointerdown', fora);
  }, [aberto]);
  useEffect(() => {
    if (aberto) lista.current?.querySelector('[data-ativo=true]')?.scrollIntoView?.({ block: 'nearest' });
  }, [aberto, indice]);
  useLayoutEffect(() => {
    if (!aberto) return;
    const medir = () => {
      const caixa = botao.current?.getBoundingClientRect();
      if (!caixa) return;
      const abaixo = window.innerHeight - caixa.bottom - 16;
      const acima = caixa.top - 16;
      const subir = abaixo < 180 && acima > abaixo;
      const maxHeight = Math.max(40, Math.min(240, subir ? acima : abaixo));
      const altura = Math.min(lista.current?.scrollHeight ?? maxHeight, maxHeight);
      const width = Math.min(Math.max(caixa.width, 180), window.innerWidth - 24);
      posicionar({ left: Math.max(12, Math.min(caixa.left, window.innerWidth - width - 12)), top: subir ? Math.max(12, caixa.top - altura - 8) : caixa.bottom + 8, width, maxHeight });
    };
    medir(); window.addEventListener('resize', medir); window.addEventListener('scroll', medir, true);
    return () => { window.removeEventListener('resize', medir); window.removeEventListener('scroll', medir, true); };
  }, [aberto]);
  return <span className={`ui-select ${className}`} data-estado={estado}>
    {name && <input type="hidden" name={name} value={escolhido} disabled={disabled} />}
    <Button ref={botao} role="combobox" aria-label={nome} aria-haspopup="listbox" aria-required={required} aria-expanded={aberto} aria-controls={id} aria-activedescendant={aberto ? `${id}-${indice}` : undefined} disabled={disabled} onClick={() => { destacar(Math.max(0, habilitadas.findIndex((o) => o.value === escolhido))); abrir(!aberto); }} onKeyDown={(e) => {
      if (e.key === 'Escape' && aberto) { e.preventDefault(); e.stopPropagation(); abrir(false); }
      if (e.key === 'Tab') abrir(false);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation(); abrir(true);
        const atual = aberto ? indice : Math.max(0, habilitadas.findIndex((o) => o.value === escolhido));
        destacar(e.key === 'Home' ? 0 : e.key === 'End' ? habilitadas.length - 1 : Math.max(0, Math.min(habilitadas.length - 1, atual + (e.key === 'ArrowDown' ? 1 : -1))));
      } else if ((e.key === 'Enter' || e.key === ' ') && aberto) { e.preventDefault(); const opcao = habilitadas[indice]; if (opcao) selecionar(opcao.value); }
      else if (e.key.length === 1 && e.key !== ' ') { const i = habilitadas.findIndex((o) => typeof o.rotulo === 'string' && o.rotulo.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase())); if (i >= 0) { abrir(true); destacar(i); } }
    }}><span>{rotuloFechado ?? opcoes.find((o) => o.value === escolhido)?.rotulo ?? 'Escolher'}</span><svg className="ui-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></Button>
    {aberto && createPortal(<div ref={lista} id={id} data-dono-select="" style={posicao} role="listbox" aria-label={nome} className="ui-listbox">{habilitadas.map((o, i) => <div id={`${id}-${i}`} key={o.value} role="option" aria-selected={escolhido === o.value} data-ativo={indice === i} onPointerDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); e.stopPropagation(); selecionar(o.value); }}>{o.rotulo}</div>)}</div>, document.body)}
  </span>;
}
export function SegmentedControl({ rotulo, valor, opcoes, aoMudar, className = '' }: { rotulo: string; valor: string; opcoes: readonly { valor: string; rotulo: ReactNode; nome?: string; dica?: string }[]; aoMudar: (valor: string) => void; className?: string }) {
  return <div role="radiogroup" aria-label={rotulo} className={`ui-segmented ${className}`}>{opcoes.map((o, i) => <Button key={o.valor} variante="ghost" role="radio" aria-label={o.nome} title={o.dica} aria-checked={valor === o.valor} tabIndex={valor === o.valor || (i === 0 && !opcoes.some((x) => x.valor === valor)) ? 0 : -1} onClick={() => aoMudar(o.valor)} onKeyDown={(e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); const proxima = e.key === 'Home' ? 0 : e.key === 'End' ? opcoes.length - 1 : (i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + opcoes.length) % opcoes.length;
    aoMudar(opcoes[proxima]!.valor); (e.currentTarget.parentElement?.children[proxima] as HTMLElement | undefined)?.focus();
  }}>{o.rotulo}</Button>)}</div>;
}

export function SeletorDeArquivo({ arquivos, aoEscolher, disabled = false }: { arquivos: File[]; aoEscolher: (arquivos: File[]) => void; disabled?: boolean }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [arrastando, arrastar] = useState(false);
  return <div className="dropzone" data-arrastando={arrastando} aria-disabled={disabled} onDragOver={(e) => { e.preventDefault(); if (!disabled) arrastar(true); }} onDragLeave={() => arrastar(false)} onDrop={(e) => {
    e.preventDefault(); arrastar(false); const novos = Array.from(e.dataTransfer.files); if (novos.length && !disabled) aoEscolher(novos);
  }}>
    <Input ref={entrada} type="file" multiple hidden disabled={disabled} aria-label="Arquivo" accept=".pdf,.md,.markdown,.txt,.epub,application/epub+zip" onChange={(e) => { const novos = Array.from(e.target.files ?? []); if (novos.length) aoEscolher(novos); e.target.value = ''; }} />
    <p>{arquivos.length === 1 ? arquivos[0]!.name : arquivos.length ? `${arquivos.length} arquivos selecionados` : 'Solte os arquivos aqui ou escolha abaixo'}</p>
    <Button disabled={disabled} onClick={() => entrada.current?.click()}>{arquivos.length ? 'Trocar arquivos' : 'Escolher arquivos'}</Button><small>PDF · EPUB · MD · TXT</small>
  </div>;
}
