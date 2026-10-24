import 'server-only';
import type { Employee } from '@prisma/client';
import { prisma } from '@/lib/db';
import { centavosToInput } from '@/lib/money';
import { toDateInput } from '@/lib/dates';
import type { EmployeeFormValues, LinkableUser } from './EmployeeFields';

/** Logins not yet linked to another employee (plus the one linked to `employeeId`). */
export async function linkableUsers(employeeId?: number): Promise<LinkableUser[]> {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { active: true, employee: { is: null } },
        ...(employeeId ? [{ employee: { is: { id: employeeId } } }] : []),
      ],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, username: true, active: true, accessRole: { select: { name: true } } },
  });
  return users.map(({ accessRole, ...u }) => ({ ...u, role: accessRole?.name ?? 'No role' }));
}

export function toFormValues(e: Employee): EmployeeFormValues {
  return {
    firstName: e.firstName, lastName: e.lastName, middleName: e.middleName ?? '', nickname: e.nickname ?? '',
    position: e.position, mobile: e.mobile ?? '', email: e.email ?? '', address: e.address ?? '',
    birthDate: toDateInput(e.birthDate), hireDate: toDateInput(e.hireDate), status: e.status, endDate: toDateInput(e.endDate),
    payType: e.payType, rate: centavosToInput(e.rate), payFrequency: e.payFrequency,
    shiftStart: e.shiftStart, shiftEnd: e.shiftEnd, breakMinutes: e.breakMinutes, workDays: e.workDays, lateGraceMinutes: e.lateGraceMinutes == null ? '' : String(e.lateGraceMinutes),
    sssNo: e.sssNo ?? '', philhealthNo: e.philhealthNo ?? '', pagibigNo: e.pagibigNo ?? '', tin: e.tin ?? '',
    emergencyContact: e.emergencyContact ?? '', emergencyPhone: e.emergencyPhone ?? '', notes: e.notes ?? '', userId: e.userId,
  };
}
