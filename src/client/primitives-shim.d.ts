/**
 * Ambient type shim for the `@deepseek-ai/dsh-client-ui-primitives` seat.
 *
 * A shell-provided browser dependency (listed in `tsdown.config.ts`
 * `clientExternals` and `package.json` `dsh.client.inject`, mirroring
 * upstream `dsh-plugin-subscriptions` which imports the icon plus the
 * anchored-position and outside-pointer hooks from it), not an npm
 * dependency — the bundler never resolves it and the import survives
 * into the shell-loaded bundle verbatim. This shim gives `tsc` the
 * structural shape for verification only; it contributes zero runtime code.
 *
 * NOTE: this file is intentionally a global script (no top-level
 * import/export) so the ambient module declaration always applies.
 *
 * @module dsh-subscription-overlay/client/primitives-shim
 */

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { CSSProperties, Dispatch, RefObject, SetStateAction } from 'react';
  /** 16px data-outline icon used by the composer stats pills. */
  export function IconDataOutline16(): React.JSX.Element;
  /** Trigger-anchored dialog position (measured pass spills to a hidden style). */
  export function useAnchoredPosition(options: {
    open: boolean;
    anchorRef: RefObject<HTMLElement | null>;
    panelRef: RefObject<HTMLElement | null>;
    side: 'top' | 'bottom' | 'left' | 'right';
    gap: number;
    margin: number;
  }): CSSProperties | null;
  /** Dismiss an open dialog on outside pointer interaction. */
  export function useDismissOnOutsidePointer(
    anchorRef: RefObject<HTMLElement | null>,
    open: boolean,
    onDismiss: Dispatch<SetStateAction<boolean>>,
    panelRef: RefObject<HTMLElement | null>,
  ): void;
}
