/**
 * The receipt / slip footer from Settings. The first line is a centered thank-you; every following line
 * (e.g. "Note: please claim your order within 30 days…") is printed below it as typed.
 */
export function SlipFooter({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const [first, ...rest] = lines;
  return (
    <div className={`text-black ${className}`}>
      <p className="text-center">{first}</p>
      {rest.map((l, i) => <p key={i} className="mt-0.5 text-left">{l}</p>)}
    </div>
  );
}
