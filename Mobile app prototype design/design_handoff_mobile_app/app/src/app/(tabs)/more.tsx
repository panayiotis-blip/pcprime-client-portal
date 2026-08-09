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
 * More — who you are, the firm's website, and how to reach them.
 *
 * The prototype's "switch to staff mode" button is deliberately absent: staff
 * mode is gated by the signed-in user's role, not a button.
 */
export default function MoreScreen() {
  const topPad = useTopPad(64);
  const { user, signOut } = useSession();

  return (
    <Screen scroll>
      <StatusBarStyle style="dark" />
      <View style={[moreStyles.body, { paddingTop: topPad }]}>
        <ProfileRow
          initials={user.initials}
          name={user.name}
          meta={`${user.company} · ${user.vat}`}
        />
        <SiteLinksCard style={moreStyles.firstGroup} />
        <ContactCard style={moreStyles.group} />
        <SignOutButton onPress={signOut} />
      </View>
    </Screen>
  );
}
