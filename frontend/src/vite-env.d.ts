/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL; empty means same origin through the Vite proxy. */
  readonly VITE_UDC_URL?: string;
}
