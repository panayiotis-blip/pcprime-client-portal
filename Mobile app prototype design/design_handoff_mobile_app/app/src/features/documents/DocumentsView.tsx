import { ArrowUpRight } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Blueprint } from '../../components/Blueprint';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Sheet } from '../../components/Sheet';
import { StatusBarStyle } from '../../components/StatusBarStyle';
import { Tag } from '../../components/Tag';
import { useToast } from '../../components/Toast';
import { documentCategories, uploadOptions, uploadToast } from '../../data/mock';
import { useDocuments } from '../../state/documents';
import { useTopPad } from '../../theme/layout';
import { HAIRLINE, color, space } from '../../theme/tokens';
import { font, text, tracking } from '../../theme/type';

export type DocumentsViewProps = {
  /** Line under the title — the client the documents belong to. */
  subtitle: string;
  /** Client mode only: the upload button and its sheet. */
  canUpload?: boolean;
  /** Client mode only: the hand-off to the web portal. */
  onOpenPortal?: () => void;
};

/**
 * The documents list, shared by the client's own Files tab and the staff
 * "their files" view. Staff get the same list without the upload affordance
 * or the portal hand-off, both of which are the client's to use.
 */
export function DocumentsView({ subtitle, canUpload = false, onOpenPortal }: DocumentsViewProps) {
  const topPad = useTopPad(64);
  const { documents, upload } = useDocuments();
  const toast = useToast();

  const [filter, setFilter] = useState<(typeof documentCategories)[number]>('All');
  const [sheetOpen, setSheetOpen] = useState(false);

  const visible = documents.filter((doc) => filter === 'All' || doc.category === filter);

  const onUpload = (source: string) => {
    upload(source);
    setSheetOpen(false);
    toast.show(uploadToast);
  };

  return (
    <>
      <Screen scroll>
        <StatusBarStyle style="dark" />
        <View style={[styles.body, { paddingTop: topPad }]}>
          <View style={styles.titleRow}>
            <Text style={text.screenTitle}>Documents</Text>
            {canUpload ? (
              <Button
                variant="primary"
                label="Upload"
                uppercase
                onPress={() => setSheetOpen(true)}
                style={styles.uploadButton}
                labelStyle={styles.uploadLabel}
              />
            ) : null}
          </View>
          <Text style={styles.sub}>{subtitle}</Text>

          {onOpenPortal ? (
            <Button
              variant="secondary"
              label="Open the full client portal"
              onPress={onOpenPortal}
              style={styles.portalButton}
              labelStyle={styles.portalLabel}
              right={<ArrowUpRight size={16} strokeWidth={1.5} color={color.accent} />}
            />
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filters}
            contentContainerStyle={styles.filterRow}>
            {documentCategories.map((category) => (
              <Button
                key={category}
                variant={filter === category ? 'primary' : 'secondary'}
                label={category}
                onPress={() => setFilter(category)}
                labelStyle={styles.filterLabel}
              />
            ))}
          </ScrollView>

          <View style={styles.list}>
            {visible.map((doc) => (
              <Blueprint key={doc.id} style={styles.docRow}>
                <View style={styles.kind}>
                  <Text style={styles.kindLabel}>{doc.kind}</Text>
                </View>
                <View style={styles.docText}>
                  <Text style={styles.docName} numberOfLines={1}>
                    {doc.name}
                  </Text>
                  <Text style={styles.docMeta}>{doc.meta}</Text>
                </View>
                <Tag label={doc.status.label} tone={doc.status.tone} />
              </Blueprint>
            ))}
          </View>
        </View>
      </Screen>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <Text style={styles.sheetTitle}>Add a document</Text>
        <Text style={styles.sheetSub}>It goes straight to your accountant, encrypted.</Text>
        <View style={styles.sheetOptions}>
          {uploadOptions.map((option) => (
            <Button
              key={option}
              variant="secondary"
              label={option}
              onPress={() => onUpload(option)}
              style={styles.sheetOption}
              labelStyle={styles.sheetOptionLabel}
            />
          ))}
        </View>
        <Button
          variant="ghost"
          label="Cancel"
          onPress={() => setSheetOpen(false)}
          style={styles.cancel}
          labelStyle={styles.cancelLabel}
        />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.screenX,
    paddingBottom: 30,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 42,
  },
  uploadButton: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    minHeight: 42,
  },
  uploadLabel: {
    fontSize: 12,
  },
  sub: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 6,
  },
  portalButton: {
    marginTop: 14,
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  portalLabel: {
    fontSize: 14,
    flex: 1,
  },

  filters: {
    marginTop: 20,
    // A horizontal scroller inside a vertical one must not try to fill.
    flexGrow: 0,
  },
  filterRow: {
    gap: 7,
    paddingBottom: 2,
  },
  filterLabel: {
    fontSize: 13,
  },

  list: {
    marginTop: 18,
    gap: space.cardGap,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  kind: {
    width: 34,
    height: 42,
    borderWidth: HAIRLINE,
    borderColor: color.divider,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 5,
  },
  kindLabel: {
    fontFamily: font.body,
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: tracking(9, 0.08),
    color: color.neutral600,
  },
  docText: {
    flex: 1,
    minWidth: 0,
  },
  docName: {
    fontFamily: font.semibold,
    fontSize: 14.5,
    lineHeight: 19,
    color: color.text,
  },
  docMeta: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 3,
  },

  sheetTitle: {
    fontFamily: font.head,
    fontSize: 26,
    lineHeight: 26,
    textTransform: 'uppercase',
    color: color.text,
  },
  sheetSub: {
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.neutral600,
    marginTop: 5,
  },
  sheetOptions: {
    marginTop: 18,
    gap: 8,
  },
  sheetOption: {
    justifyContent: 'flex-start',
    paddingVertical: 15,
    paddingHorizontal: 16,
    minHeight: 50,
  },
  sheetOptionLabel: {
    fontSize: 15,
  },
  cancel: {
    marginTop: 10,
    paddingVertical: 14,
    minHeight: 48,
  },
  cancelLabel: {
    fontSize: 14,
  },
});
