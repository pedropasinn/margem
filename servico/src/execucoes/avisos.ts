/**
 * Avisos de um job concluído, para quem lê: os diagnósticos de nível `aviso` (e `erro`) da tentativa
 * vencedora viram frases curtas em português, agrupadas por código. Os de nível `info` ficam de fora
 * (são registro técnico). Nunca o texto cru do executor: só quando o código não é conhecido, e então
 * cortado.
 *
 * Usado pela lista das execuções (`ExecucoesDoCodexV2.execucoes[].avisos`) e pela página do
 * documento (`JobResumido.avisos`).
 */
import type { AvisoDaExecucaoV2, JobResultV1 } from '@margem/contratos';
import { avisosDosLimites } from './limites.js';

type Diagnostico = JobResultV1['diagnosticos'][number];

/** No máximo quantos avisos por execução (o contrato aceita até 5). */
export const MAXIMO_DE_AVISOS = 5;
const LIMITE_DA_MENSAGEM = 200;

/** Tipos de job cujos códigos desconhecidos são motivos de marca recusada (ancoragem, função…). */
const TIPOS_QUE_MARCAM = new Set(['ler_parte', 'analisar_passagens', 'revisar_consistencia']);

/** O código dos limites declarados pela canonização (`worker/canonizar.ts`). */
const CODIGO_DO_LIMITE = 'limite_da_canonizacao';

/** Códigos que não dizem nada a quem lê (proveniência do modelo, por exemplo): não viram aviso. */
const SILENCIOSOS = new Set(['proveniencia_divergente', 'revisao_v2_indisponivel']);

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios.replace('#', String(n)));

/** Frase de cada código conhecido, dada a contagem e a primeira mensagem do grupo. */
const FRASES: Readonly<Record<string, (n: number) => string>> = {
  leitura_parcial: () => 'O Codex leu só parte deste trecho; pode faltar alguma marca.',
  alinhamento_aproximado: () => 'A narração ficou com o tempo aproximado em alguns trechos.',
  narracao: (n) => plural(n, 'Um trecho da narração saiu com ressalvas.', '# trechos da narração saíram com ressalvas.'),
  citacao_recusada: (n) => plural(n, 'Uma citação da resposta não conferiu com o texto e foi retirada.', '# citações da resposta não conferiram com o texto e foram retiradas.'),
  sugestao_recusada: (n) => plural(n, 'Uma relação sugerida veio fora do formato e foi descartada.', '# relações sugeridas vieram fora do formato e foram descartadas.'),
  nota_sem_mudanca: () => 'O Codex devolveu a nota como estava.',
  recorte_pouco_legivel: () => 'O recorte do exercício está pouco legível; a resolução pode ter erros.',
  lote_recusado: () => 'A revisão das marcas foi recusada e nada mudou.',
  // J142: a transcrição passada a limpo.
  paragrafo_sem_limpeza: (n) => plural(n, 'Um parágrafo da transcrição ficou como estava.', '# parágrafos da transcrição ficaram como estavam.'),
  versao_com_anotacoes: () => 'A transcrição já tinha grifos ou notas, então ficou como estava; a análise seguiu sobre ela.',
};

function cortar(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= LIMITE_DA_MENSAGEM ? limpo : `${limpo.slice(0, LIMITE_DA_MENSAGEM - 1).trimEnd()}…`;
}

/** Código no formato do contrato (snake_case minúsculo); o que não couber vira `aviso`. */
function codigoSeguro(codigo: string): string {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(codigo) && codigo.length <= 60 ? codigo : 'aviso';
}

export function resumirAvisos(tipoDoJob: string, diagnosticos: readonly Diagnostico[] | null | undefined): AvisoDaExecucaoV2[] {
  const grupos = new Map<string, Diagnostico[]>();
  let marcasRecusadas = 0;
  // Limites da canonização (V-T4): o esperado (equação que vira texto, página repetida…) não é aviso; o
  // que se perdeu vira uma frase por tipo. Vale também para os jobs gravados antes desta regra.
  const limites: string[] = [];
  for (const diagnostico of diagnosticos ?? []) {
    if (diagnostico.nivel === 'info' || SILENCIOSOS.has(diagnostico.codigo)) continue;
    if (diagnostico.codigo === CODIGO_DO_LIMITE) { limites.push(diagnostico.mensagem); continue; }
    if (FRASES[diagnostico.codigo] === undefined && TIPOS_QUE_MARCAM.has(tipoDoJob)) { marcasRecusadas++; continue; }
    const grupo = grupos.get(diagnostico.codigo) ?? [];
    grupo.push(diagnostico);
    grupos.set(diagnostico.codigo, grupo);
  }
  const avisos: AvisoDaExecucaoV2[] = avisosDosLimites(limites).map((item) => ({ codigo: codigoSeguro(item.codigo), mensagem: item.mensagem }));
  for (const [codigo, grupo] of grupos) {
    const frase = FRASES[codigo];
    const primeira = grupo[0]?.mensagem ?? '';
    const mensagem = frase ? frase(grupo.length)
      : grupo.length === 1 ? cortar(primeira) || 'O Codex terminou com uma ressalva.'
        : cortar(`${String(grupo.length)} ressalvas, como: ${primeira}`);
    avisos.push({ codigo: codigoSeguro(codigo), mensagem });
  }
  if (marcasRecusadas > 0) {
    avisos.push({ codigo: 'marcas_recusadas', mensagem: plural(marcasRecusadas,
      'Uma marca ficou de fora porque não deu para ancorá-la no texto.',
      '# marcas ficaram de fora porque não deu para ancorá-las no texto.') });
  }
  return avisos.slice(0, MAXIMO_DE_AVISOS);
}

/** A frase que resume os avisos numa linha (a `mensagem` da execução concluída com avisos). */
export function mensagemDosAvisos(avisos: readonly AvisoDaExecucaoV2[]): string | null {
  if (avisos.length === 0) return null;
  if (avisos.length === 1) return avisos[0]?.mensagem ?? null;
  return cortar(`${avisos[0]?.mensagem ?? ''} (e mais ${String(avisos.length - 1)} ${avisos.length === 2 ? 'aviso' : 'avisos'})`);
}
