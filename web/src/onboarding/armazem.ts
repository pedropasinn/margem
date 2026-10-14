/**
 * Onde o estado dos primeiros passos fica guardado.
 *
 * Hoje o Margem é de um usuário só e as preferências da interface moram no navegador
 * (`margem:aparencia`, `margem:barra-lateral`…). O onboarding segue o mesmo caminho, com duas
 * diferenças pensadas para o beta com contas:
 *
 * - a chave carrega a versão do formato **e** o usuário: `margem:onboarding:v2:<usuario>`. Enquanto
 *   não houver contas, o usuário é `local`; quando houver, `usuarioAtual()` passa a devolver o id da
 *   conta e cada pessoa no mesmo navegador tem o seu progresso;
 * - quem lê e grava é um `ArmazemDoOnboarding`, não o componente. Um armazém do servidor
 *   (por exemplo `GET/PUT /api/preferencias/onboarding`) entra no lugar deste sem mexer na interface.
 */
import { VERSAO_DO_ONBOARDING, validarOnboarding, type EstadoDoOnboarding } from './estado';

export interface ArmazemDoOnboarding {
  /** `null` quando nada foi guardado ainda (primeira abertura). */
  ler(): EstadoDoOnboarding | null;
  gravar(estado: EstadoDoOnboarding): void;
}

/** O dono do progresso. Sem contas, todo mundo neste navegador é `local`. */
export function usuarioAtual(): string {
  return 'local';
}

export function chaveDoOnboarding(usuario: string, versao: number = VERSAO_DO_ONBOARDING): string {
  return `margem:onboarding:v${String(versao)}:${usuario}`;
}

/** Armazém no `localStorage`. Sem storage (modo privado restrito), vale o estado desta sessão. */
export function armazemLocal(usuario = usuarioAtual(), armazenamento: () => Storage = () => window.localStorage): ArmazemDoOnboarding {
  const chave = chaveDoOnboarding(usuario);
  return {
    ler() {
      try {
        // Sem o da versão atual, o da versão 1 (migrado por `validarOnboarding`); gravar já usa a chave nova.
        const bruto = armazenamento().getItem(chave) ?? armazenamento().getItem(chaveDoOnboarding(usuario, 1));
        return bruto === null ? null : validarOnboarding(JSON.parse(bruto));
      } catch { return null; }
    },
    gravar(estado) {
      try { armazenamento().setItem(chave, JSON.stringify(estado)); } catch { /* sem storage: só a sessão */ }
    },
  };
}

/** Armazém em memória, para testes e para a galeria. */
export function armazemEmMemoria(inicial: EstadoDoOnboarding | null = null): ArmazemDoOnboarding & { atual: EstadoDoOnboarding | null } {
  const armazem = {
    atual: inicial,
    ler: () => armazem.atual,
    gravar: (estado: EstadoDoOnboarding) => { armazem.atual = estado; },
  };
  return armazem;
}
