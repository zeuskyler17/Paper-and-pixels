import { prisma } from './db';

export const DEFAULT_SETTINGS = {
  shop_name: 'Paper & Pixels',
  shop_address: 'San Carlos City, Pangasinan',
  shop_contact: '',
  shop_facebook: 'facebook.com/papernpixels',
  shop_email: '',
  receipt_footer: 'Thank you! Please present this slip when claiming your order.',
  bom_deduct_on: 'IN_PROCESS', // IN_PROCESS | COMPLETED
  late_grace_minutes: '0', // minutes after shift start still counted as on time (each employee can override it)
  break_schedule: '10:00-10:15, 12:00-13:00, 15:00-15:15', // time-clock break slots; minutes beyond a slot = over-break (undertime)
  clock_require_photo: 'true', // time clock requires a selfie for every time in / out
  clock_require_location: 'true', // time clock requires the device's GPS location for every time in / out
  shop_location: '', // "lat, lng" of the shop — DTR shows how far from the shop each punch was
  points_enabled: 'false', // loyalty points promo on/off (owner's launch switch)
  points_step: '500', // pesos paid per earning step
  points_per_step: '3', // points earned per step
  point_value: '10', // pesos off per point when used
  points_redeem_week_cap: '300', // most points one customer may use per week (0 = no limit)
  clock_kiosk_username: 'cashier', // shared clock-in login: everyone may punch from it (and its device) without buddy-punching warnings
};
export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.setting.findMany();
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in s) (s as Record<string, string>)[r.key] = r.value;
  return s;
}
