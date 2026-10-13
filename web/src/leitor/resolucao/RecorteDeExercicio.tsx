/**
 * Recortar um exercício da página (J34). Com o modo ligado, uma camada por cima da tela recebe o
 * arrasto (mouse ou dedo) e desenha o retângulo; ao soltar, o recorte vira:
 * - a imagem: o pedaço do canvas da página que o pdf.js já desenhou, em PNG (na densidade da tela);
 * - o texto: as palavras da camada de texto do PDF cujo centro cai dentro do retângulo, na ordem de leitura;
 * - a página e o retângulo em frações da página (o que o contrato guarda).
 * Nada é enviado aqui: quem chama decide.
 */
import { useEffect, useRef, useState, type PointerEvent as EventoDePonteiro, type ReactNode } from 'react';
import { Button } from '../../ui/Primitives';

export interface Recorte {
  pagina: number;
  retangulo: { x: number; y: number; largura: number; altura: number };
  imagem_png: string;
  texto: string;
}

interface Ponto { x: number; y: number }
/** Menor recorte aceito, em pixels da tela: abaixo disso é um toque, não um arrasto. */
const MINIMO = 24;

/** A página (e o retângulo dentro dela) que um retângulo da tela cobre mais. */
export function paginaSob(caixa: DOMRect): { elemento: HTMLElement; numero: number; dentro: DOMRect } | null {
  let melhor: { elemento: HTMLElement; numero: number; dentro: DOMRect; area: number } | null = null;
  for (const elemento of document.querySelectorAll<HTMLElement>('.pdf-pagina[data-pagina]')) {
    const pagina = elemento.getBoundingClientRect();
    const esquerda = Math.max(pagina.left, caixa.left); const direita = Math.min(pagina.right, caixa.right);
    const topo = Math.max(pagina.top, caixa.top); const base = Math.min(pagina.bottom, caixa.bottom);
    const area = Math.max(0, direita - esquerda) * Math.max(0, base - topo);
    if (area > 0 && (!melhor || area > melhor.area)) {
      melhor = { elemento, numero: Number(elemento.dataset['pagina']), dentro: new DOMRect(esquerda, topo, direita - esquerda, base - topo), area };
    }
  }
  return melhor;
}

/** O texto da camada de texto dentro do retângulo, linha a linha. */
export function textoDoRecorte(pagina: HTMLElement, caixa: DOMRect): string {
  const palavras = [...pagina.querySelectorAll<HTMLElement>('.textLayer span')].flatMap((span) => {
    const r = span.getBoundingClientRect();
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    const texto = span.textContent ?? '';
    return r.width > 0 && texto.trim() !== '' && cx >= caixa.left && cx <= caixa.right && cy >= caixa.top && cy <= caixa.bottom
      ? [{ texto, x: r.left, y: cy, altura: r.height }] : [];
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas: { y: number; altura: number; partes: { texto: string; x: number }[] }[] = [];
  for (const palavra of palavras) {
    const linha = linhas.at(-1);
    if (linha && Math.abs(palavra.y - linha.y) < Math.max(4, linha.altura * 0.5)) linha.partes.push(palavra);
    else linhas.push({ y: palavra.y, altura: palavra.altura, partes: [palavra] });
  }
  return linhas.map((linha) => linha.partes.sort((a, b) => a.x - b.x).map((parte) => parte.texto).join(' ').replace(/\s+/g, ' ').trim()).join('\n');
}

/** O pedaço do canvas da página que o retângulo cobre, em PNG. */
export function imagemDoRecorte(pagina: HTMLElement, caixa: DOMRect): string | null {
  const canvas = pagina.querySelector('canvas');
  if (!canvas) return null;
  const tela = canvas.getBoundingClientRect();
  const escala = canvas.width / tela.width;
  const saida = document.createElement('canvas');
  saida.width = Math.max(1, Math.round(caixa.width * escala));
  saida.height = Math.max(1, Math.round(caixa.height * escala));
  const contexto = saida.getContext('2d');
  if (!contexto) return null;
  contexto.fillStyle = '#fff';
  contexto.fillRect(0, 0, saida.width, saida.height);
  contexto.drawImage(canvas, (caixa.left - tela.left) * escala, (caixa.top - tela.top) * escala, saida.width, saida.height, 0, 0, saida.width, saida.height);
  return saida.toDataURL('image/png');
}

export function RecorteDeExercicio({ aoRecortar, aoCancelar }: { aoRecortar: (recorte: Recorte) => void; aoCancelar: () => void }): ReactNode {
  const [inicio, definirInicio] = useState<Ponto | null>(null);
  const [atual, definirAtual] = useState<Ponto | null>(null);
  const [aviso, definirAviso] = useState<string | null>(null);
  const camada = useRef<HTMLDivElement>(null);
  const cancelar = useRef<HTMLButtonElement>(null);
  // O foco vai para o Cancelar: Esc e Enter funcionam de pronto, e o foco sai do menu que abriu o recorte.
  useEffect(() => { cancelar.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') aoCancelar(); };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [aoCancelar]);

  const caixa = inicio && atual ? new DOMRect(Math.min(inicio.x, atual.x), Math.min(inicio.y, atual.y), Math.abs(atual.x - inicio.x), Math.abs(atual.y - inicio.y)) : null;
  const comecar = (evento: EventoDePonteiro<HTMLDivElement>) => {
    evento.preventDefault();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    definirAviso(null);
    definirInicio({ x: evento.clientX, y: evento.clientY });
    definirAtual({ x: evento.clientX, y: evento.clientY });
  };
  const mover = (evento: EventoDePonteiro<HTMLDivElement>) => { if (inicio) definirAtual({ x: evento.clientX, y: evento.clientY }); };
  const soltar = () => {
    const feito = caixa;
    definirInicio(null); definirAtual(null);
    if (!feito || feito.width < MINIMO || feito.height < MINIMO) return;
    const pagina = paginaSob(feito);
    if (!pagina) { definirAviso('Arraste sobre uma página do PDF.'); return; }
    const imagem = imagemDoRecorte(pagina.elemento, pagina.dentro);
    if (!imagem) { definirAviso('A página ainda não foi desenhada; role até ela e tente de novo.'); return; }
    const folha = pagina.elemento.getBoundingClientRect();
    const fracao = (valor: number) => Math.min(1, Math.max(0, valor));
    aoRecortar({
      pagina: pagina.numero, imagem_png: imagem, texto: textoDoRecorte(pagina.elemento, pagina.dentro),
      retangulo: {
        x: fracao((pagina.dentro.left - folha.left) / folha.width), y: fracao((pagina.dentro.top - folha.top) / folha.height),
        largura: fracao(pagina.dentro.width / folha.width), altura: fracao(pagina.dentro.height / folha.height),
      },
    });
  };

  return <div ref={camada} className="camada-de-recorte" role="application" aria-label="Recortar exercício: arraste sobre o exercício na página"
    onPointerDown={comecar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => { definirInicio(null); definirAtual(null); }}>
    {caixa && <div className="retangulo-de-recorte" style={{ left: caixa.left, top: caixa.top, width: caixa.width, height: caixa.height }} />}
    <div className="aviso-de-recorte" onPointerDown={(evento) => evento.stopPropagation()}>
      <span>{aviso ?? 'Arraste sobre o exercício na página'}</span>
      <Button ref={cancelar} variante="ghost" onClick={aoCancelar}>Cancelar</Button>
    </div>
  </div>;
}
