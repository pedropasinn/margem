/** Worker do pdf.js com os polyfills carregados antes dele (ver `pdf-polyfills.ts`). */
import './pdf-polyfills';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
