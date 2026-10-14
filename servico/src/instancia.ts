/**
 * Identificação desta instalação do Margem (V-W9). A extensão do navegador procura o Margem nas
 * portas 8730 a 8739 (`GET /api/saude`) e, havendo mais de um (o app de computador numa porta e um
 * Margem em Docker ou um túnel na 8730), fica com o da identificação que conhece; a pessoa confere
 * a identificação na checagem da instalação.
 *
 * É estável por pasta de dados (a biblioteca, no app de computador): o mesmo Margem mantém a mesma
 * identificação entre reinícios e portas, sem arquivo nenhum. `MARGEM_INSTANCIA` fixa outra.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { raizDeDados } from './dados.js';

const FORMATO = /^[a-z0-9][a-z0-9-]{3,39}$/u;

export function idDaInstancia(ambiente: NodeJS.ProcessEnv = process.env, raiz: () => string = raizDeDados): string {
  const fixa = ambiente.MARGEM_INSTANCIA?.trim().toLowerCase();
  if (fixa !== undefined && FORMATO.test(fixa)) return fixa;
  const hex = createHash('sha256').update(`margem:${resolve(raiz())}`).digest('hex');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

/** O que `GET /api/saude` diz de quem responde, além do `ok`. */
export interface IdentidadeDaSaude { servico: 'margem'; instancia_id: string; app_de_computador: boolean }

export function identidadeDaSaude(ambiente: NodeJS.ProcessEnv = process.env): IdentidadeDaSaude {
  return { servico: 'margem', instancia_id: idDaInstancia(ambiente), app_de_computador: ambiente.MARGEM_APP_DESKTOP === '1' };
}
