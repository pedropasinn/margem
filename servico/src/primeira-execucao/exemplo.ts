/**
 * O documento de exemplo da primeira execução (J103): "Um apólogo", de Machado de Assis (domínio
 * público; a mesma transcrição de `web/src/onboarding/exemplo/um-apologo.md`), **já marcado**.
 *
 * Nada aqui chama o Codex nem o motor Python. O canônico foi gerado uma vez pelo motor (o mesmo
 * comando das capturas do onboarding) e está congelado em `exemplo/um-apologo.canonico.json`; o
 * teste `exemplo.test.ts` roda o motor de novo e confere que nada mudou. As marcas são dado
 * semeado (`exemplo/um-apologo.marcas.json`): citação literal + função + comentário, resolvidas pelo serviço como as de qualquer
 * importação (a citação precisa aparecer uma vez só no texto, ou a semeadura recusa).
 *
 * Para regenerar o canônico depois de mudar o motor ou o texto:
 *   PYTHONPATH=motor motor/.venv/bin/python -c "import sys; from pathlib import Path; \
 *     from margem_motor.ingest import canonizar; canonizar(Path(sys.argv[1]), 'md', Path(sys.argv[2]), \
 *     titulo='Um apólogo', autor='Machado de Assis', idioma='pt')" \
 *     servico/src/primeira-execucao/exemplo/um-apologo.md /tmp/exemplo
 *   e copie /tmp/exemplo/canonico.json para exemplo/um-apologo.canonico.json.
 */
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { CanonicoV1, Comentario, Funcao, Id, MarcaV1 } from '@margem/contratos';
import { validarCanonico } from '@margem/contratos';
import { resolverCitacao } from '@margem/core';
import { comTransacao } from '../db/transacao.js';
import { caminhoDoOriginal, pastaDoDocumento } from '../dados.js';
import { sha256Hex } from '../http/ingestao.js';
import { criarExecucaoDeImportacao } from '../leitura/importar.js';
import * as documentosRepo from '../repos/documentos.js';
import * as marcasRepo from '../repos/marcas.js';
import { sha256 } from '../executor/artefato.js';

/** Entra em `execucao_leitura.metodo_versao`: distingue estas marcas das de uma leitura do Codex. */
export const METODO_DO_EXEMPLO = 'exemplo-da-instalacao-2026-10-12';

const PASTA = new URL('./exemplo/', import.meta.url);

export interface MarcaDoExemplo {
  citacao: string;
  funcao: Funcao;
  comentario: Comentario;
}

/**
 * As marcas do exemplo, como uma leitura as deixaria: poucas, cada uma com uma nota curta. Moram em
 * `exemplo/um-apologo.marcas.json` (as capturas do web leem o mesmo arquivo).
 */
export const MARCAS_DO_EXEMPLO: readonly MarcaDoExemplo[] = JSON.parse(
  readFileSync(new URL('um-apologo.marcas.json', PASTA), 'utf8')) as MarcaDoExemplo[];

export async function originalDoExemplo(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL('um-apologo.md', PASTA)));
}

export async function canonicoDoExemplo(): Promise<CanonicoV1> {
  const bruto: unknown = JSON.parse(await readFile(new URL('um-apologo.canonico.json', PASTA), 'utf8'));
  if (!validarCanonico(bruto)) throw new Error('O canônico do exemplo é inválido.');
  return bruto;
}

/** Resolve cada marca no canônico. Citação ausente ou repetida é erro de quem escreveu o exemplo. */
export function resolverMarcasDoExemplo(
  canonico: CanonicoV1, versaoId: Id, execucaoId: Id, criada_em: string, novoId: () => Id = ulid,
): MarcaV1[] {
  return MARCAS_DO_EXEMPLO.map((marca) => {
    const blocos = canonico.blocos.filter((bloco) => bloco.texto.includes(marca.citacao));
    const bloco = blocos[0];
    if (blocos.length !== 1 || bloco === undefined) throw new Error(`Citação do exemplo fora de um bloco único: ${marca.citacao}`);
    const resolucao = resolverCitacao({ id: bloco.id, texto: bloco.texto, versao_id: versaoId }, { citacao: marca.citacao });
    if (!resolucao.ok) throw new Error(`Citação do exemplo ${resolucao.motivo}: ${marca.citacao}`);
    return {
      id: novoId(), ancora: resolucao.ancora, funcao: marca.funcao, subfaixas: [], comentario: marca.comentario,
      origem: 'importacao', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada',
      execucao_id: execucaoId, criada_em,
    };
  });
}

export interface ExemploSemeado {
  documento_id: Id;
  versao_id: Id;
  marcas: number;
  /** `false` quando o exemplo já existia e foi só reaproveitado. */
  criado: boolean;
}

/**
 * Garante o exemplo: devolve o já semeado (se o documento ainda existir) ou cria documento, versão e
 * marcas numa transação só. Duas chamadas simultâneas não duplicam: a linha de `instalacao` é
 * travada antes de olhar.
 */
export async function semearExemplo(banco: pg.Pool, opcoes: { agora?: () => Date } = {}): Promise<ExemploSemeado> {
  const [original, canonico] = await Promise.all([originalDoExemplo(), canonicoDoExemplo()]);
  if (sha256Hex(original) !== canonico.documento.sha256_original) throw new Error('O canônico do exemplo não é deste original.');
  const criada_em = (opcoes.agora ?? (() => new Date()))().toISOString();
  return comTransacao(banco, async (cliente) => {
    const linha = (await cliente.query<{ exemplo_documento_id: Id | null }>(
      'SELECT exemplo_documento_id FROM instalacao WHERE id FOR UPDATE')).rows[0];
    if (!linha) throw new Error('Tabela instalacao sem a linha única (migração 0026).');
    if (linha.exemplo_documento_id !== null) {
      const atual = (await cliente.query<{ versao_id: Id; marcas: number }>(
        `SELECT v.id AS versao_id, (SELECT count(*)::int FROM marca m WHERE m.versao_id=v.id AND m.visivel) AS marcas
         FROM versao_texto v WHERE v.documento_id=$1 ORDER BY v.numero DESC LIMIT 1`, [linha.exemplo_documento_id])).rows[0];
      if (atual) return { documento_id: linha.exemplo_documento_id, versao_id: atual.versao_id, marcas: atual.marcas, criado: false };
    }
    const documento = await documentosRepo.criar(cliente, {
      ...canonico.documento, origem_caminho: caminhoDoOriginal('0'.repeat(26), 'md'),
    });
    // O original fica na pasta de dados como o de qualquer envio.
    const caminho = caminhoDoOriginal(documento.id, 'md');
    await mkdir(pastaDoDocumento(documento.id), { recursive: true, mode: 0o700 });
    await writeFile(caminho, original, { mode: 0o600 });
    await cliente.query('UPDATE documento SET origem_caminho=$2 WHERE id=$1', [documento.id, caminho]);
    const versao = await documentosRepo.criarVersao(cliente, documento.id, canonico);
    const { execucao } = await criarExecucaoDeImportacao(
      cliente, versao.id, canonico, METODO_DO_EXEMPLO, sha256(JSON.stringify(MARCAS_DO_EXEMPLO)), opcoes);
    const marcas = resolverMarcasDoExemplo(canonico, versao.id, execucao.id, criada_em);
    await marcasRepo.publicarMarcas(cliente, versao.id, marcas);
    await cliente.query('UPDATE instalacao SET exemplo_documento_id=$1 WHERE id', [documento.id]);
    return { documento_id: documento.id, versao_id: versao.id, marcas: marcas.length, criado: true };
  });
}
