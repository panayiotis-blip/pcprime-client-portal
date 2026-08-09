import { ArrowUpRight } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Blueprint } from '../../components/Blueprint';
import { Button } from '../../components/Button';
import { GroupLabel } from '../../components/Section';
import { firm, siteLinks } from '../../data/mock';
import { HAIRLINE, color, space, tint } from '../../theme/tokens';
import { font } from '../../theme/type';

/**
 * The blocks the More screen is built from. Both modes show the firm's
 * website and contact details; only the profile row above them differs.
 */

/** 52pt framed initials over a name and one line of context. */
export function ProfileRow({
  initials,
  name,
  meta,
}: {
  initials: string;
  name: string;
  meta: string;
}) {
  return (
    <View style={styles.profile}>
      <Blueprint style={styles.avatar}>
        <Text style={styles.initials}>{initials}</Text>
      </Blueprint>
      <View style={styles.identity}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.meta}>{meta}</Text>
      </View>
    </View>
  );
}

export function SiteLinksCard({ style }: { style?: object }) {
  return (
    <View style={style}>
      <GroupLabel>From our website</GroupLabel>
      <Blueprint style={styles.list}>
        {siteLinks.map((link, index) => (
          <Pressable
            key={link.href}
            accessibilityRole="link"
            onPress={() => Linking.openURL(link.href)}
            style={({ pressed }) => [
              styles.linkRow,
              index < siteLinks.length - 1 && styles.divided,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.linkLabel}>{link.label}</Text>
            <Text style={styles.linkHost}>{link.host}</Text>
            <ArrowUpRight size={16} strokeWidth={1.5} color={color.accent} />
          </Pressable>
        ))}
      </Blueprint>
    </View>
  );
}

export function ContactCard({ style }: { style?: object }) {
  return (
    <View style={style}>
      <GroupLabel>Get in touch</GroupLabel>
      <Blueprint style={styles.contact}>
        <Text style={styles.phone}>{firm.phone}</Text>
        <Text style={styles.hours}>
          {firm.hours}
          {'\n'}
          {firm.address}
        </Text>
        <View style={styles.contactActions}>
          <Button
            variant="primary"
            label="Call"
            uppercase
            onPress={() => Linking.openURL(firm.phoneHref)}
            style={styles.contactButton}
            labelStyle={styles.contactLabel}
          />
          <Button
            variant="secondary"
            label="Email"
            uppercase
            onPress={() => Linking.openURL(firm.emailHref)}
            style={styles.contactButton}
            labelStyle={styles.contactLabel}
          />
        </View>
      </Blueprint>
    </View>
  );
}

export function SignOutButton({ onPress }: { onPress: () => void }) {
  return (
    <Button
      variant="ghost"
      label="Sign out"
      onPress={onPress}
      style={styles.signOut}
      labelStyle={styles.signOutLabel}
    />
  );
}

export const moreStyles = StyleSheet.create({
  body: {
    paddingHorizontal: space.screenX,
    paddingBottom: 30,
  },
  firstGroup: {
    marginTop: space.section,
  },
  group: {
    marginTop: 26,
  },
});

const styles = StyleSheet.create({
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: font.body,
    fontSize: 15,
    color: color.accent700,
  },
  identity: {
    flex: 1,
  },
  name: {
    fontFamily: font.head,
    fontSize: 24,
    lineHeight: 26.4,
    textTransform: 'uppercase',
    color: color.text,
  },
  meta: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 3,
  },

  list: {
    marginTop: 12,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
    minHeight: 44,
  },
  divided: {
    borderBottomWidth: HAIRLINE,
    borderBottomColor: color.divider,
  },
  pressed: {
    backgroundColor: tint.pressCard,
  },
  linkLabel: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 15,
    lineHeight: 20,
    color: color.text,
  },
  linkHost: {
    fontFamily: font.body,
    fontSize: 12,
    lineHeight: 16,
    color: color.neutral600,
  },

  contact: {
    marginTop: 12,
    padding: 16,
  },
  phone: {
    fontFamily: font.head,
    fontSize: 24,
    lineHeight: 26,
    color: color.text,
  },
  hours: {
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 20.8,
    color: color.neutral700,
    marginTop: 6,
  },
  contactActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  contactButton: {
    flex: 1,
    minHeight: 44,
  },
  contactLabel: {
    fontSize: 13,
  },

  signOut: {
    marginTop: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  signOutLabel: {
    fontSize: 14,
  },
});
