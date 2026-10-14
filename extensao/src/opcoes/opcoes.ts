/** Página de opções: endereço do servidor, token e teste de conexão. */
import browser from 'webextension-polyfill';
import { gravarConfiguracao, lerConfiguracao } from '../configuracao';
import { SERVIDOR_PADRAO, normalizarServidor, permissaoDeHost, textoDaConexao, type Conexao } from '../servidor';
import type { Configuracao, Pedido, Resposta } from '../tipos';

function el<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (elemento === null) throw new Error(`#${id} ausente`);
  return elemento as T;
}

function avisar(texto: string, tipo: 'erro' | 'sucesso' | 'neutro'): void {
  const aviso = el<HTMLParagraphElement>('aviso');
  aviso.hidden = false;
  aviso.dataset.tipo = tipo;
  aviso.textContent = texto;
}

function lerFormulario(): Configuracao | null {
  const servidor = normalizarServidor(el<HTMLInputElement>('servidor').value);
  if (servidor === null) {
    el('servidor').setAttribute('aria-invalid', 'true');
    avisar('Endereço inválido: use http:// ou https:// e só o endereço do servidor.', 'erro');
    return null;
  }
  el('servidor').removeAttribute('aria-invalid');
  return { servidor, token: el<HTMLInputElement>('token').value.trim() };
}

/**
 * Servidor fora de localhost: pede a permissão de host só para ele. Precisa ser chamada direto no
 * clique (gesto do usuário), antes de qualquer `await`. Recusar não impede o uso: aí o navegador
 * aplica CORS e o Margem precisa ter a origem desta extensão em MARGEM_EXTENSOES (como sempre).
 */
function pedirPermissao(servidor: string): Promise<boolean> {
  const padrao = permissaoDeHost(servidor);
  if (padrao === null) return Promise.resolve(true);
  return browser.permissions.request({ origins: [padrao] }).catch(() => false);
}

const SEM_PERMISSAO = ' Sem a permissão para este endereço, os erros de conexão ficam menos precisos.';

async function iniciar(): Promise<void> {
  el('padrao').textContent = SERVIDOR_PADRAO;
  el('origem').textContent = location.origin;
  const atual = await lerConfiguracao();
  el<HTMLInputElement>('servidor').value = atual.servidor;
  el<HTMLInputElement>('token').value = atual.token;

  el<HTMLFormElement>('formulario').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const configuracao = lerFormulario();
    if (configuracao === null) return;
    const permissao = pedirPermissao(configuracao.servidor);
    void permissao.then(async (concedida) => {
      await gravarConfiguracao(configuracao);
      avisar(concedida ? 'Salvo.' : `Salvo.${SEM_PERMISSAO}`, 'sucesso');
    });
  });

  el('testar').addEventListener('click', () => {
    const configuracao = lerFormulario();
    if (configuracao === null) return;
    avisar('Testando…', 'neutro');
    const pedido: Pedido = { tipo: 'testar', configuracao };
    void pedirPermissao(configuracao.servidor).then(() => browser.runtime.sendMessage(pedido)).then((bruto: unknown) => {
      const resposta = bruto as Resposta<Conexao>;
      if (resposta.ok) avisar(textoDaConexao(resposta.valor), 'sucesso');
      else avisar(resposta.erro, 'erro');
    });
  });
}

void iniciar();
