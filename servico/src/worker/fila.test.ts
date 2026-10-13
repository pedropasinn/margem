import { expect, test } from 'vitest';
import { ConcessaoPerdida, FilaEmMemoria } from './fila.js';
import type { JobResultV1 } from '@margem/contratos';

function resultado(job_id: string, lease_token: string, attempt: number): JobResultV1 {
  return { job_id, attempt, lease_token, estado: 'falhou', diagnosticos: [], duracao_ms: 1 };
}

test('reservar entrega o job uma única vez e incrementa a tentativa', async () => {
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({ tipo: 'teste' });
  const primeiras = await fila.reservar('a', ['teste'], 5);
  const segundas = await fila.reservar('b', ['teste'], 5);
  expect(primeiras).toHaveLength(1);
  expect(segundas).toHaveLength(0);
  expect(primeiras[0]?.job.id).toBe(job.id);
  expect(primeiras[0]?.job.attempt).toBe(1);
});

test('reservar respeita o tipo e o not_before', async () => {
  const fila = new FilaEmMemoria();
  fila.enfileirar({ tipo: 'outro' });
  fila.enfileirar({ tipo: 'teste', not_before: new Date(Date.now() + 60_000) });
  expect(await fila.reservar('a', ['teste'], 5)).toHaveLength(0);
});

test('a concessão expirada devolve o job à fila com attempt+1 e recusa publicar', async () => {
  const fila = new FilaEmMemoria({ concessaoMs: 10 });
  fila.enfileirar({ tipo: 'teste' });
  const concessao = (await fila.reservar('a', ['teste']))[0];
  expect(concessao).toBeDefined();
  if (!concessao) return;
  await new Promise((r) => setTimeout(r, 30));
  expect(await fila.expirarConcessoes()).toBe(1);
  expect(fila.ler(concessao.job.id)?.attempt).toBe(2);

  await expect(fila.publicar(concessao.job.id, concessao.lease_token, () =>
    Promise.resolve(resultado(concessao.job.id, concessao.lease_token, 1)))).rejects.toBeInstanceOf(ConcessaoPerdida);
  expect(fila.publicados).toHaveLength(0);

  const outra = (await fila.reservar('b', ['teste']))[0];
  expect(outra?.lease_token).not.toBe(concessao.lease_token);
});

test('uma tentativa com token errado nunca publica', async () => {
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({ tipo: 'teste' });
  await fila.reservar('a', ['teste']);
  await expect(fila.publicar(job.id, '00000000000000000000000000', () =>
    Promise.resolve(resultado(job.id, '00000000000000000000000000', 1)))).rejects.toBeInstanceOf(ConcessaoPerdida);
});

test('publicação com efeito que falha faz rollback e não conclui o job', async () => {
  const fila = new FilaEmMemoria();
  fila.enfileirar({ tipo: 'teste' });
  const concessao = (await fila.reservar('a', ['teste']))[0];
  if (!concessao) throw new Error('sem concessão');
  await expect(fila.publicar(concessao.job.id, concessao.lease_token, () =>
    Promise.reject(new Error('gravação falhou')))).rejects.toThrow('gravação falhou');
  expect(fila.publicados).toHaveLength(0);
  expect(fila.ler(concessao.job.id)?.estado).toBe('reservado');
  // A concessão continua válida: a tentativa pode encerrar como falha.
  await fila.falhar(concessao.job.id, concessao.lease_token, resultado(concessao.job.id, concessao.lease_token, 1));
  expect(fila.ler(concessao.job.id)?.estado).toBe('falhou');
});

test('heartbeat renova a concessão e denuncia o cancelamento pedido', async () => {
  const fila = new FilaEmMemoria({ concessaoMs: 1_000 });
  fila.enfileirar({ tipo: 'teste' });
  const concessao = (await fila.reservar('a', ['teste']))[0];
  if (!concessao) throw new Error('sem concessão');
  await new Promise((r) => setTimeout(r, 30));
  const primeiro = await fila.heartbeat(concessao.job.id, concessao.lease_token);
  expect(primeiro.cancelamento_pedido).toBe(false);
  expect(primeiro.lease_expires_at.getTime()).toBeGreaterThan(concessao.lease_expires_at.getTime());
  await fila.pedirCancelamento(concessao.job.id);
  expect((await fila.heartbeat(concessao.job.id, concessao.lease_token)).cancelamento_pedido).toBe(true);
});

test('adiar devolve o job com not_before e sem gastar tentativa', async () => {
  const fila = new FilaEmMemoria();
  fila.enfileirar({ tipo: 'teste' });
  const concessao = (await fila.reservar('a', ['teste']))[0];
  if (!concessao) throw new Error('sem concessão');
  const volta = new Date(Date.now() + 3_600_000);
  await fila.adiar(concessao.job.id, concessao.lease_token, {
    job_id: concessao.job.id, attempt: 1, lease_token: concessao.lease_token,
    estado: 'adiado', not_before: volta.toISOString(), diagnosticos: [], duracao_ms: 5,
  });
  const lido = fila.ler(concessao.job.id);
  expect(lido?.estado).toBe('pendente');
  expect(lido?.attempt).toBe(0);
  expect(lido?.not_before?.toISOString()).toBe(volta.toISOString());
  expect(await fila.reservar('b', ['teste'])).toHaveLength(0);
});

test('dedup_key impede um segundo job vivo para a mesma entrada', () => {
  const fila = new FilaEmMemoria();
  fila.enfileirar({ tipo: 'teste', dedup_key: 'versao:1/parte:3' });
  expect(() => fila.enfileirar({ tipo: 'teste', dedup_key: 'versao:1/parte:3' })).toThrow('Job duplicado');
});
