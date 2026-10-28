/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL; empty means same origin through the Vite proxy. */
  readonly VITE_UDC_URL?: string;
  /** The yaml_menu collection the sidebar is drawn from (default `menu`). */
  readonly VITE_MENU_COLLECTION?: string;
}
