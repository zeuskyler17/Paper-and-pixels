'use client';

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return <button type="button" onClick={() => window.print()} className="btn-primary no-print">{label}</button>;
}

export function BackButton() {
  return <button type="button" onClick={() => window.history.back()} className="btn-secondary no-print">← Back</button>;
}
