import { useState, type ReactNode } from 'react';
import '../estilos/app-embutido.css';
import { SessaoDeResolucao, type FontesDaSessao } from '@app/leitor/resolucao/SessaoDeResolucao';
import '@app/leitor/resolucao/resolucao.css';
import { ID_DA_SESSAO, PRINT_DA_QUESTAO, SESSAO } from '../demo/exercicio';

/*
 * O painel de resolução do app (`web/src/leitor/resolucao/SessaoDeResolucao.tsx`: a imagem do
 * recorte, a ideia e os passos revelados um a um, a resposta, a conferência, a conversa e os botões do
 * rodapé), alimentado pela sessão de `demo/exercicio.ts` em vez da API. Ao lado, a página que o app cria
 * a partir do print colado (J119): a própria imagem, numa folha. Perguntar de verdade precisa do Codex:
 * aqui a pergunta nova volta com o aviso.
 */
const FONTES: FontesDaSessao = {
  obter: () => Promise.resolve(SESSAO),
  perguntar: () => Promise.reject(new Error('No app, a pergunta vai ao Codex pela sua conta e a resposta aparece aqui, presa à resolução.')),
  tentarDeNovo: () => Promise.resolve(null),
  imagem: () => PRINT_DA_QUESTAO,
};

export default function DemoDoExercicio(): ReactNode {
  const [aberta, abrir] = useState(true);
  return (
    <div className="app-embutido demo-app demo-do-exercicio">
      <div className="exercicio-pagina">
        <p className="exercicio-origem">Questão de 13/10/2026 · colada com <kbd>Ctrl</kbd>+<kbd>V</kbd></p>
        <img className="exercicio-folha" src={PRINT_DA_QUESTAO} alt="O print da questão 7: calcule as integrais de 0 a 1 de x vezes e elevado a x, e de x vezes logaritmo de x." width={1120} height={420} />
        {!aberta && <button type="button" className="botao pequeno" onClick={() => { abrir(true); }}>Abrir a resolução</button>}
      </div>
      {aberta && <SessaoDeResolucao id={ID_DA_SESSAO} fontes={FONTES} aoFechar={() => { abrir(false); }} atalhosSoComFoco />}
    </div>
  );
}
