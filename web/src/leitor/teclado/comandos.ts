/**
 * Leitura pelo teclado (J37): os comandos da paleta (Ctrl/Cmd + K), a lista de atalhos (`?`) e o
 * percurso de parágrafo em parágrafo (↑ ↓). Aqui só o que é puro; os componentes ficam ao lado.
 */
import type { Bloco, Id } from '@margem/contratos';

export interface Comando {
  id: string;
  rotulo: string;
  /** Grupo na paleta: "Leitura", "Marcas", "Visual", "Estudo"… */
  grupo: string;
  /** A tecla que faz o mesmo, para mostrar ao lado. */
  atalho?: string;
  /** Outras palavras que acham o comando ("tema", "escuro"…). */
  palavras?: string;
  executar: () => void;
}

/** Sem acento e em minúsculas, para a busca da paleta. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

/** Todas as palavras da busca precisam aparecer no rótulo, no grupo ou nas palavras extras. */
export function filtrarComandos(comandos: readonly Comando[], busca: string): Comando[] {
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return [...comandos];
  return comandos.filter((comando) => {
    const alvo = normalizar(`${comando.rotulo} ${comando.grupo} ${comando.palavras ?? ''}`);
    return termos.every((termo) => alvo.includes(termo));
  });
}

export interface Atalho { teclas: readonly string[]; descricao: string }
export interface GrupoDeAtalhos { titulo: string; atalhos: readonly Atalho[] }

export const ATALHOS: readonly GrupoDeAtalhos[] = [
  { titulo: 'Navegação', atalhos: [
    { teclas: ['↓'], descricao: 'Próximo parágrafo' },
    { teclas: ['↑'], descricao: 'Parágrafo anterior' },
    { teclas: ['Esc'], descricao: 'Sair do parágrafo, fechar o balão' },
    { teclas: ['Ctrl', 'F'], descricao: 'Buscar no documento inteiro (Enter e Shift Enter andam entre os achados)' },
  ] },
  { titulo: 'Marcas', atalhos: [
    { teclas: ['H'], descricao: 'Grifar o parágrafo em foco (ou a seleção); de novo, apaga' },
    { teclas: ['N'], descricao: 'Grifar e abrir as notas' },
    { teclas: ['T'], descricao: 'Função e dificuldades do grifo (com o balão aberto)' },
    { teclas: ['A'], descricao: 'Anotar a seleção' },
    { teclas: ['P'], descricao: 'Perguntar sobre a seleção' },
    { teclas: ['Z'], descricao: 'Desfazer (várias vezes seguidas)' },
  ] },
  { titulo: 'Painéis', atalhos: [
    { teclas: ['['], descricao: 'Sumário (painel esquerdo); sem sumário, esconde ou mostra as braquetes' },
    { teclas: ['Shift', '['], descricao: 'No PDF: alternar entre Sumário e Miniaturas no painel esquerdo' },
    { teclas: [']'], descricao: 'Painel do documento (Info, Caderno, Estudo, Conversas)' },
    { teclas: ['Shift', 'J'], descricao: 'Ir para a página (PDF) ou o capítulo' },
    { teclas: ['Shift', 'Ctrl', 'S'], descricao: 'Selecionar uma área da página (PDF)' },
    { teclas: ['M'], descricao: 'Recolher as notas em números na margem, ou abri-las' },
    { teclas: ['Ctrl', 'K'], descricao: 'Paleta de comandos (⌘ K no Mac)' },
    { teclas: ['?'], descricao: 'Esta lista' },
  ] },
  { titulo: 'Leitura', atalhos: [
    { teclas: ['Ctrl', '+'], descricao: 'Aumentar o zoom do PDF (também Ctrl + roda do mouse)' },
    { teclas: ['Ctrl', '−'], descricao: 'Diminuir o zoom do PDF' },
    { teclas: ['Ctrl', '0'], descricao: 'Ajustar PDF à largura' },
  ] },
  { titulo: 'Percorrer grifos e relações (com o player aberto)', atalhos: [
    { teclas: ['←', '→'], descricao: 'Destaque anterior ou seguinte, na ordem do texto' },
    { teclas: ['Esc'], descricao: 'Fechar o percorrer' },
  ] },
  { titulo: 'Leitura comentada e visita (com o player aberto)', atalhos: [
    { teclas: ['Espaço'], descricao: 'Tocar ou pausar' },
    { teclas: ['←', '→'], descricao: 'Frase (ou parada) anterior ou seguinte' },
    { teclas: ['Shift', '→'], descricao: 'Pular para o próximo capítulo' },
    { teclas: ['C'], descricao: 'Ligar ou desligar os comentários (leitura comentada)' },
    { teclas: ['Esc'], descricao: 'Sair' },
  ] },
  { titulo: 'Áudio e vídeo (com o player aberto)', atalhos: [
    { teclas: ['Espaço'], descricao: 'Tocar ou pausar (também K)' },
    { teclas: ['←', '→'], descricao: 'Voltar ou avançar 5 s (com Shift, 10 s)' },
    { teclas: ['J', 'L'], descricao: 'Voltar ou avançar 10 s' },
    { teclas: ['Clique'], descricao: 'Numa palavra do texto: tocar dali' },
  ] },
  { titulo: 'Resolução de exercício (com a resolução aberta)', atalhos: [
    { teclas: ['→', 'Espaço'], descricao: 'Próximo passo; depois a resposta e o próximo item' },
    { teclas: ['←'], descricao: 'Esconder o último passo' },
  ] },
];

/** Os blocos por onde o foco anda: os de texto corrido, sem títulos nem figuras. */
const NAVEGAVEIS = new Set<Bloco['tipo']>(['paragrafo', 'lista', 'citacao', 'codigo', 'equacao', 'nota_rodape', 'epigrafe', 'legenda', 'estrofe', 'tabela']);
export function blocosNavegaveis<B extends Pick<Bloco, 'id' | 'tipo' | 'texto'>>(blocos: readonly B[]): B[] {
  return blocos.filter((bloco) => NAVEGAVEIS.has(bloco.tipo) && bloco.texto.trim() !== '');
}

/** O vizinho na direção pedida; sem atual, o primeiro (ou o último, subindo). */
export function vizinho(ids: readonly Id[], atual: Id | null, direcao: 1 | -1): Id | null {
  if (ids.length === 0) return null;
  const indice = atual === null ? -1 : ids.indexOf(atual);
  if (indice === -1) return direcao === 1 ? ids[0]! : ids[ids.length - 1]!;
  return ids[indice + direcao] ?? null;
}

/** A tecla veio de um campo de texto (ou de um editor): os atalhos de uma letra não valem ali. */
export function digitando(alvo: EventTarget | null): boolean {
  return alvo instanceof Element && alvo.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"]') !== null;
}

/**
 * WCAG 2.1.4: com "Atalhos de uma tecla" desligado (Aparência), a tecla que só escreve um caractere
 * (letra, número, pontuação) não dispara nada. Seguem valendo Espaço, Esc, as setas e o que leva
 * Ctrl, ⌘ ou Alt (a paleta continua em Ctrl K). A preferência chega pelo `data-atalhos` da raiz.
 */
export function atalhoDeUmaTeclaDesligado(evento: KeyboardEvent): boolean {
  return document.documentElement.dataset['atalhos'] === 'desligados' && evento.key.length === 1 && evento.key !== ' '
    && !evento.ctrlKey && !evento.metaKey && !evento.altKey;
}
