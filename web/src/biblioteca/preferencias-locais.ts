/**
 * Preferências guardadas no aparelho (localStorage) e o teste de "campo em edição" dos atalhos.
 * Módulo leve, sem React, para quem precisa só disto (o leitor de quadro, a página do site) não
 * carregar a lista da biblioteca inteira. `Lista.tsx` reexporta.
 */
export function campoEmEdicao(alvo: EventTarget | null): boolean { return alvo instanceof Element && !!alvo.closest('input, textarea, select, [contenteditable=true], [role=combobox], [role=listbox]'); }
export function preferencia(chave: string, padrao: boolean): boolean { try { const valor = localStorage.getItem(chave); return valor === null ? padrao : valor === 'true'; } catch { return padrao; } }
export function guardarPreferencia(chave: string, valor: boolean) { try { localStorage.setItem(chave, String(valor)); } catch { /* Armazenamento indisponível: vale o estado desta sessão. */ } }
