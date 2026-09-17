/**
 * Ambient type shim for the browser client runtime seat.
 *
 * SPIKE §1 prescribes `import type { ClientContext } from
 * "@deepseek-ai/dsh-client-runtime"`. That package is a shell-provided
 * browser seat (listed in package.json `dsh.client.inject`), not an npm
 * dependency, and type-only imports vanish from the tsdown bundle — so the
 * build never resolves it. This shim gives `tsc` the structural shape for
 * verification only; it contributes zero runtime code.
 *
 * NOTE: this file is intentionally a global script (no top-level
 * import/export) so the ambient module declaration always applies.
 *
 * @module dsh-subscription-overlay/client/runtime-shim
 */

declare module '@deepseek-ai/dsh-client-runtime' {
  import type { Context } from '@deepseek-ai/cordis';
  import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
  /** Shell-provided slots seat: renderer-owned inject + the ledger register. */
  export interface SlotsSeat {
    inject(slot: string, factory: () => () => void): void;
    register: SlotCore['register'];
  }
  /** Browser plugin context: cordis fiber plus the shell-provided slots seat. */
  export type ClientContext = Context & { slots: SlotsSeat };
}
