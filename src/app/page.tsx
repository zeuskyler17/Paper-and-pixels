import { redirect } from 'next/navigation';
import { getUser, homeFor } from '@/lib/auth';

/** "/" → the user's home page, based on their role's permissions. */
export default async function Home() {
  const user = await getUser();
  redirect(user ? homeFor(user) : '/login');
}
