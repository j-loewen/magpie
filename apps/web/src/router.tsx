import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet } from '@tanstack/react-router';
import { AppLayout } from './components/AppLayout';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { FolderPage } from './pages/FolderPage';
import { NoteRedirect } from './components/NoteDialog';
import { sharedSearch, validateNoteSearch } from './lib/note-dialog';
import { SearchPage } from './pages/SearchPage';
import { SharedPage } from './pages/SharedPage';
import { ShareTargetPage } from './pages/ShareTargetPage';
import { TrashPage } from './pages/TrashPage';

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
const registerRoute = createRoute({ getParentRoute: () => rootRoute, path: '/register', component: RegisterPage });

/**
 * Everything below requires login (guarded in AppLayout). Every page can have a note open in a
 * dialog over it (`?note=…`, see lib/note-dialog).
 */
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: AppLayout, validateSearch: validateNoteSearch });

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: () => <FolderPage folderId={null} />,
});

const folderRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/f/$folderId',
  component: function FolderRoute() {
    const { folderId } = folderRoute.useParams();
    return <FolderPage key={folderId} folderId={folderId} />;
  },
});

/** Old note addresses (bookmarks, links in notes): the note's folder with the note open over it. */
const noteRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/n/$noteId',
  component: function NoteRoute() {
    return <NoteRedirect noteId={noteRoute.useParams().noteId} />;
  },
});

const searchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/search',
  validateSearch: (search: Record<string, unknown>): { q: string } => ({
    q: typeof search.q === 'string' ? search.q : '',
  }),
  component: function SearchRoute() {
    const { q } = searchRoute.useSearch();
    return <SearchPage q={q} />;
  },
});

/** Android share sheet (share_target in the web app manifest): turns what was shared into a new note. */
const shareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/share',
  validateSearch: sharedSearch,
  component: function ShareRoute() {
    return <ShareTargetPage shared={shareRoute.useSearch()} />;
  },
});

const trashRoute = createRoute({ getParentRoute: () => appRoute, path: '/trash', component: TrashPage });
const sharedRoute = createRoute({ getParentRoute: () => appRoute, path: '/shared', component: SharedPage });

// Rarely used pages are split into their own chunks.
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('./pages/SettingsPage'), 'SettingsPage'),
});
const adminUsersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/users',
  component: lazyRouteComponent(() => import('./pages/AdminUsersPage'), 'AdminUsersPage'),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  appRoute.addChildren([homeRoute, folderRoute, noteRoute, searchRoute, shareRoute, trashRoute, sharedRoute, settingsRoute, adminUsersRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
