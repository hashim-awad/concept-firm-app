// Types for the generated Studio engine (src/lib/studio/engine.generated.js).
/* eslint-disable @typescript-eslint/no-explicit-any */
export type StudioEngine = Record<string, any> & {
  __get(name: "FEES" | "T1C" | "POPTS" | "pRec"): any;
  __set(name: "FEES" | "T1C" | "POPTS" | "pRec", v: any): void;
};
export type StudioEnv = {
  DB?: { floors?: any[]; floorsOk?: boolean; loaded?: boolean; cat?: any[] };
  SIGNER?: string;
  SIGNER_TITLE?: string;
  LH?: string;
  SIG?: string;
  ILLUS?: string;
  $?: (id: string) => unknown;
  WORDING?: Record<string, string>;
  WORDING_MARK?: boolean;
  EL_VERSION?: string;
  EL_VERSION_DATE?: string;
};
export declare function createStudioEngine(env?: StudioEnv): StudioEngine;
