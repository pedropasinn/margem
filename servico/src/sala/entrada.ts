/**
 * Leitura e conferência dos corpos JSON da sala de teste: o que o leitor manda ao criar ou mudar
 * uma sala, o comentário do testador e as respostas do formulário. Campos desconhecidos são
 * recusados, como nos contratos.
 */
import {
  conferirRespostas, validarFormularioDaSala,
  type Bloco, type FormularioDaSalaV1, type Id, type ValorDaRespostaDaSala,
} from '@margem/contratos';
import { ehUlid } from '../dados.js';
import { ErroDaApi } from '../http/erros.js';
import type { MudancaDaSala } from '../repos/salas.js';
import { SENHA_MAXIMA, SENHA_MINIMA } from './senha.js';

type Corpo = Record<string, unknown>;

function objeto(bruto: unknown, papel: string): Corpo {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new ErroDaApi(400, 'corpo_invalido', `Envie ${papel} como objeto JSON.`);
  return bruto as Corpo;
}

function semCamposEstranhos(corpo: Corpo, aceitos: readonly string[]): void {
  const estranho = Object.keys(corpo).find((campo) => !aceitos.includes(campo));
  if (estranho !== undefined) throw new ErroDaApi(400, 'campo_desconhecido', `Campo não aceito: ${estranho}.`);
}

const LINHA = /^(?=[^\r\n]*\S)[^\r\n\u2028\u2029]+$/;

function titulo(valor: unknown): string {
  if (typeof valor !== 'string' || valor.trim().length > 160 || !LINHA.test(valor.trim())) {
    throw new ErroDaApi(400, 'titulo_invalido', 'O título é uma linha de 1 a 160 caracteres.');
  }
  return valor.trim();
}

function boasVindas(valor: unknown): string {
  if (typeof valor !== 'string' || valor.length > 4000) throw new ErroDaApi(400, 'boas_vindas_invalidas', 'A mensagem de boas-vindas tem até 4000 caracteres.');
  return valor.trim();
}

function documentos(valor: unknown): Id[] {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > 20 || !valor.every((item): item is string => typeof item === 'string' && ehUlid(item))) {
    throw new ErroDaApi(400, 'documentos_invalidos', 'Escolha de 1 a 20 documentos da biblioteca.');
  }
  if (new Set(valor).size !== valor.length) throw new ErroDaApi(400, 'documentos_invalidos', 'Um documento aparece duas vezes.');
  return valor;
}

function validade(valor: unknown): string | null {
  if (valor === null) return null;
  if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor)) || !/^\d{4}-\d{2}-\d{2}T/.test(valor)) {
    throw new ErroDaApi(400, 'validade_invalida', 'A validade é uma data e hora ISO 8601 (ou null, sem validade).');
  }
  return new Date(valor).toISOString();
}

function formulario(valor: unknown): FormularioDaSalaV1 {
  if (!validarFormularioDaSala(valor)) {
    throw new ErroDaApi(400, 'formulario_invalido', 'O formulário não confere com FormularioDaSalaV1 (ids únicos, opções só na escolha, rótulos só na escala).');
  }
  return valor;
}

export function senha(valor: unknown): string {
  if (typeof valor !== 'string' || valor.length < SENHA_MINIMA || valor.length > SENHA_MAXIMA || valor.trim() !== valor) {
    throw new ErroDaApi(400, 'senha_invalida', `A senha tem de ${String(SENHA_MINIMA)} a ${String(SENHA_MAXIMA)} caracteres, sem espaço nas pontas.`);
  }
  return valor;
}

export interface EntradaDaNovaSala {
  titulo: string; boas_vindas: string; documentos: Id[]; ativa: boolean; expira_em: string | null;
  formulario: FormularioDaSalaV1; senha: string | null;
}

export function lerNovaSala(bruto: unknown, formularioPadrao: FormularioDaSalaV1): EntradaDaNovaSala {
  const corpo = objeto(bruto, 'a sala');
  semCamposEstranhos(corpo, ['titulo', 'boas_vindas', 'documentos', 'ativa', 'expira_em', 'formulario', 'senha']);
  if (corpo.ativa !== undefined && typeof corpo.ativa !== 'boolean') throw new ErroDaApi(400, 'ativa_invalida');
  return {
    titulo: titulo(corpo.titulo),
    boas_vindas: corpo.boas_vindas === undefined ? '' : boasVindas(corpo.boas_vindas),
    documentos: documentos(corpo.documentos),
    ativa: corpo.ativa ?? true,
    expira_em: corpo.expira_em === undefined ? null : validade(corpo.expira_em),
    formulario: corpo.formulario === undefined ? formularioPadrao : formulario(corpo.formulario),
    senha: corpo.senha === undefined || corpo.senha === null || corpo.senha === '' ? null : senha(corpo.senha),
  };
}

export function lerMudancaDaSala(bruto: unknown): MudancaDaSala {
  const corpo = objeto(bruto, 'a mudança');
  semCamposEstranhos(corpo, ['titulo', 'boas_vindas', 'documentos', 'ativa', 'expira_em', 'formulario']);
  if (corpo.ativa !== undefined && typeof corpo.ativa !== 'boolean') throw new ErroDaApi(400, 'ativa_invalida');
  return {
    ...(corpo.titulo === undefined ? {} : { titulo: titulo(corpo.titulo) }),
    ...(corpo.boas_vindas === undefined ? {} : { boas_vindas: boasVindas(corpo.boas_vindas) }),
    ...(corpo.documentos === undefined ? {} : { documentos: documentos(corpo.documentos) }),
    ...(corpo.ativa === undefined ? {} : { ativa: corpo.ativa }),
    ...(corpo.expira_em === undefined ? {} : { expira_em: validade(corpo.expira_em) }),
    ...(corpo.formulario === undefined ? {} : { formulario: formulario(corpo.formulario) }),
  };
}

export interface EntradaDoTestador { nome: string; email: string | null; senha: string }

/** Nome, e-mail opcional e senha da tela de entrada. A senha não é conferida aqui (tamanho só). */
export function lerEntrada(bruto: unknown): EntradaDoTestador {
  const corpo = objeto(bruto, 'a entrada');
  semCamposEstranhos(corpo, ['nome', 'email', 'senha']);
  const nome = typeof corpo.nome === 'string' ? corpo.nome.trim().replaceAll(/\s+/g, ' ') : '';
  if (nome === '' || nome.length > 120) throw new ErroDaApi(400, 'nome_invalido', 'Diga o seu nome (até 120 caracteres).');
  let email: string | null = null;
  if (typeof corpo.email === 'string' && corpo.email.trim() !== '') {
    email = corpo.email.trim();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroDaApi(400, 'email_invalido', 'O e-mail não parece válido.');
  } else if (corpo.email !== undefined && corpo.email !== null && corpo.email !== '') {
    throw new ErroDaApi(400, 'email_invalido');
  }
  if (typeof corpo.senha !== 'string' || corpo.senha.length === 0 || corpo.senha.length > SENHA_MAXIMA) {
    throw new ErroDaApi(400, 'senha_ausente', 'Digite a senha.');
  }
  return { nome, email, senha: corpo.senha };
}

export interface PedidoDeComentario { versao_id: Id; bloco_id: Id; inicio_utf16: number; fim_utf16: number; citacao: string; texto: string }

export function lerComentario(bruto: unknown): PedidoDeComentario {
  const corpo = objeto(bruto, 'o comentário');
  semCamposEstranhos(corpo, ['versao_id', 'bloco_id', 'inicio_utf16', 'fim_utf16', 'citacao', 'texto']);
  const { versao_id: versao, bloco_id: bloco, inicio_utf16: inicio, fim_utf16: fim, citacao, texto } = corpo;
  if (typeof versao !== 'string' || !ehUlid(versao) || typeof bloco !== 'string' || !ehUlid(bloco)) throw new ErroDaApi(400, 'trecho_invalido');
  if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fim) || (inicio as number) < 0 || (fim as number) <= (inicio as number)) throw new ErroDaApi(400, 'trecho_invalido');
  if (typeof citacao !== 'string' || citacao.length === 0 || citacao.length > 2000) throw new ErroDaApi(400, 'citacao_invalida', 'O trecho tem de 1 a 2000 caracteres.');
  if (typeof texto !== 'string' || texto.trim() === '' || texto.length > 4000) throw new ErroDaApi(400, 'texto_invalido', 'Escreva o comentário (até 4000 caracteres).');
  return { versao_id: versao, bloco_id: bloco, inicio_utf16: inicio as number, fim_utf16: fim as number, citacao, texto: texto.trim() };
}

/**
 * O serviço resolve o intervalo (regra 3): vale o que o cliente mandou se a fatia do bloco for a
 * citação; senão, a única ocorrência da citação no bloco. Ausente ou ambígua é 422, nunca a
 * primeira ocorrência em silêncio.
 */
export function resolverTrecho(bloco: Pick<Bloco, 'texto'>, pedido: Pick<PedidoDeComentario, 'inicio_utf16' | 'fim_utf16' | 'citacao'>): { inicio_utf16: number; fim_utf16: number } {
  // `slice` corta em silêncio o fim além do bloco: o intervalo só vale se couber nele.
  if (pedido.fim_utf16 <= bloco.texto.length && bloco.texto.slice(pedido.inicio_utf16, pedido.fim_utf16) === pedido.citacao) {
    return { inicio_utf16: pedido.inicio_utf16, fim_utf16: pedido.fim_utf16 };
  }
  const primeira = bloco.texto.indexOf(pedido.citacao);
  if (primeira < 0) throw new ErroDaApi(422, 'citacao_ausente', 'O trecho não está neste bloco.');
  if (bloco.texto.indexOf(pedido.citacao, primeira + 1) >= 0) throw new ErroDaApi(422, 'citacao_ambigua', 'O trecho aparece mais de uma vez no bloco; selecione de novo.');
  return { inicio_utf16: primeira, fim_utf16: primeira + pedido.citacao.length };
}

function grupoDeRespostas(bruto: unknown, papel: string): Record<string, ValorDaRespostaDaSala> {
  const grupo = objeto(bruto, papel);
  const saida: Record<string, ValorDaRespostaDaSala> = {};
  for (const [id, valor] of Object.entries(grupo)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(id)) throw new ErroDaApi(400, 'resposta_invalida', `Pergunta inválida: ${id.slice(0, 40)}.`);
    // Texto vazio e `null` são resposta apagada: não vão para o banco.
    if (valor === null || valor === '') continue;
    if (typeof valor !== 'number' && typeof valor !== 'string') throw new ErroDaApi(400, 'resposta_invalida');
    saida[id] = valor;
  }
  return saida;
}

export interface PedidoDeResposta { geral: Record<string, ValorDaRespostaDaSala>; por_documento: Record<Id, Record<string, ValorDaRespostaDaSala>>; enviar: boolean }

export function lerRespostas(bruto: unknown, formularioDaSala: FormularioDaSalaV1, documentosDaSala: readonly Id[], jaEnviada: boolean): PedidoDeResposta {
  const corpo = objeto(bruto, 'as respostas');
  semCamposEstranhos(corpo, ['geral', 'por_documento', 'enviar']);
  if (corpo.enviar !== undefined && typeof corpo.enviar !== 'boolean') throw new ErroDaApi(400, 'enviar_invalido');
  const geral = grupoDeRespostas(corpo.geral ?? {}, 'as respostas gerais');
  const porDocumento: Record<Id, Record<string, ValorDaRespostaDaSala>> = {};
  for (const [documento, grupo] of Object.entries(objeto(corpo.por_documento ?? {}, 'as respostas por documento'))) {
    const respostas = grupoDeRespostas(grupo, 'as respostas do documento');
    if (Object.keys(respostas).length > 0) porDocumento[documento] = respostas;
  }
  // Depois de enviada, cada gravação é um reenvio: as obrigatórias seguem exigidas.
  const enviar = corpo.enviar === true || jaEnviada;
  const problemas = conferirRespostas(formularioDaSala, documentosDaSala, { geral, por_documento: porDocumento }, enviar);
  if (problemas.length > 0) {
    const obrigatorias = problemas.filter((problema) => problema.codigo === 'obrigatoria_sem_resposta');
    if (obrigatorias.length === problemas.length) {
      throw new ErroDaApi(422, 'obrigatorias_sem_resposta', obrigatorias.map((problema) => problema.campo).join(', '));
    }
    throw new ErroDaApi(422, 'respostas_invalidas', problemas.map((problema) => `${problema.campo}: ${problema.codigo}`).join('; ').slice(0, 400));
  }
  return { geral, por_documento: porDocumento, enviar };
}

