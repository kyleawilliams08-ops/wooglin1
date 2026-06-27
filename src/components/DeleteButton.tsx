"use client";

interface Props {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  confirm: string;
  label?: string;
  className?: string;
}

export function DeleteButton({ action, fields, confirm: message, label = "Delete", className }: Props) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        className={className ?? "text-sm text-usa-red hover:underline"}
      >
        {label}
      </button>
    </form>
  );
}
