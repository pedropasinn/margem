import type { Caminho, DiagnosticoContrato } from './contrato';

/** Limite defensivo da API em memória; orçamentos de bytes/itens pertencem ao serviço. */
export const PROFUNDIDADE_MAXIMA_DO_CONTRATO = 64;

/** Antes de Ajv, Unicode e clone. Aliases sem ciclo continuam permitidos. */
export function conferirEntrada(valor: unknown): DiagnosticoContrato[] {
  const erro = (codigo: string, mensagem: string, caminho: Caminho): DiagnosticoContrato[] => [{ codigo, mensagem, caminho }];
  const ancestrais = new WeakSet<object>();
  type Quadro = { objeto: object; chaves: string[]; indice: number; caminho: Caminho };
  const pilha: Quadro[] = [];
  let atual = valor;
  let caminho: Caminho = [];
  for (;;) {
    if (caminho.length > PROFUNDIDADE_MAXIMA_DO_CONTRATO) return erro('profundidade', 'Profundidade máxima do contrato excedida.', caminho);
    if (atual && typeof atual === 'object') {
      if (ancestrais.has(atual)) return erro('ciclo', 'Contrato não pode conter ciclos.', caminho);
      const prototipo: unknown = Object.getPrototypeOf(atual);
      if (prototipo !== Object.prototype && prototipo !== Array.prototype && prototipo !== null) {
        return erro('objeto', 'Esperado objeto de dados simples.', caminho);
      }
      ancestrais.add(atual);
      pilha.push({ objeto: atual, chaves: Object.getOwnPropertyNames(atual), indice: 0, caminho });
    }
    while (pilha.length && pilha.at(-1)!.indice === pilha.at(-1)!.chaves.length) {
      ancestrais.delete(pilha.pop()!.objeto);
    }
    const quadro = pilha.at(-1);
    if (!quadro) return [];
    const chave = quadro.chaves[quadro.indice++]!;
    const propriedade = Object.getOwnPropertyDescriptor(quadro.objeto, chave)!;
    caminho = [...quadro.caminho, Array.isArray(quadro.objeto) && /^\d+$/u.test(chave) ? Number(chave) : chave];
    if (!('value' in propriedade)) return erro('acessor', 'Contrato não pode executar propriedades.', caminho);
    atual = propriedade.value as unknown;
  }
}
