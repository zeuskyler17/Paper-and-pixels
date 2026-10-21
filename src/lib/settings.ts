import { prisma } from './db';

export const DEFAULT_SETTINGS = {
  shop_name: 'Paper & Pixels',
  shop_address: 'San Carlos City, Pangasinan',
  shop_contact: '',
  shop_facebook: 'facebook.com/papernpixels',
  shop_email: '',
  receipt_footer: 'Thank you! Please present this slip when claiming your order.',
  bom_deduct_on: 'IN_PROCESS', // IN_PROCESS | COMPLETED
  late_grace_minutes: '0', // minutes after shift start still counted as on time
  clock_require_photo: 'true', // time clock requires a selfie for every time in / out
  clock_require_location: 'true', // time clock requires the device's GPS location for every time in / out
  shop_location: '', // "lat, lng" of the shop — DTR shows how far from the shop each punch was
};
export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.setting.findMany();
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in s) (s as Record<string, string>)[r.key] = r.value;
  return s;
}
