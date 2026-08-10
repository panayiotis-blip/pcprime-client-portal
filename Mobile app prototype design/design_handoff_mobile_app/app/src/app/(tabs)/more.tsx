import { useCallback } from 'react';
import { View } from 'react-native';

import * as portal from '../../api/portal';
import { Screen } from '../../components/Screen';
import { StatusBarStyle } from '../../components/StatusBarStyle';
import {
  ContactCard,
  ProfileRow,
  SignOutButton,
  SiteLinksCard,
  moreStyles,
} from '../../features/more/MoreBlocks';
import { useQuery } from '../../lib/useQuery';
import { useSession } from '../../state/session';
import { useTopPad } from '../../theme/layout';

/**
 * More — who you are, the firm's website, and how to reach them.
 *
 * There is no "switch to staff mode": the tab set follows the role the portal
 * gives the signed-in user.
 */
export default function MoreScreen() {
  const topPad = useTopPad(64);
  const { account, clientId, signOut } = useSession();

  const profile = useQuery(
    useCallback(
      () => (clientId == null ? Promise.resolve(null) : portal.loadProfile(clientId)),
      [clientId],
    ),
    [clientId],
  );

  const meta = [profile.data?.name, profile.data?.taxLabel].filter(Boolean).join(' · ');

  return (
    <Screen scroll>
      <StatusBarStyle style="dark" />
      <View style={[moreStyles.body, { paddingTop: topPad }]}>
        <ProfileRow
          initials={account?.initials ?? ''}
          name={account?.name ?? ''}
          meta={meta || account?.email || ''}
        />
        <SiteLinksCard style={moreStyles.firstGroup} />
        <ContactCard style={moreStyles.group} />
        <SignOutButton onPress={signOut} />
      </View>
    </Screen>
  );
}
