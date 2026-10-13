/** Popup: prévia do que foi detectado na aba e os dois botões de envio. */
import browser from 'webextension-polyfill';
import type { Captura, Enviado, Pedido, Resposta } from '../tipos';

function el<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (elemento === null) throw new Error(`#${id} ausente`);
  return elemento as T;
}

async function pedir<T>(pedido: Pedido): Promise<Resposta<T>> {
  const resposta: unknown = await browser.runtime.sendMessage(pedido);
  return resposta as Resposta<T>;
}

function avisar(texto: string, tipo: 'erro' | 'sucesso' | 'neutro', link?: { href: string; rotulo: string }): void {
  const aviso = el<HTMLParagraphElement>('aviso');
  aviso.hidden = false;
  aviso.dataset.tipo = tipo;
  aviso.replaceChildren(document.createTextNode(texto));
  if (link !== undefined) {
    const a = document.createElement('a');
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = link.rotulo;
    aviso.append(' ', a);
  }
}

function descrever(captura: Captura): string {
  const partes: string[] = [];
  if (captura.tipo === 'pdf') partes.push('PDF — vai como o original');
  if (captura.tipo !== 'pdf' && captura.autor) partes.push(captura.autor);
  if (captura.site) partes.push(captura.site);
  if (captura.tipo !== 'pdf') {
    partes.push(`${captura.palavras.toLocaleString('pt-BR')} ${captura.palavras === 1 ? 'palavra' : 'palavras'}`);
    if (captura.tipo === 'selecao') partes.push('trecho');
  }
  return partes.join(' · ');
}

async function iniciar(): Promise<void> {
  el('opcoes').addEventListener('click', (evento) => { evento.preventDefault(); void browser.runtime.openOptionsPage(); });
  // `?aba=<id>` abre a prévia de uma aba específica (o popup aberto numa aba, no teste de ponta a ponta).
  const pedida = Number.parseInt(new URLSearchParams(location.search).get('aba') ?? '', 10);
  const [aba] = Number.isInteger(pedida) ? [await browser.tabs.get(pedida)] : await browser.tabs.query({ active: true, currentWindow: true });
  if (aba?.id === undefined) { el('carregando').textContent = 'Nenhuma aba ativa.'; return; }
  const abaId = aba.id;
  const resposta = await pedir<Captura>({ tipo: 'capturar', aba: abaId });
  el('carregando').hidden = true;
  if (!resposta.ok) { avisar(resposta.erro, 'erro'); return; }
  const captura = resposta.valor;
  el('captura').hidden = false;
  el('titulo').textContent = captura.titulo;
  el('meta').textContent = descrever(captura);
  el('previa').textContent = captura.tipo === 'pdf' ? captura.url : captura.previa;

  const botoes = [el<HTMLButtonElement>('enviar'), el<HTMLButtonElement>('enviar-abrir')];
  const enviar = async (abrir: boolean): Promise<void> => {
    botoes.forEach((botao) => { botao.disabled = true; });
    avisar('Enviando…', 'neutro');
    const resultado = await pedir<Enviado>({ tipo: 'enviar', captura, aba: abaId, abrir });
    if (resultado.ok) {
      avisar('Enviado. O Margem está preparando o texto.', 'sucesso', { href: resultado.valor.endereco, rotulo: 'Abrir no Margem' });
      document.body.dataset.enviado = resultado.valor.documento_id;
    } else {
      avisar(resultado.erro, 'erro');
      botoes.forEach((botao) => { botao.disabled = false; });
    }
  };
  botoes[0]!.addEventListener('click', () => { void enviar(false); });
  botoes[1]!.addEventListener('click', () => { void enviar(true); });
  botoes[0]!.focus();
}

void iniciar().catch((erro: unknown) => {
  el('carregando').hidden = true;
  avisar(erro instanceof Error ? erro.message : 'Falha inesperada.', 'erro');
});
