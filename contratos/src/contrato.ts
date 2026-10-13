import { conferirEntrada } from './entrada';
/** Composição explícita: este módulo não interpreta JSON Schema nem depende de Node. */
export type Schema = Record<string, unknown>;
export type Caminho = readonly (string | number)[];
export interface DiagnosticoContrato { caminho: Caminho; codigo: string; mensagem: string }
export type ResultadoContrato<T> = { ok: true; valor: T } | { ok: false; erros: DiagnosticoContrato[] };
declare const local: unique symbol;
export type Imutavel<T> = T extends readonly (infer U)[] ? readonly Imutavel<U>[]
  : T extends object ? { readonly [K in keyof T]: Imutavel<T[K]> } : T;
export type Local<T> = Imutavel<T> & { readonly [local]: true };
export interface Contrato<T> {
  readonly schema: Schema;
  validarLocal(valor: unknown): ResultadoContrato<Local<T>>;
}
export type ConferirEstrutura = (schema: Schema, valor: unknown) => DiagnosticoContrato[];
export interface Componente {
  readonly schema: Schema;
  /** Interno: só após a conferência estrutural da raiz ou do ramo. */
  conferir(valor: unknown, caminho: Caminho, estrutura: ConferirEstrutura): DiagnosticoContrato[];
}
type Regra<T> = (valor: T) => DiagnosticoContrato[];
export const diagnostico = (codigo: string, mensagem: string, caminho: Caminho = []): DiagnosticoContrato => ({ caminho, codigo, mensagem });
export function regraBooleana<T>(regra: (valor: T) => boolean, codigo: string): Regra<T> {
  return valor => regra(valor) ? [] : [diagnostico(codigo, `Regra local não satisfeita: ${codigo}.`)];
}
function prefixar(erros: DiagnosticoContrato[], caminho: Caminho): DiagnosticoContrato[] {
  return erros.map(erro => ({ ...erro, caminho: [...caminho, ...erro.caminho] }));
}
/** Folhas de interoperabilidade não podem esconder referências a outros contratos. */
function semReferencias(valor: unknown): void {
  if (!valor || typeof valor !== 'object') return;
  if ('$ref' in valor || '$dynamicRef' in valor) throw new Error('Componha referências usando referenciar(contrato).');
  for (const item of Object.values(valor)) semReferencias(item);
}
export function folha<T = unknown>(schema: Schema, regra?: Regra<T>): Componente {
  semReferencias(schema);
  return { schema, conferir: (valor, caminho) => regra ? prefixar(regra(valor as T), caminho) : [] };
}
export function referenciar(componente: Componente, id: string): Componente {
  return { schema: { $ref: id }, conferir: (valor, caminho, estrutura) => componente.conferir(valor, caminho, estrutura) };
}
export function objeto<T>(base: Schema, campos: Record<string, Componente>, regra?: Regra<T>): Componente {
  const propriedades = { ...base.properties as Schema };
  const restantes = { ...propriedades };
  for (const [nome, campo] of Object.entries(campos)) {
    if (!(nome in propriedades)) throw new Error(`Campo de composição inexistente: ${nome}.`);
    propriedades[nome] = campo.schema;
    delete restantes[nome];
  }
  // $defs são definições publicadas; referências efetivamente usadas devem ser compostas.
  const restricoes = { ...base };
  delete restricoes.properties; delete restricoes.$defs;
  semReferencias({ ...restricoes, properties: restantes });
  return {
    schema: { ...base, properties: propriedades },
    conferir(valor, caminho, estrutura) {
      const dados = valor as Record<string, unknown>;
      const erros = Object.entries(campos).flatMap(([nome, filho]) => Object.hasOwn(dados, nome)
        ? filho.conferir(dados[nome], [...caminho, nome], estrutura) : []);
      return erros.length ? erros : regra ? prefixar(regra(valor as T), caminho) : [];
    },
  };
}
export function lista(base: Schema, item: Componente): Componente {
  const resto = { ...base }; delete resto.items;
  semReferencias(resto);
  return { schema: { ...base, items: item.schema }, conferir: (valor, caminho, estrutura) =>
    (valor as unknown[]).flatMap((v, i) => item.conferir(v, [...caminho, i], estrutura)) };
}
/** oneOf conserva exclusividade estrutural; anyOf precisa de um ramo completo válido. */
export function alternativas(base: Schema, tipo: 'oneOf' | 'anyOf', ramos: readonly Componente[]): Componente {
  const resto = { ...base }; delete resto[tipo];
  semReferencias(resto);
  return {
    schema: { ...base, [tipo]: ramos.map(ramo => ramo.schema) },
    conferir(valor, caminho, estrutura) {
      const candidatos = ramos.filter(ramo => estrutura(ramo.schema, valor).length === 0);
      if (candidatos.length === 0 || (tipo === 'oneOf' && candidatos.length !== 1)) {
        return [diagnostico('alternativa_estrutural', 'Alternativas estruturais incompatíveis.', caminho)];
      }
      const falhas: DiagnosticoContrato[] = [];
      for (const candidato of candidatos) {
        const erros = candidato.conferir(valor, caminho, estrutura);
        if (erros.length === 0) return [];
        falhas.push(...erros);
      }
      return falhas;
    },
  };
}
/** A seleção por discriminador só afeta o percurso semântico, nunca a estrutura publicada. */
export function discriminada(base: Schema, tipo: 'oneOf' | 'anyOf', chave: string, ramos: Record<string, Componente>): Componente {
  const uniao = alternativas(base, tipo, Object.values(ramos));
  return { schema: uniao.schema, conferir(valor, caminho, estrutura) {
    const ramo = ramos[String((valor as Record<string, unknown>)[chave])];
    return ramo ? ramo.conferir(valor, caminho, estrutura)
      : [diagnostico('discriminador', `Alternativa desconhecida em ${chave}.`, [...caminho, chave])];
  } };
}
function congelar<T>(valor: T): T {
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}
/** O wrapper booleano pode usar conferir sem clonar; a API Local recebe uma cópia própria. */
export function compilarContrato<T>(componente: Componente, estrutura: ConferirEstrutura, conferirValor: (valor: unknown) => DiagnosticoContrato[] = () => []): Contrato<T> & {
  conferir(valor: unknown): DiagnosticoContrato[];
} {
  const conferir = (valor: unknown): DiagnosticoContrato[] => {
    const entrada = conferirEntrada(valor);
    if (entrada.length) return entrada;
    const erros = estrutura(componente.schema, valor);
    if (erros.length) return erros;
    const valorInvalido = conferirValor(valor);
    return valorInvalido.length ? valorInvalido : componente.conferir(valor, [], estrutura);
  };
  return {
    schema: componente.schema, conferir,
    validarLocal(valor) {
      const erros = conferir(valor);
      return erros.length ? { ok: false, erros } : { ok: true, valor: congelar(structuredClone(valor)) as Local<T> };
    },
  };
}
