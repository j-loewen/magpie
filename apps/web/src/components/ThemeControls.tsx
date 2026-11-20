import { useEffect } from 'react';
import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import type { Theme } from '@notes/shared';
import { useMe, useUpdatePrefs } from '../auth';

const toScheme = (theme: Theme): MantineColorScheme => (theme === 'system' ? 'auto' : theme);

/** Applies the logged-in user's saved theme (prefs live on the server, so it follows them across devices). */
export function ThemeSync() {
  const { data: me } = useMe();
  const { setColorScheme } = useMantineColorScheme();
  const theme = me?.prefs.theme;
  useEffect(() => {
    if (theme) setColorScheme(toScheme(theme));
  }, [theme, setColorScheme]);
  // The installed app's title bar (and mobile browser chrome) takes the header's colour.
  const computed = useComputedColorScheme('light');
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    // --notes-chrome: the header's colour (see main.tsx), resolved to a colour value.
    const color = getComputedStyle(document.documentElement).getPropertyValue('--notes-chrome').trim();
    if (meta) meta.content = color || (computed === 'dark' ? '#191a1b' : '#ffffff');
  }, [computed]);
  return null;
}

const NEXT: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
const ICON = { light: IconSun, dark: IconMoon, system: IconDeviceDesktop };
const LABEL = { light: 'Light theme', dark: 'Dark theme', system: 'System theme' };

/** Header button cycling light → dark → system. */
export function ThemeToggle() {
  const { data: me } = useMe();
  const updatePrefs = useUpdatePrefs();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const current: Theme = me?.prefs.theme ?? (colorScheme === 'auto' ? 'system' : colorScheme);
  const Icon = ICON[current];

  const cycle = () => {
    const next = NEXT[current];
    setColorScheme(toScheme(next));
    if (me) updatePrefs.mutate({ theme: next });
  };

  return (
    <Tooltip label={`${LABEL[current]} (click to change)`}>
      <ActionIcon variant="default" size="lg" onClick={cycle} aria-label={LABEL[current]}>
        <Icon size={18} stroke={1.6} />
      </ActionIcon>
    </Tooltip>
  );
}
