/** Configuração da extensão em `storage.local` (o token não sincroniza entre aparelhos). */
import browser from 'webextension-polyfill';
import { SERVIDOR_PADRAO, normalizarServidor } from './servidor';
import type { Configuracao } from './tipos';

export async function lerConfiguracao(): Promise<Configuracao> {
  const salvo = await browser.storage.local.get(['servidor', 'token']);
  const servidor = typeof salvo.servidor === 'string' ? normalizarServidor(salvo.servidor) : null;
  return { servidor: servidor ?? SERVIDOR_PADRAO, token: typeof salvo.token === 'string' ? salvo.token : '' };
}

export async function gravarConfiguracao(configuracao: Configuracao): Promise<void> {
  await browser.storage.local.set({ servidor: configuracao.servidor, token: configuracao.token });
}

/**
 * A identificação do Margem que a extensão achou da última vez (V-W9). Com mais de um Margem
 * respondendo nas portas 8730–8739, ela fica com este.
 */
export async function lerInstanciaConhecida(): Promise<string | null> {
  const salvo = await browser.storage.local.get(['instancia']);
  return typeof salvo.instancia === 'string' && salvo.instancia !== '' ? salvo.instancia : null;
}

export async function gravarInstanciaConhecida(instancia: string | null): Promise<void> {
  if (instancia === null) return;
  await browser.storage.local.set({ instancia });
}
