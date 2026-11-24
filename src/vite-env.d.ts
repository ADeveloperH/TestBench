/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_IOS_PROBE?: string;
  readonly VITE_ENABLE_IOS_BUSINESS_CANDIDATES?: string;
  readonly VITE_IOS_PILOT_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
