import { ArrowUp } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Input } from '../../components/Input';
import { Screen } from '../../components/Screen';
import { StatusBarStyle } from '../../components/StatusBarStyle';
import { useMessages } from '../../state/messages';
import { useTabBarHeight, useTopPad } from '../../theme/layout';
import { HAIRLINE, RADIUS, color, space } from '../../theme/tokens';
import { font } from '../../theme/type';

export type MessagesViewProps = {
  /** Who you are talking to — the accountant, or the client. */
  title: string;
  subtitle: string;
  placeholder: string;
};

/**
 * The message thread, shared by both modes.
 *
 * Square corners: these are framed objects like everything else, not chat
 * bubbles.
 */
export function MessagesView({ title, subtitle, placeholder }: MessagesViewProps) {
  const topPad = useTopPad(60);
  const tabBarHeight = useTabBarHeight();
  const { messages, typing, send } = useMessages();
  const [draft, setDraft] = useState('');
  const list = useRef<ScrollView>(null);

  const submit = () => {
    if (!draft.trim()) return;
    send(draft);
    setDraft('');
  };

  return (
    <Screen>
      <StatusBarStyle style="dark" />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={tabBarHeight}>
        <View style={[styles.header, { paddingTop: topPad }]}>
          <Text style={styles.name}>{title}</Text>
          <Text style={styles.status}>{subtitle}</Text>
        </View>

        <ScrollView
          ref={list}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {messages.map((message) => {
            const mine = message.from === 'me';
            return (
              <View key={message.id} style={[styles.message, mine ? styles.mine : styles.theirs]}>
                <Text style={[styles.messageText, mine && styles.mineText]}>{message.text}</Text>
              </View>
            );
          })}
          {typing ? <TypingIndicator /> : null}
        </ScrollView>

        <View style={styles.composer}>
          <Input
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            onSubmitEditing={submit}
            returnKeyType="send"
            blurOnSubmit={false}
            style={styles.field}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={submit}
            style={({ pressed }) => [styles.send, pressed && styles.sendPressed]}>
            <ArrowUp size={20} strokeWidth={1.5} color={color.bg} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Prototype affordance: 200ms fade in, then the canned reply lands. */
function TypingIndicator() {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  return (
    <Animated.View style={[styles.message, styles.theirs, { opacity }]}>
      <Text style={styles.typing}>typing…</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: space.screenX,
    paddingBottom: 14,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: color.divider,
  },
  name: {
    fontFamily: font.head,
    fontSize: 24,
    lineHeight: 26.4,
    textTransform: 'uppercase',
    color: color.text,
  },
  status: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 4,
  },

  thread: {
    flex: 1,
  },
  threadContent: {
    paddingVertical: 18,
    paddingHorizontal: space.screenX,
    gap: 10,
  },
  message: {
    maxWidth: '80%',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderWidth: HAIRLINE,
    borderRadius: RADIUS,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: color.accent900,
    borderColor: color.accent900,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    borderColor: color.divider,
  },
  messageText: {
    fontFamily: font.body,
    fontSize: 14.5,
    lineHeight: 21.75,
    color: color.text,
  },
  mineText: {
    color: color.bg,
  },
  typing: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.neutral600,
  },

  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 30,
    borderTopWidth: HAIRLINE,
    borderTopColor: color.divider,
  },
  field: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 13,
    paddingHorizontal: 15,
    fontSize: 15,
    minHeight: 46,
  },
  send: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accent,
    borderWidth: HAIRLINE,
    borderColor: color.accent,
    borderRadius: RADIUS,
  },
  sendPressed: {
    backgroundColor: color.accent700,
    borderColor: color.accent700,
  },
});
