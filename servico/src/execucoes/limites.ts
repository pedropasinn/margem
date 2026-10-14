/**
 * Os limites que a canonização declara (`CanonicoV1.limites`, "tipo: descrição" do motor), resumidos
 * para quem lê (V-T4). Separa o esperado, que é só informação (uma equação vira texto e a página original
 * continua à vista; uma página repetida é pulada), do que de fato se perdeu (uma estrofe lida como prosa,
 * imagens do EPUB fora, trechos sem posição no PDF). Só o que se perdeu vira aviso, agrupado por tipo e
 * com uma frase humana; o texto técnico continua no Diagnóstico, recolhido.
 */

export type NivelDoLimite = 'info' | 'aviso';
export interface ResumoDoLimite {
  nivel: NivelDoLimite;
  /** Código estável do grupo (snake_case), para o aviso do job e os testes. */
  codigo: string;
  mensagem: string;
  /** Quantos limites do motor o grupo junta. */
  quantidade: number;
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios.replace('#', String(n)));

/** O que o motor chama de cada conteúdo não textual, no singular e no plural. */
const CONTEUDOS: Readonly<Record<string, readonly [string, string]>> = {
  equacao: ['equação', 'equações'], tabela: ['tabela', 'tabelas'], figura: ['figura', 'figuras'],
};

function paginasDe(descricoes: readonly string[]): number[] {
  const paginas = new Set<number>();
  for (const descricao of descricoes) {
    const achado = /p[áa]gina PDF (\d+)/iu.exec(descricao);
    if (achado) paginas.add(Number(achado[1]));
  }
  return [...paginas].sort((a, b) => a - b);
}

function emPaginas(paginas: readonly number[]): string {
  if (paginas.length === 0) return '';
  if (paginas.length === 1) return ` na página ${String(paginas[0])}`;
  if (paginas.length <= 4) return ` nas páginas ${paginas.slice(0, -1).join(', ')} e ${String(paginas.at(-1))}`;
  return ` em ${String(paginas.length)} páginas`;
}

interface Regra { nivel: NivelDoLimite; codigo: string; frase: (descricoes: readonly string[]) => string }

/**
 * Cada tipo de limite do motor (`motor/margem_motor`): o nível e a frase. `sem_texto` fica de fora do
 * aviso: a página do documento já tem a linha própria ("N páginas sem texto — transcrever").
 */
const REGRAS: Readonly<Record<string, Regra>> = {
  // Esperados: nada se perdeu.
  pagina_repetida: { nivel: 'info', codigo: 'paginas_repetidas', frase: (d) => plural(d.length, 'Uma página repetida no arquivo foi pulada.', '# páginas repetidas no arquivo foram puladas.') },
  pagina_em_branco_declarada: { nivel: 'info', codigo: 'paginas_em_branco', frase: (d) => plural(d.length, 'Um aviso de “página em branco” ficou fora do texto.', '# avisos de “página em branco” ficaram fora do texto.') },
  frontmatter: { nivel: 'info', codigo: 'metadados', frase: () => 'Os metadados no começo do arquivo ficaram fora do texto.' },
  apresentacao_epub: { nivel: 'info', codigo: 'estilo_do_epub', frase: () => 'O EPUB é lido como texto corrido, sem o estilo visual original.' },
  navegacao_epub: { nivel: 'info', codigo: 'sumario_do_epub', frase: () => 'O sumário do EPUB ficou fora do texto; o índice do Margem o substitui.' },
  recuo_codigo_inferido: { nivel: 'info', codigo: 'recuo_do_codigo', frase: (d) => plural(d.length, 'O recuo de um trecho de código foi deduzido do PDF.', 'O recuo de # trechos de código foi deduzido do PDF.') },
  sem_texto: { nivel: 'info', codigo: 'paginas_sem_texto', frase: (d) => plural(d.length, 'Uma página não tem texto (escaneada).', '# páginas não têm texto (escaneadas).') },
  // Perdas de verdade.
  geometria_nao_alinhada: { nivel: 'aviso', codigo: 'texto_sem_posicao', frase: (d) => plural(d.length, 'Num trecho, as marcas podem ficar um pouco fora do lugar no PDF.', 'Em # trechos, as marcas podem ficar um pouco fora do lugar no PDF.') },
  estrofe_recusada: { nivel: 'aviso', codigo: 'versos_como_prosa', frase: (d) => plural(d.length, 'Uma estrofe não pôde ser lida como verso e ficou como prosa.', '# estrofes não puderam ser lidas como verso e ficaram como prosa.') },
  recuo_de_verso: { nivel: 'aviso', codigo: 'recuo_dos_versos', frase: (d) => plural(d.length, 'O recuo de uma estrofe não foi reproduzido.', 'O recuo de # estrofes não foi reproduzido.') },
  imagens_epub: { nivel: 'aviso', codigo: 'imagens_omitidas', frase: (d) => plural(d.length, 'Uma imagem do EPUB ficou de fora.', 'Imagens do EPUB ficaram de fora (# pontos do livro).') },
  recuo_codigo_nao_resolvido: { nivel: 'aviso', codigo: 'codigo_incerto', frase: (d) => plural(d.length, 'Um trecho de código pode ter perdido o recuo.', '# trechos de código podem ter perdido o recuo.') },
  codigo_separado_por_intervalo: { nivel: 'aviso', codigo: 'codigo_incerto', frase: (d) => plural(d.length, 'Um trecho de código pode ter sido partido em dois.', '# trechos de código podem ter sido partidos.') },
  sumario_destino_nao_resolvido: { nivel: 'aviso', codigo: 'sumario_incompleto', frase: (d) => plural(d.length, 'Uma entrada do sumário do PDF não aponta para uma página.', '# entradas do sumário do PDF não apontam para uma página.') },
  ligatura_em_ancora_legada: { nivel: 'aviso', codigo: 'marcas_antigas', frase: (d) => plural(d.length, 'Uma marca antiga pode ter mudado de lugar.', '# marcas antigas podem ter mudado de lugar.') },
};

/** Separa "tipo: descrição"; o que não segue o formato fica como tipo desconhecido. */
function separar(limite: string): { tipo: string; descricao: string } {
  const achado = /^([a-z][a-z0-9_]*):\s*(.*)$/su.exec(limite);
  return achado ? { tipo: achado[1]!, descricao: achado[2]! } : { tipo: '', descricao: limite };
}

/** Os limites resumidos: primeiro os avisos (o que se perdeu), depois as informações, cada grupo uma vez. */
export function resumirLimites(limites: readonly string[]): ResumoDoLimite[] {
  const grupos = new Map<string, { regra: Regra; descricoes: string[] }>();
  const desconhecidos: string[] = [];
  const naoTextuais = new Map<string, string[]>();
  for (const limite of limites) {
    const { tipo, descricao } = separar(limite);
    if (tipo === 'conteudo_nao_textual') {
      // "Equacao na página PDF 1: texto linearizado…": o texto fica e a página inteira vira imagem.
      const conteudo = (descricao.split(/\s/u)[0] ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      const lista = naoTextuais.get(conteudo) ?? [];
      lista.push(descricao);
      naoTextuais.set(conteudo, lista);
      continue;
    }
    const regra = REGRAS[tipo];
    if (!regra) { desconhecidos.push(limite); continue; }
    const chave = `${regra.codigo}:${tipo}`;
    const grupo = grupos.get(chave) ?? { regra, descricoes: [] };
    grupo.descricoes.push(descricao);
    grupos.set(chave, grupo);
  }
  const resumo: ResumoDoLimite[] = [];
  for (const [conteudo, descricoes] of naoTextuais) {
    const [um, varios] = CONTEUDOS[conteudo] ?? ['conteúdo visual', 'conteúdos visuais'];
    const quantos = descricoes.length === 1 ? `Uma ${um}` : `${String(descricoes.length)} ${varios}`;
    resumo.push({
      nivel: 'info', codigo: 'conteudo_visual', quantidade: descricoes.length,
      mensagem: `${quantos}${emPaginas(paginasDe(descricoes))}: o texto fica para busca e marcas, e o original continua à vista.`,
    });
  }
  for (const { regra, descricoes } of grupos.values()) {
    resumo.push({ nivel: regra.nivel, codigo: regra.codigo, quantidade: descricoes.length, mensagem: regra.frase(descricoes) });
  }
  if (desconhecidos.length > 0) {
    resumo.push({
      nivel: 'aviso', codigo: 'limite_da_canonizacao', quantidade: desconhecidos.length,
      mensagem: plural(desconhecidos.length, 'Um trecho pode não ter sido preparado por inteiro; confira o original.', '# trechos podem não ter sido preparados por inteiro; confira o original.'),
    });
  }
  return [...resumo.filter((item) => item.nivel === 'aviso'), ...resumo.filter((item) => item.nivel === 'info')];
}

/** Só o que se perdeu: os avisos que a página do documento mostra no topo. */
export function avisosDosLimites(limites: readonly string[]): ResumoDoLimite[] {
  return resumirLimites(limites).filter((item) => item.nivel === 'aviso');
}
