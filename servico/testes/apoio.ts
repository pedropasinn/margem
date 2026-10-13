import { readFileSync, statSync } from 'node:fs';
import type pg from 'pg';
import type { Bloco, CanonicoV1, Id, Secao } from '@margem/contratos';
import { hashEstrutural, validarCanonico } from '@margem/contratos';
import { comBancoDeTeste } from '../src/db/conexao.js';
import { migrar } from '../src/db/migrar.js';
import type { TextosDoPacote, VersoesDoPacote } from '../src/leitura/pacote.js';
import type { TextosDaRevisao } from '../src/leitura/manipuladores.js';

/** ULID determinístico e legível: `0…B0001`. Só dígitos e a letra do prefixo. */
export function idTeste(prefixo: string, numero: number): Id {
  // Crockford não tem I, L, O nem U: um prefixo fora do alfabeto produziria ULID inválido.
  if (!/^[0-9A-HJKMNP-TV-Z]$/.test(prefixo.toUpperCase())) throw new Error(`Prefixo fora do alfabeto ULID: ${prefixo}`);
  return `0${`${prefixo}${String(numero).padStart(4, '0')}`.toUpperCase().padStart(25, '0')}`;
}

/** Gerador determinístico para injetar em `novoId`. */
export function contadorDeIds(prefixo: string, inicio = 1): () => Id {
  let n = inicio;
  return () => idTeste(prefixo, n++);
}

export interface BlocoDeTeste {
  tipo: Bloco['tipo'];
  texto: string;
}

export interface SecaoDeTeste {
  nivel: number;
  /** Índices (base 0) na lista de blocos. */
  inicio: number;
  fim: number;
}

export interface CanonicoDeTeste {
  blocos: BlocoDeTeste[];
  secoes?: SecaoDeTeste[];
  titulo?: string;
  idioma?: string;
}

/** Canônico determinístico e válido pelas invariantes do J01. */
export function canonicoDeTeste(entrada: CanonicoDeTeste): CanonicoV1 {
  const blocos: Bloco[] = entrada.blocos.map((bloco, ordem) => ({
    id: idTeste('B', ordem), ordem, tipo: bloco.tipo, texto: bloco.texto, inline: [],
    origens: [{ tipo: 'texto', linha_inicio: ordem + 1, linha_fim: ordem + 1 }],
  }));
  const secoes: Secao[] = (entrada.secoes ?? []).map((secao, ordem) => ({
    id: idTeste('S', ordem), nivel: secao.nivel,
    titulo: blocos[secao.inicio]?.texto ?? '', ordem,
    bloco_inicio: blocos[secao.inicio]?.id ?? '', bloco_fim: blocos[secao.fim]?.id ?? '',
  }));
  const canonico: CanonicoV1 = {
    versao: 1,
    documento: {
      titulo: entrada.titulo ?? 'Documento de teste', idioma: entrada.idioma ?? 'pt-BR',
      formato: 'colado', sha256_original: 'a'.repeat(64),
    },
    canonizacao: { motor: 'teste/1', gerado_em: '2026-09-20T00:00:00.000Z' },
    hash_estrutural: hashEstrutural(blocos),
    secoes, blocos, assets: [], limites: [],
  };
  if (!validarCanonico(canonico)) throw new Error('Canônico de teste inválido.');
  return canonico;
}

export function comBanco(nome: string, fn: (banco: pg.Pool) => Promise<void>): Promise<void> {
  return comBancoDeTeste(nome, async (banco) => { await migrar(banco); await fn(banco); });
}

function daRaiz(caminho: string): URL {
  return new URL(`../../${caminho}`, import.meta.url);
}

export const VERSOES: VersoesDoPacote = {
  metodo_versao: 'metodo@1', prompt_versao: 'leitor-de-parte@1', schema_versao: 1,
};

export function textosDoPrompt(): TextosDoPacote {
  return {
    metodo: readFileSync(daRaiz('prompts/metodo-leitor.md'), 'utf8'),
    prompt: readFileSync(daRaiz('prompts/leitor-de-parte@1.md'), 'utf8'),
    schema: readFileSync(daRaiz('prompts/leitor-de-parte@1.schema.json'), 'utf8'),
  };
}

export function caminhoDoSchemaDoLeitor(): string {
  return daRaiz('prompts/leitor-de-parte@1.schema.json').pathname;
}

export function textosDaRevisao(): TextosDaRevisao {
  return {
    metodo: readFileSync(daRaiz('prompts/metodo-leitor.md'), 'utf8'),
    prompt: readFileSync(daRaiz('prompts/revisao-consistencia@1.md'), 'utf8'),
    schema: readFileSync(daRaiz('prompts/revisao-consistencia@1.schema.json'), 'utf8'),
    caminhoSchema: daRaiz('prompts/revisao-consistencia@1.schema.json').pathname,
  };
}

export function caminhoDoRoteiro(nome: string): string {
  return daRaiz(`fixtures/codex/leitura/${nome}.json`).pathname;
}

export function manifesto(): { materiais: { caminho: string; papel: string; sha256: string }[] } {
  return JSON.parse(readFileSync(daRaiz('fixtures/manifest.json'), 'utf8')) as {
    materiais: { caminho: string; papel: string; sha256: string }[];
  };
}

/** Caminho de um material do manifesto, ou `undefined` se ausente do disco. */
export function material(papel: string, sufixo?: string): string | undefined {
  const achado = manifesto().materiais.find((item) =>
    item.papel === papel && (sufixo === undefined || item.caminho.endsWith(sufixo)));
  if (!achado) return undefined;
  try {
    statSync(achado.caminho);
    return achado.caminho;
  } catch {
    return undefined;
  }
}
