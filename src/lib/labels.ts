// Human-readable labels & badge colors for enums (safe on client and server).
export const ORDER_STATUS: Record<string, string> = {
  PENDING: 'Pending', IN_PRODUCTION: 'In Production', COMPLETED: 'Completed',
  DELIVERED: 'Delivered / Picked up', CANCELLED: 'Cancelled',
};
export const PAYMENT_STATUS: Record<string, string> = { UNPAID: 'Unpaid', PARTIAL: 'Partial', PAID: 'Paid' };
export const PAYMENT_TERMS: Record<string, string> = {
  FULL: 'Full payment', DOWNPAYMENT: 'Downpayment', PAY_AFTER: 'Pay after production', CREDIT: 'Credit',
};
export const PAYMENT_METHOD: Record<string, string> = {
  CASH: 'Cash', GCASH: 'GCash', MAYA: 'Maya', BANK_TRANSFER: 'Bank transfer', OTHER: 'Other',
};
export const FILE_SOURCE: Record<string, string> = {
  NONE: 'No files', GMAIL: 'Gmail', USB: 'USB drive', MESSENGER: 'Messenger', OTHER: 'Other',
};
export const JOB_STATUS: Record<string, string> = {
  PENDING: 'Pending', IN_PROCESS: 'In Process', QUALITY_CHECK: 'Quality Check', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
export const JOB_COLUMNS = ['PENDING', 'IN_PROCESS', 'QUALITY_CHECK', 'COMPLETED'] as const;
export const MATERIAL_LEVEL: Record<string, string> = {
  RAW_RAW: 'Raw-raw (purchased)', RAW: 'Raw (cut/processed)', CONSUMABLE: 'Printing consumable', GENERAL: 'Daily consumption', FINISHED: 'Finished product (from Paper & Pixels)',
};
export const MATERIAL_USE: Record<string, string> = {
  ALBUM: 'Albums', FRAME: 'Picture frames', PRINTING: 'Printing', GENERAL: 'General consumables', SHARED: 'Shared (several lines)',
};
export const MOVEMENT_TYPE: Record<string, string> = {
  STOCK_IN: 'Stock in', STOCK_OUT: 'Stock out', ADJUSTMENT: 'Adjustment',
  CONVERSION_IN: 'Conversion (in)', CONVERSION_OUT: 'Conversion (out)', JOB_DEDUCT: 'Job deduction',
};
export const PO_STATUS: Record<string, string> = {
  DRAFT: 'Draft', SENT: 'Sent', PARTIALLY_RECEIVED: 'Partially received', RECEIVED: 'Received', CANCELLED: 'Cancelled',
};
export const DELIVERY_METHOD: Record<string, string> = {
  PICKUP: 'Pickup', LALAMOVE_GRAB: 'Lalamove / Grab', LBC_JNT: 'LBC / J&T', OWN_DELIVERY: 'Own delivery',
};
export const DELIVERY_STATUS: Record<string, string> = {
  SCHEDULED: 'Scheduled', IN_TRANSIT: 'In transit', DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
};
export const ROLE: Record<string, string> = { ADMIN: 'Admin (owner)', STAFF: 'Cashier / Staff', WORKER: 'Production worker', INVENTORY: 'Inventory personnel' };
export const PRICING_MODE: Record<string, string> = { FIXED: 'Per piece', PER_SQFT: 'Per square foot' };
export const OPTION_TYPE: Record<string, string> = { SELECT: 'Pick one', MULTI: 'Add-ons (pick any)', NUMBER: 'Number (priced per unit)' };

export type Tone = 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'purple';
export const TONE: Record<string, Tone> = {
  PENDING: 'gray', IN_PRODUCTION: 'blue', IN_PROCESS: 'blue', QUALITY_CHECK: 'purple', COMPLETED: 'green',
  DELIVERED: 'green', CANCELLED: 'red', UNPAID: 'red', PARTIAL: 'amber', PAID: 'green',
  DRAFT: 'gray', SENT: 'blue', PARTIALLY_RECEIVED: 'amber', RECEIVED: 'green',
  SCHEDULED: 'gray', IN_TRANSIT: 'blue',
};

export function options(map: Record<string, string>) {
  return Object.entries(map).map(([value, label]) => ({ value, label }));
}

// ── HR ──
export const EMPLOYMENT_STATUS: Record<string, string> = { ACTIVE: 'Active', ON_LEAVE: 'On leave', RESIGNED: 'Resigned', TERMINATED: 'Terminated' };
export const PAY_TYPE: Record<string, string> = { DAILY: 'Daily rate', MONTHLY: 'Monthly salary' };
export const PAY_FREQUENCY: Record<string, string> = { WEEKLY: 'Weekly', SEMI_MONTHLY: 'Semi-monthly (15th & end of month)' };
export const DEDUCTION_SCHEDULE: Record<string, string> = { EVERY_PAYROLL: 'Every payroll', ONCE_A_MONTH: 'Once a month (first payroll of the month)' };
export const HOLIDAY_TYPE: Record<string, string> = { REGULAR: 'Regular holiday', SPECIAL: 'Special non-working day' };
export const PAYROLL_STATUS: Record<string, string> = { DRAFT: 'Draft', FINALIZED: 'Finalized', PAID: 'Paid', VOID: 'Void' };
export const CASH_ADVANCE_STATUS: Record<string, string> = { OPEN: 'Open', PAID: 'Fully paid', VOID: 'Void' };
export const INCIDENT_TYPE: Record<string, string> = { INCIDENT: 'Incident', VIOLATION: 'Violation', WARNING: 'Warning issued', OTHER: 'Other note' };
export const INCIDENT_SEVERITY: Record<string, string> = { MINOR: 'Minor', MAJOR: 'Major', GRAVE: 'Grave' };
export const WEEKDAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
Object.assign(TONE, {
  ACTIVE: 'green', ON_LEAVE: 'amber', RESIGNED: 'gray', TERMINATED: 'red',
  FINALIZED: 'blue', VOID: 'red', OPEN: 'amber',
  MINOR: 'gray', MAJOR: 'amber', GRAVE: 'red',
  INCIDENT: 'amber', VIOLATION: 'red', WARNING: 'purple', OTHER: 'gray',
});
