/**
 * Shell slot declarations for the overlay's client registrations.
 *
 * `shell.overlay` (frame-wide floater layer) and `settings.section`
 * (settings pages) are declared by the shell packages; this augmentation
 * spells them with the same shape so this package can register without
 * depending on those sibling packages (same pattern as
 * dsh-client-ui-task-board's local `web-ui.plugin.item` declaration).
 *
 * @module dsh-subscription-overlay/client/slots
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Frame-wide overlay layer (quota pill precedent): list of floaters. */
    'shell.overlay': { kind: 'list'; scope: 'root' };
    /** Settings pages (subscriptions section precedent): ordered list. */
    'settings.section': { kind: 'list'; scope: 'root' };
    /** Composer dock row (subscriptions pill precedent): session-bound ordered list. */
    'conversation.composer.dock': { kind: 'list'; scope: 'session' };
  }
}
