'use client';

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState } from 'react';
import type { ActionState } from '@/lib/action';

const PendingContext = createContext(false);

/**
 * Form bound to a server action returning ActionState. Shows the error/success message and
 * disables inputs while saving. Bind extra args with action.bind(null, id).
 *
 * The action is dispatched from onSubmit (not the `action` prop) on purpose: React 19 resets a
 * form automatically after an `action` prop completes — even when we return a validation error —
 * which would wipe everything the user typed. Here fields are kept on error and only cleared on
 * success when `resetOnSuccess` is set.
 */
export function ActionForm({
  action, children, className = '', resetOnSuccess = false, confirm, onSuccess,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  onSuccess?: () => void;
}) {
  const [state, dispatch, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  // In-page confirmation (instead of window.confirm, which some browsers/webviews block silently).
  const [asking, setAsking] = useState<{ name: string; value: string } | null>(null);

  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function send(submitter: { name: string; value: string } | null) {
    if (!ref.current) return;
    const fd = new FormData(ref.current);
    // Include the clicked button's name/value (e.g. job status buttons use name="to").
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    startTransition(() => dispatch(fd));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const btn = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const submitter = btn?.name ? { name: btn.name, value: btn.value } : null;
    if (confirm) { setAsking(submitter ?? { name: '', value: '' }); return; }
    send(submitter);
  }

  return (
    <form ref={ref} onSubmit={onSubmit} className={className}>
      <PendingContext.Provider value={pending}>
        <fieldset disabled={pending} className="contents">{children}</fieldset>
      </PendingContext.Provider>
      {asking && !pending && (
        <div role="alertdialog" aria-label={confirm} className="mt-2 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-[13px] font-semibold text-amber-900">{confirm}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" autoFocus className="btn-dark btn-sm" onClick={() => { const s = asking; setAsking(null); send(s.name ? s : null); }}>
              Yes, continue
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setAsking(null)}>No</button>
          </div>
        </div>
      )}
      {state?.error && <p className="mt-2 whitespace-pre-line rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.ok}</p>}
    </form>
  );
}

export function SubmitButton({ children, className = 'btn-primary' }: { children: React.ReactNode; className?: string }) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? 'Saving…' : children}
    </button>
  );
}
