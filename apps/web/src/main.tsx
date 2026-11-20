import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, MantineProvider, type CSSVariablesResolver } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeSync } from './components/ThemeControls';
import { setupPwa } from './pwa';
import { router } from './router';

const theme = createTheme({
  primaryColor: 'magpie',
  // Shade 7 for buttons, links and other accents: white text on it stays readable (WCAG AA, 4.8:1).
  // Shade 6 is the logo's own blue, which is too light for that (3.6:1).
  primaryShade: { light: 7, dark: 7 },
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  colors: {
    /** Accent colour: the blue of the magpie logo (#0b8ae5, shade 6), lightest to darkest. */
    magpie: ['#edf6fd', '#d1e9fa', '#a2d6fb', '#72c0f8', '#41abf6', '#1a99f4', '#0b8ae5', '#0975c3', '#0864a6', '#064f84'],
    /*
     * Dark mode surfaces. Mantine draws them from these shades: 7 the page and dialogs (the note
     * popup), 6 cards, inputs and default buttons, 5 their hover, 4 borders. 0–3 are text colours
     * (Mantine's own); 8–9 stay darker than the page.
     */
    dark: ['#c9c9c9', '#b8b8b8', '#828282', '#696969', '#2a2b2c', '#2a2b2c', '#191a1b', '#121314', '#0e0f10', '#0a0a0b'],
  },
});

/** The app's own colours (header and sidebar, card hover), per colour scheme. */
const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  // Header and sidebar: in dark mode a step lighter than the page; in light mode the page colour.
  // The note popup has the page's colour in dark mode; a border sets it apart.
  light: { '--notes-chrome': 'var(--mantine-color-body)', '--notes-card-hover': 'var(--mantine-color-white)', '--notes-popup-border': 'transparent' },
  dark: { '--notes-chrome': 'var(--mantine-color-dark-6)', '--notes-card-hover': 'var(--mantine-color-dark-5)', '--notes-popup-border': 'var(--mantine-color-dark-4)' },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

setupPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
      <QueryClientProvider client={queryClient}>
        <Notifications position="bottom-right" />
        <ThemeSync />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
