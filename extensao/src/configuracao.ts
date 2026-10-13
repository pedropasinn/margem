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
