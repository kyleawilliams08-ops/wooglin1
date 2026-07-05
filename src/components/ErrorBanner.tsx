export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="rounded-lg bg-usa-red/10 px-3 py-2 text-sm text-usa-red">{message}</p>
  );
}
