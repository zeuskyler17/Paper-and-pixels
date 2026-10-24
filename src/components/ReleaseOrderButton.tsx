'use client';

import Link from 'next/link';
import { markDelivered } from '@/app/(app)/orders/actions';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { peso } from '@/lib/money';

/**
 * "Released / Delivered" for a finished job: marks the whole order Delivered / Picked up, so it leaves the
 * dashboard's ready-for-pickup list and the production board. Needs every job of the order finished and
 * no balance (an unpaid balance is collected / overridden on the order page).
 */
export function ReleaseOrderButton({ orderId, orderNo, balance, ready, hideAmount = false, className = '' }: { orderId: number; orderNo: string; balance: number; ready: boolean; hideAmount?: boolean; className?: string }) {
  if (!ready) return <div className={`text-[11px] text-slate-500 ${className}`}>Other items of {orderNo} are still in production</div>;
  if (balance > 0) {
    return <Link href={`/orders/${orderId}`} className={`btn-secondary btn-sm ${className}`} title="Collect the balance (or override) on the order page, then release">{hideAmount ? 'Balance due — see order' : `Balance ${peso(balance)} — collect first`}</Link>;
  }
  return (
    <ActionForm action={markDelivered.bind(null, orderId)} confirm={`Mark ${orderNo} as Released / Delivered? It will leave the dashboard and the production board.`} className={className}>
      <SubmitButton className="btn-primary btn-sm">Released / Delivered</SubmitButton>
    </ActionForm>
  );
}
