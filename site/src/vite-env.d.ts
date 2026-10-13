/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Para onde vão os pedidos de convite. Sem valor, o formulário não envia nada. */
  readonly VITE_CONVITE_ENDPOINT?: string;
  /** `json` (padrão) ou `formulario` (multipart, para serviços de formulário externos). */
  readonly VITE_CONVITE_FORMATO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
