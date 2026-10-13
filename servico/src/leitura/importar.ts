import { conferirOrcamento, ORCAMENTOS } from '../entrada-json.js';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { ulid } from 'ulid';
import type {
  Bloco, CanonicoV1, Comentario, ExecucaoLeituraV1, Funcao, Id, MarcaGeradaV1, MarcaV1, MarcasLegadoV1, ParteV1,
} from '@margem/contratos';
import { hashEstrutural, validarCanonico, validarMarcaGerada } from '@margem/contratos';
import { deMarcasLegado, paragrafosDe, resolverCitacao, resolverSubfaixas, type MapaDePaginas, type BlocoDeVersao } from '@margem/core';
import { comTransacao, type Transacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import * as execucoes from '../repos/execucoes.js';
import * as marcasRepo from '../repos/marcas.js';
import * as partesRepo from '../repos/partes.js';
import { sha256 } from '../executor/artefato.js';

/** Versão do adaptador; entra em `execucao_leitura.metodo_versao`. */
export const METODO_LEGADO = 'legado-mixtape-2026-09-20';
export const METODO_HORARIUM = 'legado-horarium-2026-09-20';

export interface OpcoesDaImportacao {
  novoId?: () => Id;
  agora?: () => Date;
  /**
   * Segunda passada para citações que só não casam por tipografia do extrator antigo
   * (ligaturas). A citação gravada é sempre a literal do canônico, nunca a do legado.
   */
  reconciliarTipografia?: boolean;
}

// ---------------------------------------------------------------- reconciliação tipográfica

/**
 * Ligaturas que o extrator legado desfez e o motor novo preserva. Não é normalização
 * Unicode do texto: o canônico permanece intacto e só a *busca* da citação antiga é
 * tolerante. A marca gravada aponta para o texto literal do bloco.
 */
const LIGATURAS: ReadonlyMap<string, string> = new Map([
  ['ﬀ', 'ff'], ['ﬁ', 'fi'], ['ﬂ', 'fl'], ['ﬃ', 'ffi'], ['ﬄ', 'ffl'],
  ['ﬅ', 'st'], ['ﬆ', 'st'],
]);

interface Dobra {
  texto: string;
  /** Índice na dobra → índice no original; tem um elemento a mais, para o limite final. */
  posicoes: number[];
}

export function dobrarLigaturas(texto: string): Dobra {
  let saida = '';
  const posicoes: number[] = [];
  for (let i = 0; i < texto.length; i++) {
    const caractere = texto[i] ?? '';
    const substituto = LIGATURAS.get(caractere) ?? caractere;
    saida += substituto;
    for (let k = 0; k < substituto.length; k++) posicoes.push(i);
  }
  posicoes.push(texto.length);
  return { texto: saida, posicoes };
}

interface Reconciliacao {
  bloco: Bloco;
  inicio: number;
  fim: number;
  citacao: string;
}

/** Ocorrência única da citação legada no canônico, tolerando só as ligaturas. */
function reconciliar(canonico: CanonicoV1, citacao: string): Reconciliacao | undefined {
  const alvo = dobrarLigaturas(citacao).texto;
  // Citação vazia casaria em toda posição (e `indexOf('', fim)` nunca devolve -1: laço infinito).
  if (alvo === '') return undefined;
  const achados: Reconciliacao[] = [];
  for (const bloco of canonico.blocos) {
    const dobra = dobrarLigaturas(bloco.texto);
    for (let at = dobra.texto.indexOf(alvo); at !== -1; at = dobra.texto.indexOf(alvo, at + 1)) {
      const inicio = dobra.posicoes[at];
      const fim = dobra.posicoes[at + alvo.length];
      if (inicio === undefined || fim === undefined) continue;
      // A ocorrência começa ou termina no meio de uma ligatura expandida (`af` em `aﬁ`): o recorte
      // do original não reproduziria a citação, então não é ocorrência.
      if (dobra.posicoes[at - 1] === inicio || dobra.posicoes[at + alvo.length - 1] === fim) continue;
      achados.push({ bloco, inicio, fim, citacao: bloco.texto.slice(inicio, fim) });
    }
  }
  return achados.length === 1 ? achados[0] : undefined;
}

function termosReconciliados(citacao: string, termos: readonly string[]): string[] {
  const dobra = dobrarLigaturas(citacao);
  const resolvidos: string[] = [];
  for (const termo of termos) {
    if (citacao.includes(termo) && citacao.indexOf(termo) === citacao.lastIndexOf(termo)) { resolvidos.push(termo); continue; }
    const alvo = dobrarLigaturas(termo).texto;
    const at = dobra.texto.indexOf(alvo);
    if (at === -1 || dobra.texto.indexOf(alvo, at + 1) !== -1) continue;
    const inicio = dobra.posicoes[at];
    const fim = dobra.posicoes[at + alvo.length];
    if (inicio === undefined || fim === undefined) continue;
    resolvidos.push(citacao.slice(inicio, fim));
  }
  return resolvidos;
}

// ---------------------------------------------------------------- marcas legadas do Mixtape

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

/** O arquivo real traz a chave `revisao` (topo e por marca), fora do contrato congelado. */
export function limparRevisaoDoLegado(valor: unknown): MarcasLegadoV1 {
  conferirOrcamento(valor, ORCAMENTOS.canonico);
  if (!valor || typeof valor !== 'object') throw new Error('Importação precisa ser um objeto JSON.');
  const bruto = valor as Record<string, unknown>;
  const marcas = Array.isArray(bruto.marcas) ? bruto.marcas : [];
  return {
    capitulo: texto(bruto.capitulo),
    leitura_integral: bruto.leitura_integral === true,
    limites: Array.isArray(bruto.limites) ? bruto.limites.map(texto) : [],
    marcas: marcas.map((item) => {
      const marca = item as Record<string, unknown>;
      return {
        id: texto(marca.id),
        pagina_pdf: Number(marca.pagina_pdf),
        funcao: marca.funcao as Funcao,
        citacao: texto(marca.citacao),
        sublinhar: Array.isArray(marca.sublinhar) ? marca.sublinhar.map(texto) : [],
        comentario: (marca.comentario ?? null) as Comentario | null,
      };
    }),
    recuperacao: Array.isArray(bruto.recuperacao)
      ? bruto.recuperacao.map((item) => {
        const registro = item as Record<string, unknown>;
        return {
          pagina_pdf: Number(registro.pagina_pdf),
          secao: texto(registro.secao),
          perguntas: Array.isArray(registro.perguntas) ? registro.perguntas.map(texto) : [],
        };
      })
      : [],
  };
}

export interface ContagemDaImportacao {
  total: number;
  /** Casaram literalmente com o texto do canônico. */
  resolvidas: number;
  /** Casaram só depois de desfazer ligaturas; a citação gravada é a do canônico. */
  reconciliadas: number;
  ambiguas: number;
  orfas: number;
  invalidas: number;
  /** Marcas gravadas sem algum termo de `sublinhar`. */
  sublinhar_parcial: number;
  /** Descartadas por sobrepor uma marca colorida já gravada. */
  sobrepostas: number;
  gravadas: number;
}

export interface RelatorioDaImportacao {
  execucao: ExecucaoLeituraV1;
  contagem: ContagemDaImportacao;
  nao_resolvidas: { id: string; motivo: string }[];
  /** Recuperação do legado: não há tabela para ela na migração 0001. */
  recuperacao: MarcasLegadoV1['recuperacao'];
  perdas: string[];
}

const PERDAS_DO_LEGADO = [
  'pagina_pdf: a página só desempata a busca; a posição persistida é o offset UTF-16 no bloco.',
  'id legado (m01…): substituído por ULID do serviço; a correspondência fica neste relatório.',
  'recuperacao: sem tabela na migração 0001; devolvida no relatório e gravada junto ao artefato do job.',
  'limites e leitura_integral do capítulo: preservados apenas no relatório.',
  'revisao: a chave extra do arquivo revisado não pertence ao contrato e é descartada antes da validação.',
];

export async function criarExecucaoDeImportacao(
  cliente: Transacao, versaoId: Id, canonico: CanonicoV1, metodo: string, hashEntrada: string, opcoes: OpcoesDaImportacao,
): Promise<{ execucao: ExecucaoLeituraV1; parte: ParteV1 }> {
  const novoId = opcoes.novoId ?? ulid;
  const agora = opcoes.agora ?? (() => new Date());
  const execucaoId = novoId();
  const parteId = novoId();
  const responsaveis = canonico.blocos.filter((bloco) => bloco.texto !== '').map((bloco) => bloco.id);
  const parte: ParteV1 = {
    id: parteId, execucao_id: execucaoId, ordem: 0,
    blocos_responsaveis: responsaveis.length > 0 ? responsaveis : [canonico.blocos[0]?.id ?? ''],
    blocos_contexto: [], hash_entrada: hashEntrada,
  };
  const execucao: ExecucaoLeituraV1 = {
    id: execucaoId, versao_id: versaoId, metodo_versao: metodo, prompt_versao: metodo, schema_versao: 1,
    modelo: 'importacao', esforco: 'nenhum', tamanho_parte_tokens: 1, concorrencia: 1,
    plano_partes: [parteId], criada_em: agora().toISOString(),
  };
  await execucoes.criar(cliente, execucao);
  await partesRepo.criar(cliente, execucaoId, [parte]);
  return { execucao, parte };
}

function marcaPersistida(
  gerada: MarcaGeradaV1, canonico: CanonicoV1, versaoId: Id, execucaoId: Id, id: Id, criada_em: string,
): MarcaV1 | undefined {
  const bloco = canonico.blocos.find((item) => item.id === gerada.bloco_id);
  if (!bloco) return undefined;
  const blocoDeVersao: BlocoDeVersao = { id: bloco.id, texto: bloco.texto, versao_id: versaoId };
  const resolucao = resolverCitacao(blocoDeVersao, { citacao: gerada.citacao, prefixo: gerada.prefixo, sufixo: gerada.sufixo });
  if (!resolucao.ok) return undefined;
  const { subfaixas } = resolverSubfaixas(blocoDeVersao, resolucao.ancora, gerada.sublinhar);
  return {
    id, ancora: resolucao.ancora, funcao: gerada.funcao, subfaixas, comentario: gerada.comentario,
    origem: 'importacao', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada',
    execucao_id: execucaoId, criada_em,
  };
}

function descartarSobreposicoes(marcas: readonly MarcaV1[]): { mantidas: MarcaV1[]; descartadas: MarcaV1[] } {
  const mantidas: MarcaV1[] = [];
  const descartadas: MarcaV1[] = [];
  for (const marca of marcas) {
    if (marca.funcao === 'nenhuma') { mantidas.push(marca); continue; }
    const conflito = mantidas.some((outra) => outra.funcao !== 'nenhuma'
      && outra.ancora.bloco_id === marca.ancora.bloco_id
      && outra.ancora.inicio_utf16 < marca.ancora.fim_utf16 && marca.ancora.inicio_utf16 < outra.ancora.fim_utf16);
    if (conflito) descartadas.push(marca); else mantidas.push(marca);
  }
  return { mantidas, descartadas };
}

/**
 * Importa as marcas revisadas do Mixtape para uma versão já canonizada. Usa
 * `core.deMarcasLegado` na primeira passada e, opcionalmente, a reconciliação
 * tipográfica na segunda. Marcas não localizadas **não são gravadas**: `MarcaV1`
 * exige âncora com bloco existente, e a migração 0001 não tem onde guardar órfã.
 */
export async function importarMarcasLegado(
  banco: pg.Pool, versaoId: Id, bruto: unknown, mapaPaginas?: MapaDePaginas, opcoes: OpcoesDaImportacao = {},
): Promise<RelatorioDaImportacao> {
  const legado = limparRevisaoDoLegado(bruto);
  const novoId = opcoes.novoId ?? ulid;
  const criada_em = (opcoes.agora ?? (() => new Date()))().toISOString();
  return comTransacao(banco, async (cliente) => {
    const versao = await documentos.obterVersao(cliente, versaoId);
    const canonico = versao.canonico;
    const { execucao } = await criarExecucaoDeImportacao(
      cliente, versaoId, canonico, METODO_LEGADO, sha256(JSON.stringify(legado)), opcoes);

    const conversao = deMarcasLegado(canonico, legado, mapaPaginas);
    const parciais = new Set(conversao.nao_resolvidas.filter((item) => item.motivo === 'sublinhar_parcial').map((item) => item.id));
    const falhas = conversao.nao_resolvidas.filter((item) => item.motivo !== 'sublinhar_parcial');
    const porCitacao = new Map(legado.marcas.map((marca) => [marca.citacao, marca.id]));
    const geradas: { id: string; marca: MarcaGeradaV1; reconciliada: boolean }[] = conversao.marcas.map((marca) => ({
      id: porCitacao.get(marca.citacao) ?? marca.bloco_id, marca, reconciliada: false,
    }));

    const nao_resolvidas: { id: string; motivo: string }[] = [];
    let reconciliadas = 0;
    let ambiguas = 0;
    let orfas = 0;
    let invalidas = 0;
    for (const falha of falhas) {
      const legada = legado.marcas.find((marca) => marca.id === falha.id);
      const tentar = opcoes.reconciliarTipografia !== false && legada !== undefined && falha.motivo === 'ausente';
      const achado = tentar && legada ? reconciliar(canonico, legada.citacao) : undefined;
      if (!achado || !legada) {
        nao_resolvidas.push({ id: falha.id, motivo: falha.motivo });
        if (falha.motivo === 'ambigua') ambiguas += 1;
        else if (falha.motivo === 'invalida') invalidas += 1;
        else orfas += 1;
        continue;
      }
      const blocoDeVersao: BlocoDeVersao = { id: achado.bloco.id, texto: achado.bloco.texto, versao_id: versaoId };
      const contexto = resolverCitacao(blocoDeVersao, { citacao: achado.citacao });
      const marca: MarcaGeradaV1 = {
        bloco_id: achado.bloco.id,
        citacao: achado.citacao,
        prefixo: contexto.ok ? contexto.ancora.prefixo : achado.bloco.texto.slice(Math.max(0, achado.inicio - 32), achado.inicio),
        sufixo: contexto.ok ? contexto.ancora.sufixo : achado.bloco.texto.slice(achado.fim, achado.fim + 32),
        funcao: legada.funcao,
        sublinhar: termosReconciliados(achado.citacao, legada.sublinhar),
        comentario: legada.comentario,
      };
      if (!validarMarcaGerada(marca)) {
        nao_resolvidas.push({ id: falha.id, motivo: 'invalida_apos_reconciliacao' });
        invalidas += 1;
        continue;
      }
      if (marca.sublinhar.length !== legada.sublinhar.length) parciais.add(legada.id);
      geradas.push({ id: legada.id, marca, reconciliada: true });
      reconciliadas += 1;
    }

    const candidatas: MarcaV1[] = [];
    for (const item of geradas) {
      const marca = marcaPersistida(item.marca, canonico, versaoId, execucao.id, novoId(), criada_em);
      if (!marca) { nao_resolvidas.push({ id: item.id, motivo: 'ancora_nao_confere' }); orfas += 1; continue; }
      candidatas.push(marca);
    }
    const { mantidas, descartadas } = descartarSobreposicoes(candidatas);
    for (const descartada of descartadas) nao_resolvidas.push({ id: descartada.id, motivo: 'sobreposicao_editorial' });
    await marcasRepo.publicarMarcas(cliente, versaoId, mantidas);

    return {
      execucao,
      contagem: {
        total: legado.marcas.length,
        resolvidas: geradas.filter((item) => !item.reconciliada).length,
        reconciliadas,
        ambiguas, orfas, invalidas,
        sublinhar_parcial: parciais.size,
        sobrepostas: descartadas.length,
        gravadas: mantidas.length,
      },
      nao_resolvidas,
      recuperacao: legado.recuperacao,
      perdas: PERDAS_DO_LEGADO,
    };
  });
}

// ---------------------------------------------------------------- sessão do Horarium

export interface SessaoHorarium {
  versao: number;
  documento: {
    id: string; titulo: string; autor?: string | null; origem?: string | null; url?: string | null;
    rawText: string; sha256?: string; offsetEncoding?: string;
  };
  conexoes: {
    id: string; citacao: string; rotulo: string; relacao?: string; definicao?: string | null;
    conexao?: string | null; pergunta?: string; prefixo?: string; sufixo?: string;
  }[];
}

const FUNCAO_DO_ROTULO: ReadonlyMap<string, Funcao> = new Map([
  ['TESE', 'tese'], ['CONCEITO', 'conceito'], ['JUSTIFICATIVA', 'justificativa'], ['NOTA', 'nenhuma'],
]);

const PERDAS_DO_HORARIUM = [
  'relacao e conexao: a sessão liga a marca a uma nota do Zettelkasten; MarcaV1 não tem esse campo.',
  'notaHipotetica: título, corpo, tipo sugerido e fontes ficam fora do contrato de marca.',
  'pergunta: sem tabela de recuperação na migração 0001; devolvida no relatório.',
  'notaId e rejeitadas: identidade do acervo do Horarium, sem correspondente aqui.',
  'sublinhar: a sessão não registra sublinhados; toda marca importada entra sem subfaixas.',
  'estado.lido: o progresso de leitura tem contrato próprio (ProgressoV1) e não é importado.',
];

/** Canônico por parágrafos do `rawText`, formato `colado`, sem normalizar o texto. */
export function canonicoDaSessao(sessao: SessaoHorarium, opcoes: OpcoesDaImportacao & { idioma?: string } = {}): CanonicoV1 {
  const novoId = opcoes.novoId ?? ulid;
  conferirOrcamento(sessao, ORCAMENTOS.canonico);
  const rawText = sessao.documento.rawText;
  const linhaDe = (indice: number): number => (rawText.slice(0, indice).match(/\n/g)?.length ?? 0) + 1;
  const blocos: Bloco[] = paragrafosDe(rawText)
    .filter((paragrafo) => paragrafo.texto.trim() !== '')
    .map((paragrafo, ordem) => ({
      id: novoId(), ordem, tipo: 'paragrafo', texto: paragrafo.texto, inline: [],
      origens: [{ tipo: 'texto', linha_inicio: linhaDe(paragrafo.inicio), linha_fim: linhaDe(paragrafo.fim) }],
    }));
  const canonico: CanonicoV1 = {
    versao: 1,
    documento: {
      titulo: sessao.documento.titulo,
      ...(sessao.documento.autor ? { autor: sessao.documento.autor } : {}),
      idioma: opcoes.idioma ?? 'en',
      formato: 'colado',
      sha256_original: createHash('sha256').update(rawText, 'utf8').digest('hex'),
    },
    canonizacao: {
      motor: 'margem-importacao-horarium/1',
      gerado_em: (opcoes.agora ?? (() => new Date()))().toISOString(),
      config: { origem: 'sessao_horarium', documento_id: sessao.documento.id },
    },
    hash_estrutural: hashEstrutural(blocos),
    secoes: [],
    blocos,
    assets: [],
    limites: ['importacao: canônico derivado do rawText da sessão do Horarium, sem paginação nem estrutura de seções.'],
  };
  if (!validarCanonico(canonico)) throw new Error('Canônico derivado da sessão do Horarium é inválido.');
  return canonico;
}

export interface RelatorioDaSessao {
  documento_id: Id;
  versao_id: Id;
  execucao: ExecucaoLeituraV1;
  contagem: ContagemDaImportacao;
  nao_resolvidas: { id: string; motivo: string }[];
  perguntas: { marca: string; pergunta: string }[];
  perdas: string[];
  /** `true` quando o sha256 declarado pela sessão confere com o do `rawText`. */
  sha256_confere: boolean;
}

export async function importarSessaoHorarium(
  banco: pg.Pool, sessao: SessaoHorarium, opcoes: OpcoesDaImportacao & { idioma?: string; origem_caminho?: string } = {},
): Promise<RelatorioDaSessao> {
  const novoId = opcoes.novoId ?? ulid;
  const criada_em = (opcoes.agora ?? (() => new Date()))().toISOString();
  const canonico = canonicoDaSessao(sessao, opcoes);
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, {
      ...canonico.documento, origem_caminho: opcoes.origem_caminho ?? `horarium:${sessao.documento.id}`,
    });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const { execucao } = await criarExecucaoDeImportacao(
      cliente, versao.id, canonico, METODO_HORARIUM, sha256(sessao.documento.id), opcoes);

    const nao_resolvidas: { id: string; motivo: string }[] = [];
    const perguntas: { marca: string; pergunta: string }[] = [];
    const candidatas: MarcaV1[] = [];
    let ambiguas = 0;
    let orfas = 0;
    let invalidas = 0;
    for (const conexao of sessao.conexoes) {
      const funcao = FUNCAO_DO_ROTULO.get(conexao.rotulo);
      if (funcao === undefined) { nao_resolvidas.push({ id: conexao.id, motivo: 'rotulo_desconhecido' }); invalidas += 1; continue; }
      // Citação vazia (ou ausente) casaria em toda posição e o `indexOf` abaixo nunca terminaria.
      if (typeof conexao.citacao !== 'string' || conexao.citacao === '') {
        nao_resolvidas.push({ id: conexao.id, motivo: 'citacao_vazia' }); invalidas += 1; continue;
      }
      const achados = canonico.blocos.flatMap((bloco) => {
        const posicoes: { bloco: Bloco; inicio: number }[] = [];
        for (let at = bloco.texto.indexOf(conexao.citacao); at !== -1; at = bloco.texto.indexOf(conexao.citacao, at + 1)) {
          posicoes.push({ bloco, inicio: at });
        }
        return posicoes;
      });
      if (achados.length === 0) { nao_resolvidas.push({ id: conexao.id, motivo: 'ausente' }); orfas += 1; continue; }
      if (achados.length > 1) { nao_resolvidas.push({ id: conexao.id, motivo: 'ambigua' }); ambiguas += 1; continue; }
      const achado = achados[0];
      if (!achado) continue;
      const blocoDeVersao: BlocoDeVersao = { id: achado.bloco.id, texto: achado.bloco.texto, versao_id: versao.id };
      const resolucao = resolverCitacao(blocoDeVersao, { citacao: conexao.citacao });
      if (!resolucao.ok) { nao_resolvidas.push({ id: conexao.id, motivo: resolucao.motivo }); orfas += 1; continue; }
      const definicao = conexao.definicao?.trim();
      const comentario: Comentario | null = definicao
        ? { tipo: 'AUTOR', rotulo: `AUTOR · ${conexao.rotulo}`, texto: definicao }
        : null;
      candidatas.push({
        id: novoId(), ancora: resolucao.ancora, funcao, subfaixas: [], comentario,
        origem: 'importacao', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada',
        execucao_id: execucao.id, criada_em,
      });
      if (conexao.pergunta) perguntas.push({ marca: conexao.id, pergunta: conexao.pergunta });
    }
    const { mantidas, descartadas } = descartarSobreposicoes(candidatas);
    for (const descartada of descartadas) nao_resolvidas.push({ id: descartada.id, motivo: 'sobreposicao_editorial' });
    await marcasRepo.publicarMarcas(cliente, versao.id, mantidas);
    return {
      documento_id: documento.id,
      versao_id: versao.id,
      execucao,
      contagem: {
        total: sessao.conexoes.length,
        resolvidas: candidatas.length,
        reconciliadas: 0,
        ambiguas, orfas, invalidas,
        sublinhar_parcial: 0,
        sobrepostas: descartadas.length,
        gravadas: mantidas.length,
      },
      nao_resolvidas,
      perguntas,
      perdas: PERDAS_DO_HORARIUM,
      sha256_confere: sessao.documento.sha256 === canonico.documento.sha256_original,
    };
  });
}
