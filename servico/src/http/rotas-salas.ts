/**
 * Salas de teste, lado do dono (API principal, só na tailnet): criar, mudar, trocar a senha,
 * apagar, ver as respostas e exportar CSV. As rotas do testador moram no portão
 * (`servico/src/sala/portao.ts`), nunca aqui.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import { ulid } from 'ulid';
import { FORMULARIO_PADRAO_DA_SALA, type Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import * as salasRepo from '../repos/salas.js';
import { csvDasRespostas, csvDosComentarios } from '../sala/csv.js';
import { lerMudancaDaSala, lerNovaSala, senha as lerSenha } from '../sala/entrada.js';
import { relatorioDaSala } from '../sala/relatorio.js';
import { gerarSenha, gerarSlug, hashDaSenha } from '../sala/senha.js';
import { urlPublicaDoPortao } from '../sala/configuracao.js';
import { ErroDaApi } from './erros.js';

export interface DependenciasDasSalas {
  banco: pg.Pool;
  corpoJson: (c: { req: { raw: Request } }) => Promise<unknown>;
  exigirUlid: (valor: string, papel: string) => Id;
  novoId?: () => Id;
  novoSlug?: () => string;
}

function nomeDoArquivo(titulo: string, sufixo: string): string {
  const base = titulo.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '').replaceAll(/[^A-Za-z0-9]+/g, '-').replaceAll(/^-|-$/g, '').toLowerCase() || 'sala';
  return `${base.slice(0, 60)}-${sufixo}.csv`;
}

export function registrarRotasDasSalas(api: Hono, dependencias: DependenciasDasSalas): void {
  const { banco, corpoJson, exigirUlid } = dependencias;
  const novoId = dependencias.novoId ?? (() => ulid());
  const novoSlug = dependencias.novoSlug ?? gerarSlug;

  async function conferirDocumentos(documentos: readonly Id[]): Promise<void> {
    const faltam = await comTransacao(banco, (cliente) => salasRepo.documentosSemTexto(cliente, documentos));
    if (faltam.length > 0) throw new ErroDaApi(422, 'documento_sem_texto', 'Algum documento escolhido não existe ou ainda não tem texto.');
  }

  api.get('/api/salas', async (c) => {
    const salas = await comTransacao(banco, (cliente) => salasRepo.listar(cliente));
    return c.json({ salas, portao: urlPublicaDoPortao() });
  });

  api.post('/api/salas', async (c) => {
    const entrada = lerNovaSala(await corpoJson(c), FORMULARIO_PADRAO_DA_SALA);
    await conferirDocumentos(entrada.documentos);
    const senha = entrada.senha ?? gerarSenha();
    const senhaHash = await hashDaSenha(senha);
    const sala = await comTransacao(banco, (cliente) => salasRepo.criar(cliente, {
      id: novoId(), slug: novoSlug(), titulo: entrada.titulo, boas_vindas: entrada.boas_vindas, documentos: entrada.documentos,
      ativa: entrada.ativa, expira_em: entrada.expira_em, formulario: entrada.formulario, senha_hash: senhaHash,
    }));
    // A senha volta só nesta resposta: o banco guarda o hash.
    return c.json({ sala, senha, senha_gerada: entrada.senha === null, portao: urlPublicaDoPortao() }, 201);
  });

  api.get('/api/salas/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'sala');
    const guardada = await comTransacao(banco, (cliente) => salasRepo.obter(cliente, id));
    if (!guardada) throw new ErroDaApi(404, 'sala_inexistente');
    return c.json({ sala: guardada.sala, portao: urlPublicaDoPortao() });
  });

  api.patch('/api/salas/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'sala');
    const mudanca = lerMudancaDaSala(await corpoJson(c));
    if (mudanca.documentos) await conferirDocumentos(mudanca.documentos);
    const sala = await comTransacao(banco, (cliente) => salasRepo.atualizar(cliente, id, mudanca));
    if (!sala) throw new ErroDaApi(404, 'sala_inexistente');
    return c.json({ sala });
  });

  api.post('/api/salas/:id/senha', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'sala');
    const corpo = await corpoJson(c) as { senha?: unknown } | null;
    const digitada = corpo?.senha === undefined || corpo.senha === null || corpo.senha === '' ? null : lerSenha(corpo.senha);
    const senha = digitada ?? gerarSenha();
    const hash = await hashDaSenha(senha);
    if (!(await comTransacao(banco, (cliente) => salasRepo.trocarSenha(cliente, id, hash)))) throw new ErroDaApi(404, 'sala_inexistente');
    return c.json({ senha, senha_gerada: digitada === null });
  });

  api.delete('/api/salas/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'sala');
    if (!(await comTransacao(banco, (cliente) => salasRepo.apagar(cliente, id)))) throw new ErroDaApi(404, 'sala_inexistente');
    return c.json({ sala_id: id, apagada: true });
  });

  api.get('/api/salas/:id/respostas', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'sala');
    const relatorio = await comTransacao(banco, (cliente) => relatorioDaSala(cliente, id));
    if (!relatorio) throw new ErroDaApi(404, 'sala_inexistente');
    return c.json(relatorio);
  });

  for (const [rota, gerar, sufixo] of [['respostas.csv', csvDasRespostas, 'respostas'], ['comentarios.csv', csvDosComentarios, 'comentarios']] as const) {
    api.get(`/api/salas/:id/${rota}`, async (c) => {
      const id = exigirUlid(c.req.param('id'), 'sala');
      const relatorio = await comTransacao(banco, (cliente) => relatorioDaSala(cliente, id));
      if (!relatorio) throw new ErroDaApi(404, 'sala_inexistente');
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename="${nomeDoArquivo(relatorio.sala.titulo, sufixo)}"`);
      c.header('Cache-Control', 'no-store');
      return c.body(gerar(relatorio));
    });
  }
}
