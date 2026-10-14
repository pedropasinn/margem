import type { ReactNode } from 'react';
import { Cabecalho, Rodape } from '../componentes/Moldura';
import { CONFIG } from '../config';

export interface Secao { titulo: string; paragrafos: string[] }

/** Página de texto jurídico. Enquanto não houver revisão, toda página leva o aviso de rascunho. */
export function PaginaLegal({ titulo, atualizado, secoes }: { titulo: string; atualizado: string; secoes: readonly Secao[] }): ReactNode {
  return (
    <>
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <Cabecalho />
      <main id="conteudo" className="legal">
        <article className="container legal-coluna">
          <p className="rascunho" role="note">
            <strong>Rascunho — revisar com advogado.</strong> Este texto ainda não vale como documento jurídico do {CONFIG.nome}. Serve para orientar a conversa sobre o que o app promete.
          </p>
          <h1>{titulo}</h1>
          <p className="legal-data">Versão de rascunho · {atualizado}</p>
          {secoes.map((secao) => (
            <section key={secao.titulo}>
              <h2>{secao.titulo}</h2>
              {secao.paragrafos.map((p) => <p key={p}>{p}</p>)}
            </section>
          ))}
        </article>
      </main>
      <Rodape />
    </>
  );
}

const N = CONFIG.nome;

export const PRIVACIDADE: readonly Secao[] = [
  { titulo: 'Em resumo', paragrafos: [
    `O ${N} é um programa que você instala no seu computador. Os seus documentos, marcas, notas, conversas e o progresso de leitura ficam no seu computador, na pasta da biblioteca que você escolheu. Nós não temos servidor que receba nem guarde a sua biblioteca, e não temos acesso a ela.`,
  ] },
  { titulo: 'Quem é o responsável', paragrafos: [
    '[A definir: pessoa ou empresa responsável pelo site e pela distribuição do app, com endereço e documento.]',
  ] },
  { titulo: 'O que sai do seu computador', paragrafos: [
    `Leitura por IA: para marcar o texto, escrever as notas da margem e responder às suas perguntas, o ${N} usa o Codex, com a conta do ChatGPT que você conectou. Os trechos necessários vão da sua instalação para a OpenAI, pela sua conta, e seguem os termos e a política de privacidade da OpenAI para essa conta, inclusive quanto a retenção e treinamento. Nós não ficamos no meio nem recebemos cópia.`,
    'Áudio (opcional): se você colar a sua chave da ElevenLabs nas Configurações, o texto que você mandar narrar vai para a ElevenLabs, que gera o áudio. Vale a política da ElevenLabs para a sua conta. A chave fica guardada só no seu computador.',
    'Extensão de navegador e plugin do Obsidian: falam só com o endereço que você configurar, por padrão o app no seu próprio computador. Não mandam nada para nós.',
    'Atualizações: o app consulta o GitHub, onde as versões são publicadas, para saber se há versão nova e baixá-la. Essa consulta leva o endereço IP e os dados técnicos de qualquer acesso a um site, e nada da sua biblioteca. Vale a política de privacidade do GitHub. [A definir: confirmar com o empacotamento final.]',
  ] },
  { titulo: 'O que não fazemos', paragrafos: [
    'O app não envia métricas de uso, registros de erro nem conteúdo para nós. Não há conta no app, publicidade ou rastreamento.',
  ] },
  { titulo: 'Este site', paragrafos: [
    'O site não tem formulário, cookies de rastreamento nem ferramenta de métricas. As fontes vêm do Google Fonts, que recebe o endereço IP de quem abre a página.',
    '[A definir: provedor de hospedagem do site e os registros de acesso que ele guarda, com prazo.]',
  ] },
  { titulo: 'Quando você fala conosco', paragrafos: [
    'Se você relatar um problema ou mandar um e-mail, recebemos o que você escrever e o seu contato, e usamos só para responder e corrigir o problema. Relatos públicos no repositório ficam visíveis para todos: não inclua textos dos seus documentos. [A definir: prazo de guarda dos e-mails.]',
  ] },
  { titulo: 'Seus dados, seu controle', paragrafos: [
    'Você pode copiar, exportar ou apagar a sua biblioteca a qualquer momento, porque ela está no seu computador. Desinstalar com a remoção dos dados apaga tudo de forma definitiva.',
    'Pela Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode pedir acesso, correção e eliminação dos dados que tivermos sobre você (por exemplo, de um contato por e-mail). [A definir: e-mail de contato @margem.dev] [A definir: encarregado.]',
  ] },
  { titulo: 'Mudanças', paragrafos: [
    'Se esta política mudar de forma relevante, a mudança é anunciada nesta página e em Novidades antes de valer.',
  ] },
];

export const TERMOS: readonly Secao[] = [
  { titulo: 'O que é o app', paragrafos: [
    `O ${N} é um programa de código aberto que você instala e roda no seu próprio computador. O código é distribuído sob a licença ${CONFIG.licenca}, que regula cópia, modificação e redistribuição. Estes termos tratam do uso do app distribuído por nós e deste site.`,
    'O app é oferecido como está, sem garantia de funcionamento contínuo ou de adequação a um uso específico, nos limites da lei. [A definir com advogado: limitação de responsabilidade compatível com a licença e com o Código de Defesa do Consumidor.]',
  ] },
  { titulo: 'Custos', paragrafos: [
    'O app é gratuito. Os serviços de terceiros que você conectar são contratados por você, direto com eles: a assinatura do ChatGPT usada pelo Codex e, se você ligar o áudio, a conta da ElevenLabs. Os custos, limites e cotas desses serviços são os do seu plano.',
  ] },
  { titulo: 'Contas de terceiros', paragrafos: [
    'Você responde pelo uso das suas contas da OpenAI e da ElevenLabs conforme os termos de cada uma, e pela guarda das credenciais na sua instalação.',
  ] },
  { titulo: 'Seus textos', paragrafos: [
    'Os documentos que você põe no app continuam seus e ficam com você. Você declara ter o direito de usá-los para a sua leitura pessoal.',
    'Não use o app para distribuir obras de terceiros nem para publicar conteúdo ilícito.',
  ] },
  { titulo: 'O que a IA produz', paragrafos: [
    'Marcas, notas, respostas e narrações são geradas por modelos de IA e podem conter erros. Elas acompanham a leitura e não substituem a leitura do texto original nem a orientação de um professor ou especialista.',
  ] },
  { titulo: 'Backups', paragrafos: [
    'Como a biblioteca fica no seu computador, guardar cópias dela é responsabilidade de quem instala. A documentação explica como fazer.',
  ] },
  { titulo: 'Nome e marca', paragrafos: [
    `[A definir: regras de uso da marca Margem por versões modificadas.]`,
  ] },
  { titulo: 'Lei e foro', paragrafos: [
    '[A definir com advogado: legislação aplicável, foro e identificação do responsável pela distribuição.]',
  ] },
];
