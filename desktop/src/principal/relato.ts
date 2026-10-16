/**
 * Ajuda → "Relatar um problema…" e "Copiar informações do app" (U-12): um resumo curto do app para quem
 * vai ajudar (versão, sistema, arquitetura e o estado dos componentes), sem nada pessoal. Nunca entram o
 * conteúdo dos livros, caminhos de pastas, credenciais nem trechos dos registros: só palavras fixas.
 *
 * Funções puras (os testes rodam sem Electron); main.ts junta os dados e abre o link ou copia.
 */
export const LINK_DOS_RELATOS = 'https://github.com/pedropasinn/margem/issues/new';

export type SituacaoDoComponente = 'embutido' | 'do sistema' | 'ausente';

export interface DadosDoRelato {
  versao: string;
  sistema: NodeJS.Platform;
  /** Versão do sistema operacional (`process.getSystemVersion()`), ex.: "10.0.22631" ou "14.5". */
  versaoDoSistema: string;
  arquitetura: string;
  electron: string;
  empacotado: boolean;
  componentes: Readonly<Record<string, SituacaoDoComponente>>;
  servico: 'no ar' | 'abrindo' | 'parado';
  chatgpt: 'conectado' | 'não conectado' | 'não verificado' | 'sem o Codex';
  /** A biblioteca está numa pasta sincronizada (o banco fica na pasta local do app). `null`: sem biblioteca. */
  bibliotecaSincronizada: boolean | null;
}

const NOME_DO_SISTEMA: Partial<Record<NodeJS.Platform, string>> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

/** Só o que é seguro mostrar: troca qualquer coisa que não seja versão/identificador curto. */
function seguro(texto: string): string {
  const limpo = texto.trim();
  return /^[\w.+-]{1,40}$/u.test(limpo) ? limpo : '?';
}

export function situacaoDoComponente(recurso: { origem: string } | null): SituacaoDoComponente {
  if (recurso === null) return 'ausente';
  return recurso.origem === 'embutido' ? 'embutido' : 'do sistema';
}

/** O resumo em texto, uma informação por linha. */
export function resumoDoApp(dados: DadosDoRelato): string {
  const componentes = Object.entries(dados.componentes).map(([nome, situacao]) => `${seguro(nome)} ${situacao}`).join(', ');
  return [
    `Margem ${seguro(dados.versao)}${dados.empacotado ? '' : ' (desenvolvimento)'}`,
    `Sistema: ${NOME_DO_SISTEMA[dados.sistema] ?? seguro(dados.sistema)} ${seguro(dados.versaoDoSistema)} (${seguro(dados.arquitetura)})`,
    `Electron: ${seguro(dados.electron)}`,
    `Serviço: ${dados.servico}`,
    `ChatGPT: ${dados.chatgpt}`,
    ...(dados.bibliotecaSincronizada === null ? ['Biblioteca: nenhuma'] : [`Biblioteca: ${dados.bibliotecaSincronizada ? 'em pasta sincronizada' : 'em pasta local'}`]),
    `Componentes: ${componentes}`,
  ].join('\n');
}

/** O endereço da página de novo relato, com título e corpo pré-preenchidos. */
export function linkDoRelato(dados: DadosDoRelato): string {
  const corpo = [
    '## O que aconteceu', '', '', '## O que você esperava', '', '', '## Como repetir', '', '',
    '## Informações do app', '', '```', resumoDoApp(dados), '```', '',
    'Não cole aqui trechos de livros, notas nem a pasta de registros inteira. Se pedirem um registro, mande só o trecho do erro.',
  ].join('\n');
  const parametros = new URLSearchParams({ title: `Problema no Margem ${seguro(dados.versao)}: `, body: corpo });
  return `${LINK_DOS_RELATOS}?${parametros.toString()}`;
}
