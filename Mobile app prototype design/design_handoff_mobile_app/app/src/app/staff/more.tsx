import { View } from 'react-native';

import { Screen } from '../../components/Screen';
import { StatusBarStyle } from '../../components/StatusBarStyle';
import {
  ContactCard,
  ProfileRow,
  SignOutButton,
  SiteLinksCard,
  moreStyles,
} from '../../features/more/MoreBlocks';
import { useSession } from '../../state/session';
import { useTopPad } from '../../theme/layout';

/**
 * More, staff side.
 *
 * Not a designed screen — the prototype pointed the staff More tab at the
 * client's own More. It keeps that layout, with the accountant's identity in
 * the profile row instead of a client's company and VAT number.
 */
export default function StaffMoreScreen() {
  const topPad = useTopPad(64);
  const { account, signOut } = useSession();

  return (
    <Screen scroll>
      <StatusBarStyle style="dark" />
      <View style={[moreStyles.body, { paddingTop: topPad }]}>
        <ProfileRow
          initials={account?.initials ?? ''}
          name={account?.name ?? ''}
          meta={account?.email ?? ''}
        />
        <SiteLinksCard style={moreStyles.firstGroup} />
        <ContactCard style={moreStyles.group} />
        <SignOutButton onPress={signOut} />
      </View>
    </Screen>
  );
}
