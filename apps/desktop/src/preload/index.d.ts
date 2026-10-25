import type { TostWorkApi } from "../shared/api";

declare global {
  interface Window {
    tostWork?: TostWorkApi;
  }
}
