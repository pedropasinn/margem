import { expect, test } from 'vitest';
import { comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as jobsRepo from './jobs.js';

function entrada(chave: string, prioridade?: number): jobsRepo.EntradaJob {
  return { tipo: 'responder', dedup_key: chave, input_snapshot_hash: 'c'.repeat(64), ...(prioridade === undefined ? {} : { prioridade }) };
}

test('a fila entrega primeiro a maior prioridade e, empatando, o mais antigo', async () => {
  await comBanco('prioridade_ordem', async (banco) => {
    const antigo = await comTransacao(banco, (c) => jobsRepo.enfileirar(c, entrada('a')));
    const baixo = await comTransacao(banco, (c) => jobsRepo.enfileirar(c, entrada('b', jobsRepo.PRIORIDADE.reprocessamento)));
    const aberto = await comTransacao(banco, (c) => jobsRepo.enfileirar(c, entrada('c', jobsRepo.PRIORIDADE.capitulo_aberto)));
    const ordem: string[] = [];
    for (let i = 0; i < 3; i += 1) ordem.push((await jobsRepo.reservar(banco, 'w', ['responder']))?.id ?? '');
    expect(ordem).toEqual([aberto.id, antigo.id, baixo.id]);
  });
});

test('reenfileirar com prioridade maior sobe a do job pendente, nunca a baixa', async () => {
  await comBanco('prioridade_sobe', async (banco) => {
    const job = await comTransacao(banco, (c) => jobsRepo.enfileirar(c, entrada('x', 50)));
    const subiu = await comTransacao(banco, (c) => jobsRepo.enfileirar(c, entrada('x', 100)));
    expect(subiu.id).toBe(job.id);
    expect(subiu.prioridade).toBe(100);
    const igual = await comTransacao(banco, (c) => jobsRepo.enfileirar(c, entrada('x', 20)));
    expect(igual.prioridade).toBe(100);
    await expect(comTransacao(banco, (c) => jobsRepo.enfileirar(c, entrada('y', 101)))).rejects.toThrow('Prioridade');
  });
});
