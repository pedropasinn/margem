/**
 * Script injetado sob demanda na aba (permissão `activeTab` + `scripting`). Só registra as
 * funções de extração; quem as chama é o fundo, com `scripting.executeScript`.
 */
import { extrairPagina, extrairSelecao } from './extracao/extrair';

declare global {
  // Nome único para não colidir com nada da página (o script roda no mundo isolado).
  var __margemExtrator: { pagina: typeof extrairPagina; selecao: typeof extrairSelecao } | undefined;
}

globalThis.__margemExtrator = { pagina: extrairPagina, selecao: extrairSelecao };
