import { Image, Text } from '@mantine/core';
import { IconWorld } from '@tabler/icons-react';
import type { LinkMetaDto } from '@notes/shared';
import type { NoteCardProps } from '../editor-kit/types';
import { pageFactsText } from './product';

export const linkMeta = (meta: unknown) => meta as LinkMetaDto | undefined;

export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function Favicon({ src, size = 16 }: { src?: string; size?: number }) {
  return src ? (
    <Image src={src} w={size} h={size} fit="contain" alt="" style={{ flexShrink: 0 }} />
  ) : (
    <IconWorld size={size} stroke={1.6} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
  );
}

/** Key facts of the page in one line, e.g. "CA$489.99 · ★ 4.6 (1,234)" (see pageFactsText). */
export function PageFacts({ jsonLd, size = 'sm', mt }: { jsonLd?: unknown[]; size?: 'xs' | 'sm'; mt?: number }) {
  const text = pageFactsText(jsonLd);
  if (!text) return null;
  return (
    <Text size={size} fw={600} mt={mt}>
      {text}
    </Text>
  );
}

/** Card body for link notes in folder views: domain, key facts and page description. The whole card opens the page (see openUrl). */
export function LinkCardBody({ meta, expanded }: NoteCardProps) {
  const m = linkMeta(meta);
  const url = m?.finalUrl || m?.url;
  if (!url) {
    return (
      <Text size="xs" c="dimmed" mt={6}>
        No link yet
      </Text>
    );
  }
  return (
    <>
      <Text size="xs" c="dimmed" truncate="end" mt={6}>
        {hostOf(url)}
      </Text>
      <PageFacts jsonLd={m?.jsonLd} size="xs" mt={4} />
      {m?.status === 'pending' && (
        <Text size="xs" c="dimmed" mt={4} fs="italic">
          Fetching preview…
        </Text>
      )}
      {m?.description && (
        <Text size="xs" c="dimmed" lineClamp={expanded ? 6 : 3} mt={4}>
          {m.description}
        </Text>
      )}
    </>
  );
}
