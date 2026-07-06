"use client";

/**
 * A form that asks before it submits — DeleteButton's confirm pattern,
 * but with arbitrary server-rendered children (hidden inputs, selects).
 */
export function ConfirmForm({
  action,
  confirm: message,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  confirm: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
