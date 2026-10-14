/**
 * "Baixar PDF anotado": cópia do original com anotações padrão PDF (Highlight e Text).
 *
 * O serviço escolhe as marcas e as notas e converte as âncoras em quads pela GeometriaV1
 * (`quadsDaAncora`, a mesma do leitor); o motor Python só desenha (`margem_motor.pdf_anotado`),
 * recebendo JSON. Marca ou nota sem geometria não ganha posição inventada: entra na contagem
 * `sem_geometria`, que a API devolve num cabeçalho.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { quadsDaAncora } from '@margem/core';
import type { AncoraV1, AnotacaoV1, GeometriaV1, MarcaV2, QuadPdf } from '@margem/contratos';
import { ambienteSaneado } from '../executor/ambiente.js';
import { comandoDoMotor } from '../plataforma/executaveis.js';
import { encerrarArvore, opcoesDeProcesso } from '../plataforma/processos.js';
import { modoOuNada } from '../modos.js';

export interface AnotacaoPdf {
  tipo: 'grifo' | 'nota';
  pagina: number;
  quads: QuadPdf[];
  cor: string;
  autor: string;
  assunto: string;
  texto: string;
}

export interface PedidoDoPdfAnotado {
  anotacoes: AnotacaoPdf[];
  /** Marcas exportadas (uma marca em duas páginas conta uma vez). */
  marcas: number;
  /** Notas que viraram texto de um grifo ou nota avulsa. */
  notas: number;
  /** Marcas e notas avulsas sem posição na geometria: ficam de fora. */
  sem_geometria: number;
}

const ROTULO_DA_NOTA: Record<AnotacaoV1['tipo'], string> = {
  impressao: 'Impressão', observacao: 'Observação', hipotese: 'Hipótese', duvida: 'Dúvida', fonte: 'Fonte', nota: 'Nota',
};
/** Função sem cor no modo (`nenhuma`) e notas avulsas. */
const COR_NEUTRA = '#A6A6A6';
const AUTOR = 'Margem';

/**
 * Padrão: só o que o leitor marcou (grifos `manual`) ou aceitou (`confirmada`). Com `incluirIa`,
 * também as marcas da IA da camada padrão. Rejeitadas, ocultas e não resolvidas nunca entram.
 */
export function marcasDoPdf(todas: readonly MarcaV2[], camadaPadrao: string | null, incluirIa: boolean): MarcaV2[] {
  return todas.filter((marca) => marca.visivel && marca.validade === 'resolvida' && marca.avaliacao !== 'rejeitada'
    && (marca.origem === 'manual' || marca.avaliacao === 'confirmada' || (incluirIa && marca.camada_id === camadaPadrao)));
}

function corDaMarca(marca: MarcaV2): string {
  return modoOuNada(marca.modo)?.funcoes.find((funcao) => funcao.chave === marca.funcao)?.cor.claro ?? COR_NEUTRA;
}
function rotuloDaFuncao(marca: MarcaV2): string {
  return modoOuNada(marca.modo)?.funcoes.find((funcao) => funcao.chave === marca.funcao)?.rotulo ?? 'Grifo';
}
const textoDaNota = (nota: AnotacaoV1): string => `${ROTULO_DA_NOTA[nota.tipo]}: ${nota.texto}`;

export function montarPedido(marcas: readonly MarcaV2[], notas: readonly AnotacaoV1[], geometria: GeometriaV1): PedidoDoPdfAnotado {
  const quads = (ancora: AncoraV1) => quadsDaAncora(ancora, geometria);
  const anotacoes: AnotacaoPdf[] = [];
  let semGeometria = 0;
  let exportadas = 0;
  let notasExportadas = 0;
  const exportaveis = new Set<string>();
  for (const marca of marcas) if (quads(marca.ancora).length > 0) exportaveis.add(marca.id);
  for (const marca of marcas) {
    const paginas = quads(marca.ancora);
    if (paginas.length === 0) { semGeometria += 1; continue; }
    const daMarca = notas.filter((nota) => nota.marca_id === marca.id);
    notasExportadas += daMarca.length;
    const assunto = rotuloDaFuncao(marca);
    const texto = [assunto, ...(marca.comentario ? [`${marca.comentario.rotulo}: ${marca.comentario.texto}`] : []), ...daMarca.map(textoDaNota)].join('\n\n');
    exportadas += 1;
    for (const { pagina, quads: dela } of paginas) {
      anotacoes.push({ tipo: 'grifo', pagina, quads: dela, cor: corDaMarca(marca), autor: AUTOR, assunto, texto });
    }
  }
  // Notas sem grifo exportado: nota avulsa no começo do trecho.
  for (const nota of notas) {
    if (nota.marca_id !== undefined && exportaveis.has(nota.marca_id)) continue;
    const primeira = quads(nota.ancora)[0];
    if (!primeira) { semGeometria += 1; continue; }
    notasExportadas += 1;
    anotacoes.push({ tipo: 'nota', pagina: primeira.pagina, quads: primeira.quads, cor: COR_NEUTRA, autor: AUTOR,
      assunto: ROTULO_DA_NOTA[nota.tipo], texto: `${textoDaNota(nota)}\n\n“${nota.ancora.citacao}”` });
  }
  return { anotacoes, marcas: exportadas, notas: notasExportadas, sem_geometria: semGeometria };
}

export const PRAZO_PDF_ANOTADO_MS = 120_000;

/** Roda o motor (`pdf-anotado`, ou `python -m margem_motor.pdf_anotado`) com o pedido no stdin. */
export function gerarPdfAnotado(raiz: string, entrada: string, saida: string, anotacoes: readonly AnotacaoPdf[],
  prazoMs = PRAZO_PDF_ANOTADO_MS): Promise<void> {
  raiz = resolve(raiz);
  return new Promise((resolver, rejeitar) => {
    const comando = comandoDoMotor('pdf-anotado', [], { raiz });
    const processo = spawn(comando.programa, comando.argumentos, {
      cwd: comando.cwd, env: ambienteSaneado(), stdio: ['pipe', 'ignore', 'pipe'], ...opcoesDeProcesso(),
    });
    let erro = '';
    processo.stderr.setEncoding('utf8');
    processo.stderr.on('data', (pedaco: string) => { erro = `${erro}${pedaco}`.slice(-2_000); });
    const prazo = setTimeout(() => { void encerrarArvore(processo, 'forcado'); }, prazoMs);
    prazo.unref();
    processo.on('error', (falha) => { clearTimeout(prazo); rejeitar(falha); });
    processo.on('close', (codigo) => {
      clearTimeout(prazo);
      if (codigo === 0) resolver();
      else rejeitar(new Error(erro.trim().split('\n').at(-1) ?? `motor encerrou com código ${String(codigo)}`));
    });
    processo.stdin.on('error', () => { /* o motor saiu antes de ler; o código de saída diz o motivo. */ });
    processo.stdin.end(JSON.stringify({ entrada, saida, anotacoes }));
  });
}
