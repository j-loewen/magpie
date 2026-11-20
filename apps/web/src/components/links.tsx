import type { AnchorHTMLAttributes, Ref } from 'react';
import { ActionIcon, Anchor, type ActionIconProps, type AnchorProps } from '@mantine/core';
import { createLink, type LinkComponent } from '@tanstack/react-router';

type MantineAnchorProps = AnchorProps & AnchorHTMLAttributes<HTMLAnchorElement> & { ref?: Ref<HTMLAnchorElement> };

function MantineAnchor(props: MantineAnchorProps) {
  return <Anchor {...props} />;
}

const CreatedAnchorLink = createLink(MantineAnchor);

/** Mantine Anchor with type-checked router links (route params included). */
export const AnchorLink: LinkComponent<typeof MantineAnchor> = (props) => <CreatedAnchorLink preload="intent" {...props} />;

function PlainAnchor({ ref, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { ref?: Ref<HTMLAnchorElement> }) {
  return <a ref={ref} {...props} style={{ color: 'inherit', textDecoration: 'none', ...props.style }} />;
}

/** Unstyled router link (for cards and tiles). */
export const PlainLink: LinkComponent<typeof PlainAnchor> = createLink(PlainAnchor);

type MantineActionIconProps = ActionIconProps & AnchorHTMLAttributes<HTMLAnchorElement> & { ref?: Ref<HTMLAnchorElement> };

function MantineActionIconAnchor(props: MantineActionIconProps) {
  return <ActionIcon component="a" {...props} />;
}

/** Mantine ActionIcon as a type-checked router link (icon buttons that go somewhere). */
export const ActionIconLink: LinkComponent<typeof MantineActionIconAnchor> = createLink(MantineActionIconAnchor);
