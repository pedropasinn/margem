/**
 * Renderer da janela de abertura. Dois modos (`?modo=`): `boas-vindas` (pasta → ChatGPT → abrir) e
 * `carregando` (só o progresso de uma biblioteca já configurada). Tudo por textContent.
 */
import type { ApiDaAbertura, EventoDoLoginNaJanela } from './contrato.js';

declare global {
  interface Window { margem: ApiDaAbertura }
}

const api = window.margem;

function elemento<T extends HTMLElement = HTMLElement>(id: string): T {
  const achado = document.getElementById(id);
  if (achado === null) throw new Error(`Elemento ausente: ${id}`);
  return achado as T;
}

const secoes = ['carregando', 'passo-pasta', 'passo-login', 'passo-fim'] as const;
function mostrar(secao: (typeof secoes)[number]): void {
  for (const id of secoes) elemento(id).hidden = id !== secao;
  const foco = elemento(secao).querySelector<HTMLElement>('.botao.primario');
  foco?.focus();
}

let pasta = '';
let logado = false;
let link: string | null = null;

async function mostrarPasta(caminho: string): Promise<void> {
  pasta = caminho;
  elemento('caminho-da-pasta').textContent = caminho;
  const avaliacao = await api.avaliarPasta(caminho);
  elemento('nota-da-pasta').textContent = avaliacao.temBiblioteca
    ? 'Esta pasta já tem uma biblioteca do Margem: ela será aberta como está.'
    : !avaliacao.existe
      ? 'A pasta será criada.'
      : avaliacao.temOutrosArquivos
        ? 'A pasta já tem outros arquivos; eles ficam onde estão.'
        : '';
}

function textoDoLogin(estado: { encontrado: boolean; logado: boolean | null; conta: string | null; falha?: { mensagem: string } }): { texto: string; ok: boolean | null } {
  // W-06: a CLI não rodou (ausente, barrada pelo antivírus, sem resposta): a frase diz qual e o que fazer.
  if (estado.falha !== undefined) return { texto: estado.falha.mensagem, ok: false };
  if (!estado.encontrado) return { texto: 'O Codex não veio com esta instalação. Você pode entrar depois, pelas Configurações.', ok: false };
  if (estado.logado === true && estado.conta === 'chave_api') return { texto: 'Conectado com uma chave de API (o Margem foi pensado para a conta do ChatGPT).', ok: true };
  if (estado.logado === true) return { texto: 'Conectado à sua conta do ChatGPT.', ok: true };
  if (estado.logado === false) return { texto: 'Ainda não conectado.', ok: null };
  return { texto: 'Não foi possível verificar o login agora.', ok: false };
}

async function atualizarLogin(): Promise<void> {
  const estado = await api.estadoDoLogin();
  const { texto, ok } = textoDoLogin(estado);
  const caixa = elemento('estado-login');
  caixa.textContent = texto;
  if (ok === null) delete caixa.dataset.ok; else caixa.dataset.ok = String(ok);
  logado = estado.logado === true;
  elemento<HTMLButtonElement>('entrar').disabled = !estado.encontrado;
  elemento<HTMLButtonElement>('entrar-dispositivo').disabled = !estado.encontrado;
  // Logado, "Continuar" é a ação do passo: vira o botão principal no lugar de "Entrar".
  const pular = elemento('pular-login');
  pular.textContent = logado ? 'Continuar' : 'Agora não';
  pular.classList.toggle('primario', logado);
  pular.classList.toggle('ghost', !logado);
  elemento('entrar').hidden = logado;
  elemento('entrar-dispositivo').hidden = logado;
  if (logado && !elemento('passo-login').hidden) pular.focus();
}

function irParaFim(): void {
  elemento('resumo-fim').textContent = `A biblioteca fica em ${pasta}. ${logado
    ? 'O ChatGPT está conectado.'
    : 'Sem o ChatGPT, os seus documentos entram e podem ser lidos; as marcas esperam o login (Configurações).'}`;
  elemento('erro-fim').hidden = true;
  mostrar('passo-fim');
}

async function entrar(dispositivo: boolean): Promise<void> {
  link = null;
  elemento('caixa-link').hidden = true;
  elemento('caixa-dispositivo').hidden = true;
  const caixa = elemento('estado-login');
  caixa.textContent = dispositivo ? 'Gerando o código…' : 'Abrindo o navegador… termine o login por lá.';
  delete caixa.dataset.ok;
  for (const id of ['entrar', 'entrar-dispositivo']) elemento<HTMLButtonElement>(id).disabled = true;
  await api.entrar(dispositivo);
  await atualizarLogin();
  if (logado) irParaFim();
}

api.aoLogin((evento: EventoDoLoginNaJanela) => {
  if (evento.tipo === 'link' && evento.valor) {
    link = evento.valor;
    elemento('caixa-link').hidden = false;
  }
  if (evento.tipo === 'codigo' && evento.valor) {
    elemento('codigo-dispositivo').textContent = evento.valor;
    elemento('caixa-dispositivo').hidden = false;
    elemento('estado-login').textContent = 'Esperando você digitar o código no navegador…';
  }
  if (evento.tipo === 'falhou') {
    const caixa = elemento('estado-login');
    caixa.textContent = evento.valor ?? 'O login não terminou.';
    caixa.dataset.ok = 'false';
  }
});

api.aoProgresso((etapa) => {
  elemento('etapa-carregando').textContent = `${etapa}…`;
  const fim = elemento('etapa-fim');
  fim.textContent = `${etapa}…`;
  fim.hidden = false;
});

async function concluir(): Promise<void> {
  const botao = elemento<HTMLButtonElement>('abrir-biblioteca');
  botao.disabled = true;
  elemento<HTMLButtonElement>('voltar-fim').disabled = true;
  elemento('erro-fim').hidden = true;
  const resultado = await api.concluir(pasta);
  if (!resultado.ok) {
    const erro = elemento('erro-fim');
    erro.textContent = resultado.mensagem;
    erro.hidden = false;
    elemento('etapa-fim').hidden = true;
    botao.disabled = false;
    elemento<HTMLButtonElement>('voltar-fim').disabled = false;
  }
}

function ligar(): void {
  elemento('escolher-pasta').addEventListener('click', () => {
    void api.escolherPasta(pasta).then((escolhida) => (escolhida === null ? undefined : mostrarPasta(escolhida)));
  });
  elemento('continuar-pasta').addEventListener('click', () => { mostrar('passo-login'); void atualizarLogin(); });
  elemento('entrar').addEventListener('click', () => { void entrar(false); });
  elemento('entrar-dispositivo').addEventListener('click', () => { void entrar(true); });
  elemento('pular-login').addEventListener('click', () => { void api.cancelarLogin(); irParaFim(); });
  elemento('abrir-link').addEventListener('click', () => { if (link !== null) void api.abrirLink(link); });
  // "Voltar" do fim volta ao passo anterior, o do login (não ao da pasta).
  elemento('voltar-fim').addEventListener('click', () => { mostrar('passo-login'); void atualizarLogin(); });
  elemento('abrir-biblioteca').addEventListener('click', () => { void concluir(); });
}

const modo = new URLSearchParams(location.search).get('modo');
if (modo === 'carregando') {
  mostrar('carregando');
} else {
  ligar();
  mostrar('passo-pasta');
  void api.pastaPadrao().then(mostrarPasta);
}
