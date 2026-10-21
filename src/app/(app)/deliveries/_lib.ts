import type { DeliveryStatus } from '@prisma/client';

/** Allowed delivery status changes. Delivered is final; a cancelled record can be re-scheduled. */
export const NEXT_STATUSES: Record<DeliveryStatus, DeliveryStatus[]> = {
  SCHEDULED: ['IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
  IN_TRANSIT: ['SCHEDULED', 'DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: ['SCHEDULED'],
};
