import { TabList, TabSlot, TabTrigger, TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import { Calendar, Folder, Home, LucideIcon, MessageSquare, MoreHorizontal } from 'lucide-react-native';
import { Ref } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_PADDING_TOP, TAB_BAR_ROW_HEIGHT } from '../../theme/layout';
import { CONTENT_MAX_WIDTH, HAIRLINE, color } from '../../theme/tokens';
import { text } from '../../theme/type';

/**
 * The client tab bar: Home · Files · Book · Messages · More.
 *
 * No pill, no underline, no fill — the active tab is carried by colour alone.
 * Built on the headless tabs so nothing platform-default leaks in.
 */

const TABS = [
  { name: 'home', href: '/', label: 'Home', icon: Home },
  { name: 'documents', href: '/documents', label: 'Files', icon: Folder },
  { name: 'book', href: '/book', label: 'Book', icon: Calendar },
  { name: 'messages', href: '/messages', label: 'Messages', icon: MessageSquare },
  { name: 'more', href: '/more', label: 'More', icon: MoreHorizontal },
] as const;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs>
      <TabSlot />
      <TabList
        style={[
          styles.bar,
          // The design's 26pt bottom padding is the home-indicator inset.
          { paddingBottom: Math.max(insets.bottom, 8) },
        ]}>
        {TABS.map((tab) => (
          <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
            <TabButton icon={tab.icon}>{tab.label}</TabButton>
          </TabTrigger>
        ))}
      </TabList>
    </Tabs>
  );
}

type TabButtonProps = TabTriggerSlotProps & {
  icon: LucideIcon;
  ref?: Ref<View>;
};

function TabButton({ icon: Icon, children, isFocused, ...rest }: TabButtonProps) {
  const ink = isFocused ? color.accent800 : color.neutral500;

  return (
    <Pressable
      {...rest}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      style={styles.tab}>
      <Icon size={22} strokeWidth={1.5} color={ink} />
      <Text style={[text.tabLabel, { color: ink }]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    // The bar itself is app chrome and spans the window; the tabs inside it
    // stay with the centred content column.
    justifyContent: 'center',
    backgroundColor: color.bg,
    borderTopWidth: HAIRLINE,
    borderTopColor: color.divider,
    paddingTop: TAB_BAR_PADDING_TOP,
    paddingHorizontal: 6,
  },
  tab: {
    flex: 1,
    maxWidth: CONTENT_MAX_WIDTH / TABS.length,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    minHeight: TAB_BAR_ROW_HEIGHT,
  },
});
