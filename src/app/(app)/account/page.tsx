import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, DL, Field, PageHeader } from '@/components/ui';
import { changePassword, setApprovalPin } from './actions';

export const metadata = { title: 'My account' };

export default async function AccountPage() {
  const user = await requireUser();
  const hasPin = user.isAdmin
    ? !!(await prisma.user.findUnique({ where: { id: user.id }, select: { approvalPinHash: true } }))?.approvalPinHash
    : false;
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="My account" />
      <Card><DL items={[['Name', user.name], ['Username', user.username], ['Role', user.roleName]]} /></Card>
      <Card title="Change password">
        <ActionForm action={changePassword} resetOnSuccess className="space-y-3">
          <Field label="Current password"><input name="current" type="password" className="input" required /></Field>
          <Field label="New password"><input name="next" type="password" className="input" minLength={6} required /></Field>
          <Field label="Confirm new password"><input name="confirm" type="password" className="input" minLength={6} required /></Field>
          <SubmitButton>Change password</SubmitButton>
        </ActionForm>
      </Card>
      {user.isAdmin && (
        <Card title="Approval PIN">
          <p className="mb-3 text-[13px] text-slate-600">
            Your private 4–8 digit PIN to approve <b>payment voids</b> and <b>discounts</b> — including when a cashier is logged in.
            Status: {hasPin ? <b className="text-emerald-700">PIN is set</b> : <b className="text-red-700">not set yet</b>}.
          </p>
          <ActionForm action={setApprovalPin} resetOnSuccess className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={hasPin ? 'New PIN' : 'PIN'}><input name="pin" type="password" inputMode="numeric" pattern="\d{4,8}" maxLength={8} autoComplete="off" className="input" required /></Field>
              <Field label="Confirm PIN"><input name="confirmPin" type="password" inputMode="numeric" pattern="\d{4,8}" maxLength={8} autoComplete="off" className="input" required /></Field>
            </div>
            <Field label="Your login password" hint="Needed to set or change the PIN."><input name="password" type="password" autoComplete="current-password" className="input" required /></Field>
            <SubmitButton>{hasPin ? 'Change approval PIN' : 'Set approval PIN'}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
