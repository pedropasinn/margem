import { regrasMarca, regrasLote, regrasProgresso } from './regras';
import { regrasAnotacao, regrasConversa, regrasConexao } from './regras-f2';
import { regrasRoteiroGuiado } from './visita';
import { regrasLeituraComentada } from './leitura-comentada';
import { regrasAudio } from './audio';
import { regrasVisual, type VisualV1 } from './visual';
import { regrasEsquemaDoCapitulo, type EsquemaDoCapituloV1 } from './esquema';
/** Contratos migrados: as referências são componentes, não uma lista paralela de regras. */
import { alternativas, diagnostico, discriminada, folha, lista, objeto, referenciar, regraBooleana, type Componente, type Schema } from './contrato';
import type { AncoraV1, ElementoSemanticoV1, MarcaV2, PlanoPedagogicoV1 } from './tipos';
import { regrasLoteDoModelo, regrasModeloDoCapitulo, regrasPlanoPedagogico } from './regras-compreensao';
import { regrasResolucao } from './regras-resolucao';
import { regrasSubfaixas } from './regras';

const p = (s: Schema, nome: string): Schema => (s.properties as Record<string, Schema>)[nome]!;
const r = (s: Schema, tipo: 'oneOf' | 'anyOf'): Schema[] => s[tipo] as Schema[];
const def = (s: Schema, nome: string): Schema => (s.$defs as Record<string, Schema>)[nome]!;
const id = (nome: string): string => `https://margem.local/contratos/${nome}.schema.json`;

export function comporContratos(s: Record<string, Schema>): Record<string, Componente> {
  const ancora = folha<AncoraV1>(s.AncoraV1!, a => a.fim_utf16 > a.inicio_utf16 && a.fim_utf16 - a.inicio_utf16 === a.citacao.length ? []
    : [diagnostico('intervalo_citacao', 'O intervalo precisa ter o mesmo comprimento UTF-16 da citação.', ['fim_utf16'])]);
  const refAncora = referenciar(ancora, id('AncoraV1'));
  const marcaV1 = objeto(s.MarcaV1!, { ancora: refAncora }, regraBooleana(regrasMarca, 'marca_incoerente'));
  const progresso = objeto(s.ProgressoV1!, { ancora: refAncora }, regraBooleana(regrasProgresso, 'progresso_incoerente'));
  const anotacao = objeto(s.AnotacaoV1!, { ancora: refAncora }, regraBooleana(regrasAnotacao, 'anotacao_incoerente'));
  // J101: V1 (autor humano `pedro`) e V2 (`leitor`) compõem igual; só o schema e a chave do ramo mudam.
  const comporConversa = (conversaSchema: Schema, humano: string): Componente => {
    const mensagemDaConversa = def(conversaSchema, 'mensagem');
    const ramosDaMensagem = r(mensagemDaConversa, 'oneOf');
    const mensagemComposta = discriminada(mensagemDaConversa, 'oneOf', 'autor', {
      [humano]: folha(ramosDaMensagem[0]!),
      ia: objeto(ramosDaMensagem[1]!, { citacoes: lista(p(ramosDaMensagem[1]!, 'citacoes'), refAncora) }),
    });
    return objeto(conversaSchema, {
      ancora: refAncora,
      mensagens: lista(p(conversaSchema, 'mensagens'), referenciar(mensagemComposta, '#/$defs/mensagem')),
    }, regraBooleana(regrasConversa, 'conversa_incoerente'));
  };
  const comporConexao = (conexaoSchema: Schema): Componente => {
    const destino = p(conexaoSchema, 'destino');
    const destinos = r(destino, 'oneOf');
    return objeto(conexaoSchema, {
      origem: refAncora,
      destino: alternativas(destino, 'oneOf', [objeto(destinos[0]!, { ancora: refAncora }), ...destinos.slice(1).map(v => folha(v))]),
    }, regraBooleana(regrasConexao, 'conexao_incoerente'));
  };
  const comporLoteRevisao = (loteSchema: Schema): Componente => {
    const opsRevisao = p(loteSchema, 'operacoes');
    const opRevisao = opsRevisao.items as Schema;
    return objeto(loteSchema, {
      operacoes: lista(opsRevisao, alternativas(opRevisao, 'oneOf', r(opRevisao, 'oneOf').map((ramo, i) =>
        i === 6 ? objeto(ramo, { antes: referenciar(marcaV1, id('MarcaV1')) }) : folha(ramo)))),
    }, regraBooleana(regrasLote, 'revisao_incoerente'));
  };
  const conversa = comporConversa(s.ConversaV1!, 'pedro');
  const conversaV2 = comporConversa(s.ConversaV2!, 'leitor');
  const conexao = comporConexao(s.ConexaoV1!);
  const conexaoV2 = comporConexao(s.ConexaoV2!);
  const loteRevisao = comporLoteRevisao(s.LoteRevisaoV1!);
  const loteRevisaoV2 = comporLoteRevisao(s.LoteRevisaoV2!);
  const paradas = p(s.RoteiroGuiadoV1!, 'paradas');
  const parada = paradas.items as Schema;
  const ponta = p(parada, 'ponta');
  const roteiro = objeto(s.RoteiroGuiadoV1!, {
    paradas: lista(paradas, objeto(parada, {
      foco: refAncora, ponta: alternativas(ponta, 'anyOf', [folha(r(ponta, 'anyOf')[0]!), refAncora]),
    })),
  }, regraBooleana(regrasRoteiroGuiado, 'roteiro_incoerente'));
  const pausas = p(s.LeituraComentadaV1!, 'pausas');
  const pausa = pausas.items as Schema;
  const leitura = objeto(s.LeituraComentadaV1!, {
    pausas: lista(pausas, objeto(pausa, {
      foco: lista(p(pausa, 'foco'), refAncora), pontas: lista(p(pausa, 'pontas'), refAncora),
    })),
  }, regraBooleana(regrasLeituraComentada, 'leitura_incoerente'));
  const marca = objeto<MarcaV2>(s.MarcaV2!, { ancora: refAncora }, m => {
    if (!regrasSubfaixas(m.subfaixas, m.ancora)) return [diagnostico('subfaixas', 'Subfaixas fora da citação ou sobrepostas.', ['subfaixas'])];
    return m.execucao_id !== undefined && m.execucao_id !== m.camada_id
      ? [diagnostico('camada_execucao', 'A camada precisa ser a execução da marca.', ['camada_id'])] : [];
  });
  const modeloSchema = s.ModeloDoCapituloV1!;
  const elemento = objeto<ElementoSemanticoV1>(def(modeloSchema, 'elemento'), {
    ancoras: lista(p(def(modeloSchema, 'elemento'), 'ancoras'), refAncora),
  }, e => e.qualificadores.flatMap((termo, i) => e.ancoras[0]!.citacao.includes(termo) ? []
    : [diagnostico('qualificador_ausente', 'O qualificador precisa ocorrer na citação principal.', ['qualificadores', i])]));
  const dificuldade = objeto(def(modeloSchema, 'dificuldade'), {
    ancoras: lista(p(def(modeloSchema, 'dificuldade'), 'ancoras'), refAncora),
  });
  const refs = {
    elemento: referenciar(elemento, `${id('ModeloDoCapituloV1')}#/$defs/elemento`),
    dificuldade: referenciar(dificuldade, `${id('ModeloDoCapituloV1')}#/$defs/dificuldade`),
    nota: referenciar(folha(def(modeloSchema, 'nota')), `${id('ModeloDoCapituloV1')}#/$defs/nota`),
    relacao: referenciar(folha(def(modeloSchema, 'relacao')), `${id('ModeloDoCapituloV1')}#/$defs/relacao`),
    unidade: referenciar(folha(def(modeloSchema, 'unidade')), `${id('ModeloDoCapituloV1')}#/$defs/unidade`),
    movimento: referenciar(folha(def(modeloSchema, 'movimento')), `${id('ModeloDoCapituloV1')}#/$defs/movimento`),
  };
  const movimentoSchema = p(modeloSchema, 'movimento');
  const modelo = objeto(modeloSchema, {
    elementos: lista(p(modeloSchema, 'elementos'), refs.elemento),
    dificuldades: lista(p(modeloSchema, 'dificuldades'), refs.dificuldade),
    relacoes: lista(p(modeloSchema, 'relacoes'), refs.relacao),
    unidades: lista(p(modeloSchema, 'unidades'), refs.unidade),
    movimento: alternativas(movimentoSchema, 'anyOf', [folha(r(movimentoSchema, 'anyOf')[0]!), refs.movimento]),
  }, regraBooleana(regrasModeloDoCapitulo, 'modelo_incoerente'));
  const operacaoSchema = p(s.LoteDoModeloV1!, 'operacoes').items as Schema;
  // A forma publicada antes/depois é uma anyOf. Sua composição é explícita e testada
  // contra o schema; o discriminador op continua conferido por operacaoCoerente.
  function estado(schema: Schema): Componente {
    const a = r(schema, 'anyOf');
    return alternativas(schema, 'anyOf', [
      ...a.slice(0, 4).map(v => folha(v)), refs.nota,
      objeto(a[5]!, { absorvidos: lista(p(a[5]!, 'absorvidos'), refs.elemento) }),
      objeto(a[6]!, { ancoras: lista(p(a[6]!, 'ancoras'), refAncora) }),
      refs.elemento, refs.relacao, refs.dificuldade, lista(a[10]!, refs.unidade), refs.movimento,
    ]);
  }
  const operacao = objeto(operacaoSchema, {
    antes: estado(p(operacaoSchema, 'antes')), depois: estado(p(operacaoSchema, 'depois')),
    evidencia: lista(p(operacaoSchema, 'evidencia'), refAncora),
  });
  const lote = objeto(s.LoteDoModeloV1!, { operacoes: lista(p(s.LoteDoModeloV1!, 'operacoes'), operacao) },
    regraBooleana(regrasLoteDoModelo, 'lote_incoerente'));

  const comporResolucao = (resolucaoSchema: Schema, humano: string): Componente => {
    const origemSchema = p(resolucaoSchema, 'origem');
    const origens = r(origemSchema, 'oneOf');
    const origem = discriminada(origemSchema, 'oneOf', 'tipo', {
      recorte: folha(origens[0]!), trecho: objeto(origens[1]!, { ancora: refAncora }),
    });
    const geradaSchema = s.ResolucaoGeradaV1!;
    const passo = referenciar(folha(def(geradaSchema, 'passo')), `${id('ResolucaoGeradaV1')}#/$defs/passo`);
    const itensSchema = p(geradaSchema, 'itens');
    const itemSchema = itensSchema.items as Schema;
    // O schema gerado usa referência local; preservamos sua URI relativa na exportação.
    const passoLocal = referenciar(folha(def(geradaSchema, 'passo')), '#/$defs/passo');
    const gerada = objeto(geradaSchema, { itens: lista(itensSchema, objeto(itemSchema, {
      passos: lista(p(itemSchema, 'passos'), passoLocal),
    })) });
    const mensagensSchema = p(resolucaoSchema, 'mensagens');
    const mensagemSchema = mensagensSchema.items as Schema;
    const mensagens = r(mensagemSchema, 'oneOf');
    const mensagem = discriminada(mensagemSchema, 'oneOf', 'autor', {
      [humano]: folha(mensagens[0]!), ia: objeto(mensagens[1]!, { passos: lista(p(mensagens[1]!, 'passos'), passo) }),
    });
    const respostaSchema = p(resolucaoSchema, 'resolucao');
    return objeto(resolucaoSchema, {
      origem, mensagens: lista(mensagensSchema, mensagem),
      resolucao: alternativas(respostaSchema, 'anyOf', [referenciar(gerada, id('ResolucaoGeradaV1')), folha(r(respostaSchema, 'anyOf')[1]!)]),
    }, regraBooleana(regrasResolucao, 'sessao_incoerente'));
  };
  const resolucao = comporResolucao(s.ResolucaoV1!, 'pedro');
  const resolucaoV2 = comporResolucao(s.ResolucaoV2!, 'leitor');
  const plano = folha<PlanoPedagogicoV1>(s.PlanoPedagogicoV1!, regraBooleana(regrasPlanoPedagogico, 'plano_incoerente'));
  const trechosAudio = p(s.AudioV1!, 'trechos');
  const audio = objeto(s.AudioV1!, { trechos: lista(trechosAudio, objeto(trechosAudio.items as Schema, { ancora: refAncora })) },
    regraBooleana(regrasAudio, 'audio_incoerente'));
  const trechosAudioV2 = p(s.AudioV2!, 'trechos');
  const audioV2 = objeto(s.AudioV2!, { trechos: lista(trechosAudioV2, objeto(trechosAudioV2.items as Schema, { ancora: refAncora })) },
    regraBooleana(regrasAudio, 'audio_incoerente'));
  const visualSchema = s.VisualV1!;
  const alvoSchema = p(visualSchema, 'alvo');
  const alvos = r(alvoSchema, 'oneOf');
  const artefatoSchema = p(visualSchema, 'artefato');
  const artefatos = r(artefatoSchema, 'oneOf');
  const nosSchema = p(artefatos[1]!, 'nos');
  const visual = objeto<VisualV1>(visualSchema, {
    alvo: discriminada(alvoSchema, 'oneOf', 'tipo', {
      trecho: objeto(alvos[0]!, { ancora: refAncora }), bloco: objeto(alvos[1]!, { ancora: refAncora }), capitulo: folha(alvos[2]!),
    }),
    artefato: discriminada(artefatoSchema, 'oneOf', 'tipo', {
      png: folha(artefatos[0]!),
      mermaid: objeto(artefatos[1]!, { nos: lista(nosSchema, objeto(nosSchema.items as Schema, { ancora: refAncora })) }),
    }),
  }, regrasVisual);
  const esquemaSchema = s.EsquemaDoCapituloV1!;
  const nosDoEsquema = p(esquemaSchema, 'nos');
  const esquema = objeto<EsquemaDoCapituloV1>(esquemaSchema, {
    nos: lista(nosDoEsquema, objeto(nosDoEsquema.items as Schema, { ancora: refAncora })),
  }, regrasEsquemaDoCapitulo);
  return { MarcaV1: marcaV1, ProgressoV1: progresso, AnotacaoV1: anotacao, ConversaV1: conversa, ConexaoV1: conexao, ConversaV2: conversaV2, ConexaoV2: conexaoV2, LoteRevisaoV2: loteRevisaoV2, ResolucaoV2: resolucaoV2,
    LoteRevisaoV1: loteRevisao, RoteiroGuiadoV1: roteiro, LeituraComentadaV1: leitura, EsquemaDoCapituloV1: esquema, VisualV1: visual, AudioV1: audio, AudioV2: audioV2, PlanoPedagogicoV1: plano, AncoraV1: ancora, MarcaV2: marca, ModeloDoCapituloV1: modelo, LoteDoModeloV1: lote, ResolucaoV1: resolucao };
}
