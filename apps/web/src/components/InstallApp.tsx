import { Menu } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload } from '@tabler/icons-react';
import { isStandalone, promptInstall, useCanInstall } from '../pwa';

/** iPhone/iPad: installing only works by hand, through the Share menu. */
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** "Install app" in the user menu, when the browser can install it and it isn't installed already. */
export function InstallMenuItem() {
  const canInstall = useCanInstall();
  if (isStandalone()) return null;
  if (canInstall) {
    return (
      <Menu.Item leftSection={<IconDownload size={16} />} onClick={() => void promptInstall()}>
        Install app
      </Menu.Item>
    );
  }
  if (isIos()) {
    return (
      <Menu.Item
        leftSection={<IconDownload size={16} />}
        onClick={() =>
          notifications.show({
            title: 'Install Magpie',
            message: 'In Safari, tap the Share button, then “Add to Home Screen”.',
            autoClose: 10_000,
          })
        }
      >
        Install app
      </Menu.Item>
    );
  }
  return null;
}
