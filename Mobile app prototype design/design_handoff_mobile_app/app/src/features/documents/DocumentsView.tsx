import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { ArrowUpRight } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import * as portal from '../../api/portal';
import { Async, Empty } from '../../components/Async';
import { BlueprintPressable } from '../../components/Blueprint';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Sheet } from '../../components/Sheet';
import { StatusBarStyle } from '../../components/StatusBarStyle';
import { Tag } from '../../components/Tag';
import { useToast } from '../../components/Toast';
import { DEFAULT_UPLOAD_CATEGORY, uploadToast } from '../../data/content';
import { useQuery } from '../../lib/useQuery';
import { useSession } from '../../state/session';
import { useTopPad } from '../../theme/layout';
import { HAIRLINE, color, space } from '../../theme/tokens';
import { font, text, tracking } from '../../theme/type';

export type DocumentsViewProps = {
  /** Whose documents these are. */
  clientId: number;
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
export function DocumentsView({
  clientId,
  subtitle,
  canUpload = false,
  onOpenPortal,
}: DocumentsViewProps) {
  const topPad = useTopPad(64);
  const toast = useToast();
  const { account } = useSession();
  const viewerId = account?.id ?? '';

  const query = useQuery(
    useCallback(() => portal.loadDocuments(clientId, viewerId), [clientId, viewerId]),
    [clientId, viewerId],
  );

  const [filter, setFilter] = useState('All');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const upload = async (pick: () => Promise<PickedFile | null>) => {
    setSheetOpen(false);
    let file: PickedFile | null = null;
    try {
      file = await pick();
    } catch {
      toast.show('Could not open that.');
      return;
    }
    if (!file) return; // Cancelled.

    setUploading(true);
    try {
      await portal.uploadDocument({
        clientId,
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        category: DEFAULT_UPLOAD_CATEGORY,
      });
      toast.show(uploadToast);
      query.reload();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const open = async (documentId: string) => {
    try {
      await WebBrowser.openBrowserAsync(await portal.documentUrl(documentId));
    } catch {
      toast.show('Could not open that document.');
    }
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
                label={uploading ? 'Sending…' : 'Upload'}
                uppercase
                disabled={uploading}
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

          <Async query={query} loadingLabel="Fetching your documents…">
            {(page) => {
              const categories = ['All', ...page.categories];
              const visible = page.documents.filter(
                (doc) => filter === 'All' || doc.category === filter,
              );

              return (
                <>
                  {categories.length > 1 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.filters}
                      contentContainerStyle={styles.filterRow}>
                      {categories.map((category) => (
                        <Button
                          key={category}
                          variant={filter === category ? 'primary' : 'secondary'}
                          label={category === 'All' ? category : titleCase(category)}
                          onPress={() => setFilter(category)}
                          labelStyle={styles.filterLabel}
                        />
                      ))}
                    </ScrollView>
                  ) : null}

                  <View style={styles.list}>
                    {visible.map((doc) => (
                      <BlueprintPressable
                        key={doc.id}
                        style={styles.docRow}
                        accessibilityLabel={doc.name}
                        onPress={() => open(doc.id)}>
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
                      </BlueprintPressable>
                    ))}
                  </View>

                  {visible.length === 0 ? (
                    <Empty>
                      {page.documents.length === 0
                        ? 'Nothing here yet. Anything you send lands in this list.'
                        : `Nothing filed under ${titleCase(filter)}.`}
                    </Empty>
                  ) : null}
                </>
              );
            }}
          </Async>
        </View>
      </Screen>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <Text style={styles.sheetTitle}>Add a document</Text>
        <Text style={styles.sheetSub}>It goes straight to your accountant, encrypted.</Text>
        <View style={styles.sheetOptions}>
          <Button
            variant="secondary"
            label="Take a photo of a receipt"
            onPress={() => upload(takePhoto)}
            style={styles.sheetOption}
            labelStyle={styles.sheetOptionLabel}
          />
          <Button
            variant="secondary"
            label="Choose from Files"
            onPress={() => upload(chooseFile)}
            style={styles.sheetOption}
            labelStyle={styles.sheetOptionLabel}
          />
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

type PickedFile = { uri: string; name: string; mimeType: string };

async function takePhoto(): Promise<PickedFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Camera permission denied');

  const shot = await ImagePicker.launchCameraAsync({ quality: 0.7, exif: false });
  if (shot.canceled || !shot.assets?.length) return null;

  const asset = shot.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName || `Receipt ${new Date().toISOString().slice(0, 10)}.jpg`,
    mimeType: asset.mimeType || 'image/jpeg',
  };
}

async function chooseFile(): Promise<PickedFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.length) return null;

  const asset = picked.assets[0];
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType || 'application/octet-stream',
  };
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
