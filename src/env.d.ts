/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Adobe Fonts の kit ID。未設定の場合はフォールバックフォントだけを使う。 */
  readonly PUBLIC_ADOBE_FONTS_KIT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
