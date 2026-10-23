"use client";

import { useActionState, useRef } from "react";
import type { ActionResult } from "@/lib/tasks/types";
import { buttonClass, secondaryButtonClass } from "./ui";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * A form bound to a server action that reports "Saved" or the error inline.
 * Fields (including hidden org/project fields) are passed as children.
 */
export function ActionForm({
  action,
  children,
  submit,
  pendingLabel = "Saving…",
  className = "space-y-3",
  reset = false,
  secondary = false,
  confirm,
  inline = false,
}: {
  action: Action;
  children?: React.ReactNode;
  submit: string;
  pendingLabel?: string;
  className?: string;
  /** Clear the form after a successful submit (for "add" forms). */
  reset?: boolean;
  secondary?: boolean;
  /** Ask before submitting, e.g. for removals. */
  confirm?: string;
  /** Render the button and feedback on the same line as the fields. */
  inline?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    if (r.ok && reset) ref.current?.reset();
    return r;
  }, null);

  const footer = (
    <span className="flex flex-wrap items-center gap-2">
      <button disabled={pending} className={secondary ? secondaryButtonClass : buttonClass}>{pending ? pendingLabel : submit}</button>
      {state && (
        <span role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-status-green" : "text-status-red"}`}>
          {state.ok ? state.message : state.error}
        </span>
      )}
    </span>
  );

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {inline ? footer : <div>{footer}</div>}
    </form>
  );
}
