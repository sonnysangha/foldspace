import { useLocalSearchParams } from 'expo-router';

import { JoinScreen } from '@/screens/join-screen';

/** Also the target of an invite link: foldspace://join?code=ABCD-EFGH-JKMN */
export default function JoinRoute() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <JoinScreen initialCode={typeof code === 'string' ? code : ''} />;
}
