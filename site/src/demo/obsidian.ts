/**
 * A entrada da exportação para o Obsidian feita do mesmo recorte do herói (`recorte.ts`): os blocos
 * viram `Bloco`s de um texto, as marcas viram `MarcaV2` (modo filosófico, saliência, comentário de
 * leitura) e a pergunta presa à objeção vira uma `ConversaV2`. A nota que a página mostra é a saída
 * de `exportarParaObsidian` (`servico/src/obsidian/exportar.ts`), a mesma função que o app usa no
 * "Enviar para o Obsidian" e no plugin. As relações do herói são as da compreensão do capítulo, que
 * a exportação não leva (ela leva as conexões que a pessoa aceitou), e por isso não aparecem na nota.
 */
import type { AncoraV1, Bloco, ConversaV2, MarcaV2, Secao } from '@margem/contratos';
import { exportarParaObsidian, type EntradaDaExportacao, type NotaDoObsidian } from '@obsidian/exportar';
import { FUNCOES_FILOSOFICAS } from '../app/marcador';
import { BLOCOS, DOCUMENTO, MARCAS, PERGUNTA, TITULO, type Ancora } from './recorte';

/** Ids no formato ULID do serviço (26 caracteres, Crockford), fixos para a nota sair sempre igual. */
const IDS: Record<string, string> = {
  D1: '01K7E4Q8ZV3M9T2RB6XN5HJC1D', V1: '01K7E4Q91K2W7PHD3Y0S8FMB4A', S1: '01K7E4Q93GJ5NV1CZ6T0RXW8KE',
  C1: '01K7E4QA0B8DM2F7VQ4YHN6S3P', Q1: '01K7E4R2E5XK9W1TB7C3MZ0QNV', X1: '01K7E4R2E7H3P5DA9SYG1FQ2TB', X2: '01K7E4R3K0V6N8RC2JW4XD7HMA',
};
const id = (prefixo: string, numero: number): string => IDS[`${prefixo}${String(numero)}`] ?? '';
const VERSAO = id('V', 1);
const QUANDO = '2026-10-13T12:00:00.000Z';

const blocos: Bloco[] = BLOCOS.map((b, ordem) => ({
  id: b.id, ordem, tipo: 'paragrafo', texto: b.texto, inline: [], origens: [{ tipo: 'texto', linha_inicio: ordem * 2 + 1, linha_fim: ordem * 2 + 1 }],
}));
const secoes: Secao[] = [{ id: id('S', 1), nivel: 1, titulo: DOCUMENTO, ordem: 0, bloco_inicio: BLOCOS[0]!.id, bloco_fim: BLOCOS.at(-1)!.id }];

function ancora(a: Ancora): AncoraV1 {
  const texto = BLOCOS.find((b) => b.id === a.bloco_id)?.texto ?? '';
  return { ...a, versao_id: VERSAO, prefixo: texto.slice(Math.max(0, a.inicio_utf16 - 32), a.inicio_utf16), sufixo: texto.slice(a.fim_utf16, a.fim_utf16 + 32) };
}

const marcas: MarcaV2[] = MARCAS.map((m) => ({
  id: m.id, ancora: ancora(m.ancora), funcao: m.funcao, saliencia: m.saliencia, subfaixas: [],
  comentario: { tipo: 'LEITURA', rotulo: '', texto: m.comentario.texto },
  origem: 'parte', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada', camada_id: id('C', 1),
  modo: { id: 'filosofica', revisao: 1 }, criada_em: QUANDO,
}));

const objecao = marcas.find((m) => m.id === PERGUNTA.marca)!;
const conversas: ConversaV2[] = [{
  versao: 2, id: id('Q', 1), versao_id: VERSAO, ancora: objecao.ancora, marca_id: objecao.id, estado: 'aberta', criada_em: QUANDO,
  mensagens: [
    { id: id('X', 1), autor: 'leitor', texto: PERGUNTA.pergunta, criada_em: QUANDO },
    { id: id('X', 2), autor: 'ia', texto: PERGUNTA.resposta, citacoes: [objecao.ancora], criada_em: '2026-10-13T12:00:20.000Z' },
  ],
}];

export const ENTRADA: EntradaDaExportacao = {
  documento: { id: id('D', 1), titulo: `${TITULO}: ${DOCUMENTO}`, autor: 'Machado de Assis', formato: 'txt', criado_em: QUANDO, fonte_url: null },
  versao_id: VERSAO, secoes, blocos, marcas, anotacoes: [], conversas, conexoes: [], etiquetas: [],
  rotulos: Object.fromEntries(Object.entries(FUNCOES_FILOSOFICAS).map(([chave, f]) => [`filosofica@1:${chave}`, f.rotulo])),
  destinos: {},
  // O app de desktop serve em localhost:8730; é esse o endereço dos links "abrir no Margem".
  url_base: 'http://localhost:8730',
};

export const NOTA: NotaDoObsidian = exportarParaObsidian(ENTRADA);
