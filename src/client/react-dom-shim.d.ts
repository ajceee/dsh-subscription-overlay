/**
 * Ambient type shim for the `react-dom` browser seat.
 *
 * `react-dom` is a shell-provided browser dependency (listed in
 * `tsdown.config.ts` `clientExternals`, mirroring upstream
 * `dsh-plugin-subscriptions` which imports `createPortal` from it), not an
 * npm dependency — the bundler never resolves it and the import survives
 * into the shell-loaded bundle verbatim. This shim gives `tsc` the
 * structural shape for verification only; it contributes zero runtime code.
 *
 * NOTE: this file is intentionally a global script (no top-level
 * import/export) so the ambient module declaration always applies.
 *
 * @module dsh-subscription-overlay/client/react-dom-shim
 */

declare module 'react-dom' {
  import type { ReactNode } from 'react';
  /** Port a node into a DOM container outside the parent hierarchy. */
  export function createPortal(node: ReactNode, container: Element | DocumentFragment): ReactNode;
}
