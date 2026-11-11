import { router } from 'expo-router';

import { ManageAccount } from '@/components/auth/manage-account';

export default function ManageAccountRoute() {
  return <ManageAccount onBack={() => router.back()} />;
}
