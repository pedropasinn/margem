import { conferirEntrada } from './entrada';
import type { CapaDeNoticiasV1, EdicaoDeNoticiasV1, EditorialDeNoticiasV1 } from './noticias';
import type { ModeloDaObraV1, AnaliseCurtaDaObraV1, AnaliseDaObraGeradaV1 } from './arte';
import type { AudioV1, AudioV2 } from './audio';
import { regrasMidia, type MidiaV1 } from './midia';
import { regrasImportacaoWeb, type ImportacaoWebV1 } from './importacao-web';
import { regrasVideoYoutube, type ImportacaoYoutubeV1, type VideoYoutubeV1 } from './youtube';
import { regrasQuadroDaPessoa, type IdentificacaoDaObraV1, type QuadroDaPessoaV1 } from './quadros';
import type { VisualV1 } from './visual';
import type { ConferenciaDoSumarioV1 } from './sumario';
import type { EsquemaDoCapituloV1 } from './esquema';
import { regrasNarracaoDaVisita, type NarracaoDaVisitaV1, type RoteiroGuiadoV1 } from './visita';
import { regrasNarracaoDaLeitura, type LeituraComentadaV1, type NarracaoDaLeituraV1 } from './leitura-comentada';
import { regrasProveniencia, type ProvenienciaV1 } from './proveniencia';
import { regrasIndiceObsidian, regrasIndiceObsidianV2, type IndiceObsidianV1, type IndiceObsidianV2 } from './obsidian';
import { regrasExecucoesDoCodex, regrasExecucoesDoCodexV2, type ExecucoesDoCodexV1, type ExecucoesDoCodexV2 } from './execucoes';
import {
  regrasComentarioDaSala, regrasFormularioDaSala, regrasRespostaDaSala, regrasSalaDeTeste,
  type ComentarioDaSalaV1, type FormularioDaSalaV1, type RespostaDaSalaV1, type SalaDeTesteV1,
} from './sala';
import { comporContratos } from './composicoes';
import { compilarContrato, type Schema, type DiagnosticoContrato, type Contrato } from './contrato';
import { regrasGeometria } from './geometria';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import adicionarFormatos from 'ajv-formats';
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';
import type {
  AncoraV1, AnotacaoV1, CanonicoV1, GeometriaV1, ConexaoV1, ConversaV1, ExecucaoLeituraV1, ExecucaoLeituraV2, JobResultV1, LoteRevisaoV1,
  MarcaGeradaV1, MarcaGeradaV2, MarcasLegadoV1, MarcaV1, MarcaV2, ModoDeLeituraV1, ParteV1, ProgressoV1, RespostaGeradaV1,
  ApresentacaoDoPlanoV1, ExecucaoCompreensaoV1, LoteDoModeloV1, ModeloDoCapituloV1, PerfilDoLeitorV1, PlanoPedagogicoV1,
  ResolucaoGeradaV1, ResolucaoV1, EtiquetaV1, ConversaV2, ConexaoV2, ConexaoV3, ResolucaoV2, LoteRevisaoV2,
  NotaDoGrifoV1, DificuldadeV1,
} from './tipos';
import {
  regrasApresentacao, regrasPerfil,
} from './regras-compreensao';
import { unicodeValido } from './serializacao';
import { idiomaValido, regrasCanonico, regrasMarcaGerada, regrasParte } from './regras';
import { regrasMarcaGeradaV2, regrasModo } from './regras-f2';
import { regrasNotaDoGrifo } from './regras-f2';

const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
adicionarFormatos(ajv);
ajv.addFormat('bcp47', { type: 'string', validate: idiomaValido });
/** Nomes completos dos schemas em `contratos/schemas/<Nome>.schema.json`. */
export const NOMES_DOS_SCHEMAS = [
  'EditorialDeNoticiasV1', 'EdicaoDeNoticiasV1', 'CapaDeNoticiasV1',
  'AudioV1', 'AudioV2', 'ProvenienciaV1', 'GeometriaV1', 'CanonicoV1', 'AncoraV1', 'ParteV1', 'MarcaGeradaV1', 'MarcaV1', 'LoteRevisaoV1', 'JobResultV1', 'ProgressoV1', 'ExecucaoLeituraV1', 'MarcasLegadoV1',
  'ModoDeLeituraV1', 'MarcaGeradaV2', 'MarcaV2', 'ExecucaoLeituraV2', 'AnotacaoV1', 'ConversaV1', 'RespostaGeradaV1', 'ConexaoV1',
  'ModeloDoCapituloV1', 'LoteDoModeloV1', 'PlanoPedagogicoV1', 'ApresentacaoDoPlanoV1', 'PerfilDoLeitorV1', 'ExecucaoCompreensaoV1',
  'ResolucaoGeradaV1', 'ResolucaoV1', 'EtiquetaV1', 'MidiaV1', 'VisualV1', 'RoteiroGuiadoV1', 'NarracaoDaVisitaV1',
  'LeituraComentadaV1', 'NarracaoDaLeituraV1', 'EsquemaDoCapituloV1', 'ImportacaoWebV1', 'ImportacaoYoutubeV1', 'VideoYoutubeV1', 'IndiceObsidianV1', 'ExecucoesDoCodexV1', 'ExecucoesDoCodexV2',
  'FormularioDaSalaV1', 'RespostaDaSalaV1', 'ComentarioDaSalaV1', 'SalaDeTesteV1',
  'ModeloDaObraV1', 'AnaliseCurtaDaObraV1', 'AnaliseDaObraGeradaV1', 'IdentificacaoDaObraV1', 'QuadroDaPessoaV1',
  'ConversaV2', 'ConexaoV2', 'ResolucaoV2', 'LoteRevisaoV2', 'ConexaoV3', 'IndiceObsidianV2',
  'NotaDoGrifoV1', 'DificuldadeV1', 'ConferenciaDoSumarioV1',
] as const;
type NomeSchema = typeof NOMES_DOS_SCHEMAS[number];
const esquemas: Record<string, Schema> = {};
for (const nome of NOMES_DOS_SCHEMAS) {
  const schema = JSON.parse(readFileSync(new URL(`../schemas/${nome}.schema.json`, import.meta.url), 'utf8')) as AnySchema;
  esquemas[nome] = schema as Schema;
  ajv.addSchema(schema, `https://margem.local/contratos/${nome}.schema.json`);
}
function compilado<T>(nome: NomeSchema): ValidateFunction<T> {
  const resultado = ajv.getSchema<T>(`https://margem.local/contratos/${nome}.schema.json`);
  if (!resultado) throw new Error(`Schema ausente: ${nome}`);
  return resultado;
}
/** Validadores Ajv sem as invariantes; preferir validar* na entrada do serviço. */
export const validadoresSchema = {
  EditorialDeNoticiasV1: compilado<EditorialDeNoticiasV1>('EditorialDeNoticiasV1'),
  EdicaoDeNoticiasV1: compilado<EdicaoDeNoticiasV1>('EdicaoDeNoticiasV1'),
  CapaDeNoticiasV1: compilado<CapaDeNoticiasV1>('CapaDeNoticiasV1'),
  ModeloDaObraV1: compilado<ModeloDaObraV1>('ModeloDaObraV1'),
  AnaliseCurtaDaObraV1: compilado<AnaliseCurtaDaObraV1>('AnaliseCurtaDaObraV1'),
  AnaliseDaObraGeradaV1: compilado<AnaliseDaObraGeradaV1>('AnaliseDaObraGeradaV1'),
  IdentificacaoDaObraV1: compilado<IdentificacaoDaObraV1>('IdentificacaoDaObraV1'),
  QuadroDaPessoaV1: compilado<QuadroDaPessoaV1>('QuadroDaPessoaV1'),
  AudioV1: compilado<AudioV1>('AudioV1'),
  AudioV2: compilado<AudioV2>('AudioV2'),
  MidiaV1: compilado<MidiaV1>('MidiaV1'),
  ProvenienciaV1: compilado<ProvenienciaV1>('ProvenienciaV1'),
  GeometriaV1: compilado<GeometriaV1>('GeometriaV1'),
  CanonicoV1: compilado<CanonicoV1>('CanonicoV1'), AncoraV1: compilado<AncoraV1>('AncoraV1'),
  ParteV1: compilado<ParteV1>('ParteV1'), MarcaGeradaV1: compilado<MarcaGeradaV1>('MarcaGeradaV1'),
  MarcaV1: compilado<MarcaV1>('MarcaV1'), LoteRevisaoV1: compilado<LoteRevisaoV1>('LoteRevisaoV1'),
  JobResultV1: compilado<JobResultV1>('JobResultV1'), ProgressoV1: compilado<ProgressoV1>('ProgressoV1'),
  ExecucaoLeituraV1: compilado<ExecucaoLeituraV1>('ExecucaoLeituraV1'), MarcasLegadoV1: compilado<MarcasLegadoV1>('MarcasLegadoV1'),
  ModoDeLeituraV1: compilado<ModoDeLeituraV1>('ModoDeLeituraV1'), MarcaGeradaV2: compilado<MarcaGeradaV2>('MarcaGeradaV2'),
  MarcaV2: compilado<MarcaV2>('MarcaV2'), ExecucaoLeituraV2: compilado<ExecucaoLeituraV2>('ExecucaoLeituraV2'),
  AnotacaoV1: compilado<AnotacaoV1>('AnotacaoV1'), ConversaV1: compilado<ConversaV1>('ConversaV1'),
  RespostaGeradaV1: compilado<RespostaGeradaV1>('RespostaGeradaV1'), ConexaoV1: compilado<ConexaoV1>('ConexaoV1'),
  ModeloDoCapituloV1: compilado<ModeloDoCapituloV1>('ModeloDoCapituloV1'), LoteDoModeloV1: compilado<LoteDoModeloV1>('LoteDoModeloV1'),
  PlanoPedagogicoV1: compilado<PlanoPedagogicoV1>('PlanoPedagogicoV1'), ApresentacaoDoPlanoV1: compilado<ApresentacaoDoPlanoV1>('ApresentacaoDoPlanoV1'),
  PerfilDoLeitorV1: compilado<PerfilDoLeitorV1>('PerfilDoLeitorV1'), ExecucaoCompreensaoV1: compilado<ExecucaoCompreensaoV1>('ExecucaoCompreensaoV1'),
  ResolucaoGeradaV1: compilado<ResolucaoGeradaV1>('ResolucaoGeradaV1'), ResolucaoV1: compilado<ResolucaoV1>('ResolucaoV1'),
  EtiquetaV1: compilado<EtiquetaV1>('EtiquetaV1'),
  NotaDoGrifoV1: compilado<NotaDoGrifoV1>('NotaDoGrifoV1'),
  DificuldadeV1: compilado<DificuldadeV1>('DificuldadeV1'),
  ConferenciaDoSumarioV1: compilado<ConferenciaDoSumarioV1>('ConferenciaDoSumarioV1'),
  VisualV1: compilado<VisualV1>('VisualV1'),
  EsquemaDoCapituloV1: compilado<EsquemaDoCapituloV1>('EsquemaDoCapituloV1'),
  RoteiroGuiadoV1: compilado<RoteiroGuiadoV1>('RoteiroGuiadoV1'),
  NarracaoDaVisitaV1: compilado<NarracaoDaVisitaV1>('NarracaoDaVisitaV1'),
  LeituraComentadaV1: compilado<LeituraComentadaV1>('LeituraComentadaV1'),
  NarracaoDaLeituraV1: compilado<NarracaoDaLeituraV1>('NarracaoDaLeituraV1'),
  ImportacaoWebV1: compilado<ImportacaoWebV1>('ImportacaoWebV1'),
  ImportacaoYoutubeV1: compilado<ImportacaoYoutubeV1>('ImportacaoYoutubeV1'),
  VideoYoutubeV1: compilado<VideoYoutubeV1>('VideoYoutubeV1'),
  IndiceObsidianV1: compilado<IndiceObsidianV1>('IndiceObsidianV1'),
  IndiceObsidianV2: compilado<IndiceObsidianV2>('IndiceObsidianV2'),
  ExecucoesDoCodexV1: compilado<ExecucoesDoCodexV1>('ExecucoesDoCodexV1'),
  ExecucoesDoCodexV2: compilado<ExecucoesDoCodexV2>('ExecucoesDoCodexV2'),
  FormularioDaSalaV1: compilado<FormularioDaSalaV1>('FormularioDaSalaV1'),
  RespostaDaSalaV1: compilado<RespostaDaSalaV1>('RespostaDaSalaV1'),
  ComentarioDaSalaV1: compilado<ComentarioDaSalaV1>('ComentarioDaSalaV1'),
  SalaDeTesteV1: compilado<SalaDeTesteV1>('SalaDeTesteV1'),
  ConversaV2: compilado<ConversaV2>('ConversaV2'),
  ConexaoV2: compilado<ConexaoV2>('ConexaoV2'),
  ConexaoV3: compilado<ConexaoV3>('ConexaoV3'),
  ResolucaoV2: compilado<ResolucaoV2>('ResolucaoV2'),
  LoteRevisaoV2: compilado<LoteRevisaoV2>('LoteRevisaoV2'),
};
export interface OpcoesValidacao { conferir_hash?: boolean }
export interface Validador<T> {
  (valor: unknown, opcoes?: OpcoesValidacao): valor is T;
  errors: ErrorObject[] | null;
}
function errosAjv(erros: DiagnosticoContrato[]): ErrorObject[] {
  return erros.map(e => ({ keyword: e.codigo,
    instancePath: e.caminho.length ? '/' + e.caminho.map(p => String(p).replaceAll('~', '~0').replaceAll('/', '~1')).join('/') : '',
    schemaPath: '', params: {}, message: e.mensagem }));
}
function combinar<T>(schema: ValidateFunction<T>, regra: (valor: T, opcoes: OpcoesValidacao) => boolean): Validador<T> {
  const validar: Validador<T> = (valor: unknown, opcoes = {}): valor is T => {
    const entrada = conferirEntrada(valor);
    if (entrada.length) { validar.errors = errosAjv(entrada); return false; }
    if (!schema(valor)) { validar.errors = schema.errors ?? null; return false; }
    if (!unicodeValido(valor) || !regra(valor, opcoes)) {
      validar.errors = [{ keyword: 'invariante', instancePath: '', schemaPath: '', params: {}, message: 'Invariante semântica violada; consulte docs/CONTRATOS.md.' }];
      return false;
    }
    validar.errors = null;
    return true;
  };
  validar.errors = null;
  return validar;
}
const compilados = new WeakMap<Schema, ValidateFunction>();
function estrutura(schema: Schema, valor: unknown): DiagnosticoContrato[] {
  let validar = compilados.get(schema);
  if (!validar) {
    const semId = { ...schema }; delete semId.$id;
    validar = ajv.compile(semId);
    compilados.set(schema, validar);
  }
  if (validar(valor)) return [];
  return (validar.errors ?? []).map(e => ({ codigo: e.keyword, mensagem: e.message ?? 'Estrutura inválida.',
    caminho: e.instancePath.split('/').slice(1).map(p => p.replaceAll('~1', '/').replaceAll('~0', '~')) }));
}
const compostos = comporContratos(esquemas);
function composto<T>(nome: string): { contrato: Contrato<T>; validar: Validador<T> } {
  const componente = compostos[nome];
  if (!componente) throw new Error(`Contrato composto ausente: ${nome}`);
  const c = compilarContrato<T>(componente, estrutura, valor => unicodeValido(valor) ? []
    : [{ caminho: [], codigo: 'unicode', mensagem: 'Unicode inválido.' }]);
  const validar: Validador<T> = (valor: unknown): valor is T => {
    const erros = c.conferir(valor);
    validar.errors = erros.length ? errosAjv(erros) : null;
    return erros.length === 0;
  };
  validar.errors = null;
  return { contrato: c, validar };
}
const ancoraComposta = composto<AncoraV1>('AncoraV1');
const marcaComposta = composto<MarcaV2>('MarcaV2');
const modeloComposto = composto<ModeloDoCapituloV1>('ModeloDoCapituloV1');
const loteComposto = composto<LoteDoModeloV1>('LoteDoModeloV1');
const planoComposto = composto<PlanoPedagogicoV1>('PlanoPedagogicoV1');
export const contratoPlanoPedagogico = planoComposto.contrato;
const resolucaoComposta = composto<ResolucaoV1>('ResolucaoV1');
export const contratoAncora = ancoraComposta.contrato;
export const contratoMarcaV2 = marcaComposta.contrato;
export const contratoModeloDoCapitulo = modeloComposto.contrato;
export const contratoLoteDoModelo = loteComposto.contrato;
export const contratoResolucao = resolucaoComposta.contrato;
export const validarCanonico = combinar(validadoresSchema.CanonicoV1, (valor, opcoes) => regrasCanonico(valor, opcoes.conferir_hash ?? true));
export const validarAncora = ancoraComposta.validar;
export const validarParte = combinar(validadoresSchema.ParteV1, regrasParte);
export const validarMarcaGerada = combinar(validadoresSchema.MarcaGeradaV1, regrasMarcaGerada);
const compostoMarca = composto<MarcaV1>('MarcaV1');
export const contratoMarca = compostoMarca.contrato;
export const validarMarca = compostoMarca.validar;
const compostoLoteRevisao = composto<LoteRevisaoV1>('LoteRevisaoV1');
export const contratoLoteRevisao = compostoLoteRevisao.contrato;
export const validarLoteRevisao = compostoLoteRevisao.validar;
export const validarJobResult = combinar(validadoresSchema.JobResultV1, () => true);
const compostoProgresso = composto<ProgressoV1>('ProgressoV1');
export const contratoProgresso = compostoProgresso.contrato;
export const validarProgresso = compostoProgresso.validar;
export const validarExecucaoLeitura = combinar(validadoresSchema.ExecucaoLeituraV1, () => true);
// Preserva exatamente o comportamento do contrato legado.
export const validarMarcasLegado = validadoresSchema.MarcasLegadoV1;

// F2. Os V1 acima não mudam de significado; cada V2 vive ao lado.
export const validarModoDeLeitura = combinar(validadoresSchema.ModoDeLeituraV1, regrasModo);
export const validarMarcaGeradaV2 = combinar(validadoresSchema.MarcaGeradaV2, regrasMarcaGeradaV2);
export const validarMarcaV2 = marcaComposta.validar;
export const validarExecucaoLeituraV2 = combinar(validadoresSchema.ExecucaoLeituraV2, () => true);
const compostoAnotacao = composto<AnotacaoV1>('AnotacaoV1');
export const contratoAnotacao = compostoAnotacao.contrato;
export const validarAnotacao = compostoAnotacao.validar;
const compostoConversa = composto<ConversaV1>('ConversaV1');
export const contratoConversa = compostoConversa.contrato;
export const validarConversa = compostoConversa.validar;
export const validarRespostaGerada = combinar(validadoresSchema.RespostaGeradaV1, () => true);
const compostoConexao = composto<ConexaoV1>('ConexaoV1');
export const contratoConexao = compostoConexao.contrato;
export const validarConexao = compostoConexao.validar;

export const validarGeometria = combinar(validadoresSchema.GeometriaV1, regrasGeometria);

// Mídia com transcrição alinhada (J71).
export const validarMidia = combinar(validadoresSchema.MidiaV1, regrasMidia);

// Compreensão (J28).
export const validarModeloDoCapitulo = modeloComposto.validar;
export const validarLoteDoModelo = loteComposto.validar;
export const validarPlanoPedagogico = planoComposto.validar;
export const validarApresentacao = combinar(validadoresSchema.ApresentacaoDoPlanoV1, regrasApresentacao);
export const validarPerfilDoLeitor = combinar(validadoresSchema.PerfilDoLeitorV1, regrasPerfil);
export const validarExecucaoCompreensao = combinar(validadoresSchema.ExecucaoCompreensaoV1, () => true);

// Resolução de exercícios (J34).
export const validarResolucaoGerada = combinar(validadoresSchema.ResolucaoGeradaV1, () => true);
export const validarResolucao = resolucaoComposta.validar;
export const validarEtiqueta = combinar(validadoresSchema.EtiquetaV1, () => true);
// Modelo D dos grifos (J138): a nota do grifo e o sinal de dificuldade.
export const validarNotaDoGrifo = combinar(validadoresSchema.NotaDoGrifoV1, regrasNotaDoGrifo);
const compostoDificuldade = composto<DificuldadeV1>('DificuldadeV1');
export const contratoDificuldade = compostoDificuldade.contrato;
export const validarDificuldade = compostoDificuldade.validar;

const audioComposto = composto<AudioV1>('AudioV1');
export const contratoAudio = audioComposto.contrato;
export const validarAudio = audioComposto.validar;
/** J106: narração gerada no app por um provedor de voz. */
const audioV2Composto = composto<AudioV2>('AudioV2');
export const contratoAudioV2 = audioV2Composto.contrato;
export const validarAudioV2 = audioV2Composto.validar;
export const validarProveniencia = combinar(validadoresSchema.ProvenienciaV1, regrasProveniencia);

// Visuais ancorados (J70).
const visualComposto = composto<VisualV1>('VisualV1');
export const contratoVisual = visualComposto.contrato;
export const validarVisual = visualComposto.validar;

// Esquema do capítulo (mapa esquemático).
const esquemaComposto = composto<EsquemaDoCapituloV1>('EsquemaDoCapituloV1');
export const contratoEsquemaDoCapitulo = esquemaComposto.contrato;
export const validarEsquemaDoCapitulo = esquemaComposto.validar;

// Visita guiada do livro (J91).
const compostoRoteiroGuiado = composto<RoteiroGuiadoV1>('RoteiroGuiadoV1');
export const contratoRoteiroGuiado = compostoRoteiroGuiado.contrato;
export const validarRoteiroGuiado = compostoRoteiroGuiado.validar;
export const validarNarracaoDaVisita = combinar(validadoresSchema.NarracaoDaVisitaV1, regrasNarracaoDaVisita);

// Leitura comentada integral (J92).
const compostoLeituraComentada = composto<LeituraComentadaV1>('LeituraComentadaV1');
export const contratoLeituraComentada = compostoLeituraComentada.contrato;
export const validarLeituraComentada = compostoLeituraComentada.validar;
export const validarNarracaoDaLeitura = combinar(validadoresSchema.NarracaoDaLeituraV1, regrasNarracaoDaLeitura);

// Página web capturada pela extensão do navegador.
export const validarImportacaoWeb = combinar(validadoresSchema.ImportacaoWebV1, regrasImportacaoWeb);
// Vídeo do YouTube (J109): o pedido de importação e o vídeo do documento.
export const validarImportacaoYoutube = combinar(validadoresSchema.ImportacaoYoutubeV1, () => true);
export const validarVideoYoutube = combinar(validadoresSchema.VideoYoutubeV1, regrasVideoYoutube);
// Exportação para o Obsidian.
export const validarIndiceObsidian = combinar(validadoresSchema.IndiceObsidianV1, regrasIndiceObsidian);
/** V2: uma nota por item, numa pasta por documento (`GET /api/obsidian/v2/indice` e o manifesto do ZIP). */
export const validarIndiceObsidianV2 = combinar(validadoresSchema.IndiceObsidianV2, regrasIndiceObsidianV2);
// Execuções do Codex visíveis na interface (avisos).
export const validarExecucoesDoCodex = combinar(validadoresSchema.ExecucoesDoCodexV1, regrasExecucoesDoCodex);
/** V2: com os avisos das execuções concluídas (é a que `/api/execucoes/*` responde). */
export const validarExecucoesDoCodexV2 = combinar(validadoresSchema.ExecucoesDoCodexV2, regrasExecucoesDoCodexV2);
// Sala de teste do beta (formulário, respostas, comentários nos trechos).
export const validarFormularioDaSala = combinar(validadoresSchema.FormularioDaSalaV1, regrasFormularioDaSala);
export const validarRespostaDaSala = combinar(validadoresSchema.RespostaDaSalaV1, regrasRespostaDaSala);
export const validarComentarioDaSala = combinar(validadoresSchema.ComentarioDaSalaV1, regrasComentarioDaSala);
export const validarSalaDeTeste = combinar(validadoresSchema.SalaDeTesteV1, regrasSalaDeTeste);
// Arte: estrutura aqui; integridade entre modelo, regiões e projeção no núcleo.
export const validarModeloDaObra = combinar(validadoresSchema.ModeloDaObraV1, () => true);
export const validarAnaliseCurtaDaObra = combinar(validadoresSchema.AnaliseCurtaDaObraV1, () => true);
// Quadros da pessoa (J118): a obra que ela enviou, enquanto é preparada, e a identificação que ela corrige.
export const validarIdentificacaoDaObra = combinar(validadoresSchema.IdentificacaoDaObraV1, () => true);
export const validarQuadroDaPessoa = combinar(validadoresSchema.QuadroDaPessoaV1, regrasQuadroDaPessoa);
// Conferência do sumário (J164): a forma aqui; as entradas contra as seções do canônico, no serviço.
export const validarConferenciaDoSumario = combinar(validadoresSchema.ConferenciaDoSumarioV1, () => true);
export const validarAnaliseDaObraGerada = combinar(validadoresSchema.AnaliseDaObraGeradaV1, () => true);

// Notícias: regras de fontes e classificação dependem do contexto e vivem no serviço.
export const validarEditorialDeNoticias = combinar(validadoresSchema.EditorialDeNoticiasV1, () => true);
export const validarEdicaoDeNoticias = combinar(validadoresSchema.EdicaoDeNoticiasV1, () => true);
export const validarCapaDeNoticias = combinar(validadoresSchema.CapaDeNoticiasV1, () => true);

// J101: o autor humano é `leitor` (na V1 era `pedro`). Os V1 continuam válidos para leitura.
const compostoConversaV2 = composto<ConversaV2>('ConversaV2');
export const contratoConversaV2 = compostoConversaV2.contrato;
export const validarConversaV2 = compostoConversaV2.validar;
const compostoConexaoV2 = composto<ConexaoV2>('ConexaoV2');
export const contratoConexaoV2 = compostoConexaoV2.contrato;
export const validarConexaoV2 = compostoConexaoV2.validar;
// v0.1: a relação guarda o tipo fino da compreensão (`relacao_semantica`) ao lado da família.
const compostoConexaoV3 = composto<ConexaoV3>('ConexaoV3');
export const contratoConexaoV3 = compostoConexaoV3.contrato;
export const validarConexaoV3 = compostoConexaoV3.validar;
const compostoResolucaoV2 = composto<ResolucaoV2>('ResolucaoV2');
export const contratoResolucaoV2 = compostoResolucaoV2.contrato;
export const validarResolucaoV2 = compostoResolucaoV2.validar;
const compostoLoteRevisaoV2 = composto<LoteRevisaoV2>('LoteRevisaoV2');
export const contratoLoteRevisaoV2 = compostoLoteRevisaoV2.contrato;
export const validarLoteRevisaoV2 = compostoLoteRevisaoV2.validar;
