import { ArrowUp } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import * as portal from '../../api/portal';
import { Async, Empty } from '../../components/Async';
import { Input } from '../../components/Input';
import { Screen } from '../../components/Screen';
import { StatusBarStyle } from '../../components/StatusBarStyle';
import { Message } from '../../data/types';
import { useQuery } from '../../lib/useQuery';
import { useTabBarHeight, useTopPad } from '../../theme/layout';
import { HAIRLINE, RADIUS, color, space } from '../../theme/tokens';
import { font } from '../../theme/type';

export type MessagesViewProps = {
  /** Whose thread this is. */
  clientId: number;
  /** Who you are talking to — the accountant, or the client. */
  title: string;
  subtitle: string;
  placeholder: string;
  /** Staff see their own messages on the right; clients see theirs. */
  viewerIsStaff: boolean;
};

/**
 * The message thread, shared by both modes.
 *
 * Square corners: these are framed objects like everything else, not chat
 * bubbles.
 *
 * The portal keeps several named topics per client; this opens the most
 * recently active one and starts a "General" topic for a client who has never
 * written in.
 */
export function MessagesView({
  clientId,
  title,
  subtitle,
  placeholder,
  viewerIsStaff,
}: MessagesViewProps) {
  const topPad = useTopPad(60);
  const tabBarHeight = useTabBarHeight();
  const list = useRef<ScrollView>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const query = useQuery(
    useCallback(async () => {
      const threadId = await portal.openThread(clientId);
      const messages = await portal.loadMessages(threadId, viewerIsStaff);
      return { threadId, messages };
    }, [clientId, viewerIsStaff]),
    [clientId, viewerIsStaff],
  );

  // Opening the thread is reading it.
  const threadId = query.data?.threadId;
  useEffect(() => {
    if (threadId != null) portal.markThreadRead(threadId);
  }, [threadId]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending || threadId == null) return;

    setSending(true);
    setSendError('');
    // Clear straight away — retyping a sent message is worse than retyping a
    // failed one, and the failure puts it back.
    setDraft('');

    try {
      await portal.sendMessage(threadId, body);
      query.reload();
    } catch (caught) {
      setDraft(body);
      setSendError(caught instanceof Error ? caught.message : 'Message not sent.');
    } finally {
      setSending(false);
    }
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
          <Async query={query} loadingLabel="Opening your thread…">
            {({ messages }) =>
              messages.length ? (
                <>
                  {messages.map((message) => (
                    <Bubble key={message.id} message={message} />
                  ))}
                </>
              ) : (
                <Empty>No messages yet. Anything you write goes straight to the firm.</Empty>
              )
            }
          </Async>
        </ScrollView>

        {sendError ? <Text style={styles.sendError}>{sendError}</Text> : null}

        <View style={styles.composer}>
          <Input
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            onSubmitEditing={submit}
            returnKeyType="send"
            blurOnSubmit={false}
            editable={threadId != null}
            style={styles.field}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={submit}
            disabled={sending || threadId == null}
            style={({ pressed }) => [
              styles.send,
              pressed && styles.sendPressed,
              (sending || threadId == null) && styles.sendDisabled,
            ]}>
            <ArrowUp size={20} strokeWidth={1.5} color={color.bg} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Bubble({ message }: { message: Message }) {
  const mine = message.from === 'me';
  return (
    <View style={[styles.message, mine ? styles.mine : styles.theirs]}>
      <Text style={[styles.messageText, mine && styles.mineText]}>{message.text}</Text>
    </View>
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

  sendError: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.accent700,
    paddingHorizontal: space.screenX,
    paddingBottom: 6,
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
  sendDisabled: {
    opacity: 0.45,
  },
});
