# User guide

- [Folders](#folders)
- [Note types](#note-types)
- [Folder views and sorting](#folder-views-and-sorting)
- [Opening, reading and editing notes](#opening-reading-and-editing-notes)
- [Link previews](#link-previews)
- [Search](#search)
- [Trash](#trash)
- [Private folders](#private-folders)
- [Sharing](#sharing)
- [Import and export](#import-and-export)
- [Live updates](#live-updates)
- [Install as an app](#install-as-an-app)
- [Settings](#settings)

## Folders

Folders are in the sidebar and can be nested as deep as you like. **Home** is your top level.

- Create, rename, move or delete a folder from its **…** menu in the sidebar.
- Drag folders in the sidebar to move them. Drag notes onto a folder in the sidebar to move them there. On touch devices, use **Move to…** in the menu.
- The arrow in front of a folder's name takes you one level up.

## Note types

Notes of every type live side by side in the same folder. Create one with **New**.

| Type | What it is |
|---|---|
| **Text** | Rich text: headings, bold, italic, underline, strikethrough, lists, quotes, code, links. |
| **Markdown** | Markdown with live preview. |
| **Code** | Syntax highlighting for more than 100 languages. |
| **Link** | A web address with a page preview (see [Link previews](#link-previews)). |
| **Checklist** | Items with sub-items, drag to reorder. Paste a list to get one item per line. Hide done items, or "uncheck all" for lists you reuse. Cards show the first items and the progress. |
| **Mind map** | Keyboard first: Tab adds a subtopic, Enter a sibling, typing replaces the text. Drag topics to rearrange them, fold branches, undo and redo, pan and zoom (also with touch). |

While editing, click the icon next to a note's name to give it its own icon and colour. **Pin to top** in a note's **…** menu keeps it at the top of its folder.

All keys are listed in [Keyboard shortcuts](keyboard-shortcuts.md).

## Folder views and sorting

The bar at the bottom of the window is always there. On other pages it shows counts (items in the trash, items shared with you, search results). In a folder it shows how many items the folder has, and lets you choose how they are shown:

- **Layout:** cards in a **grid**; **masonry** (cards as tall as their content, packed into columns: longer text, more checklist items, preview images in full); **compact** cards (icon and name); or a **list**.
- **Card size:** smaller cards fit more per row.
- **Sort:** last edited, date created, title, or **custom order**.

**Custom order** lets you arrange the notes by dragging them: a line shows where the note will land. New notes, and notes moved into the folder, are added at the bottom. Switch to another sort and back, and your arrangement is still there. Pinned notes stay above the others.

These settings are saved per folder and per person: people you share a folder with arrange it their own way.

## Opening, reading and editing notes

- A note opens in a **popup** over the folder, sized to the note type: large for Markdown, mind maps and code, small for links. On phones, or with the full-screen button, it fills the screen. **Back** or **Esc** closes it. The address (`?note=…`) can be bookmarked.
- Notes open for **reading** (Markdown rendered, no editing controls). **Edit** (or the `E` key) switches to editing and **Done** back. New notes start in edit mode. Checklist items can be ticked off while reading.
- Clicking a **link note** in a folder, in search or under *Shared with me* opens its web page in a new tab. The note itself opens from its **…** menu (**Open note**).
- **Autosave:** notes save while you type, and Ctrl+S saves at once. If the same note was saved somewhere else in the meantime (another tab, device or person), nothing is overwritten. You choose: keep yours, keep both, or discard yours.

## Link previews

For link notes, the server fetches the page's title, description, site name, preview image, icon and structured data.

- Images are downloaded, resized and stored on your server. Your browser never loads anything from the linked site.
- The fetched page text is searchable.
- Pasted links are cleaned: tracking parameters (`utm_…`, `fbclid`, …) are removed and shop links are shortened (Amazon, eBay, AliExpress, Walmart). **Undo** keeps the original.
- Many kinds of pages show extra details on the card and in the preview:
  - **Shops:** price and rating
  - **Recipes:** time, servings, rating
  - **Movies and shows** (IMDb, TMDB, …): year, runtime or seasons, age rating, genres, rating
  - **Books** (Goodreads, …): author, year, pages, genres, rating
  - **Videos** (YouTube, …): channel, length, views, upload date
  - **Music** (Spotify, Apple Music, …): artist, album, length, number of songs, year, genre
  - **Podcasts:** publisher, episodes, genre, rating; for an episode its show, length and date
  - **Articles and blog posts:** author, date, reading time, section
  - **Wikipedia:** short description, lead paragraph, reading time, last edit
  - **GitHub repositories:** language, stars, forks, license, last update, archived
  - **Stack Overflow and Stack Exchange:** votes, answers (✓ when one was accepted), views, date
  - **Reddit posts:** title, author and subreddit
- Captcha and "robot check" pages are recognised as blocked instead of being shown as the page.
- **Refresh preview** in the note fetches everything again.

Some sites block automated requests. Your admin can route those through FlareSolverr (see [Configuration](configuration.md#link-previews)).

## Search

Ctrl+K jumps to the search box in the sidebar. Search covers note titles and content (including the fetched text of link pages) and matches the beginnings of words, so `pho` finds "photo".

## Trash

Deleted folders and notes go to the **Trash** (bottom of the sidebar). From there you can restore them, including everything inside a folder, or delete them for good. Items are deleted permanently after 30 days (or whatever your admin set).

## Private folders

Mark a folder **private** in its menu and it disappears, with everything inside it, until you unlock private folders with your PIN or password. This PIN is separate from your login; set it up under **Settings → Private folders**.

- Hiding is done by the server: private items don't show up in the sidebar, in search, in the trash, or through direct links.
- Unlocking applies to the current browser only and lasts the number of minutes you choose in Settings. A countdown in the header offers **Lock now** and **Keep unlocked**.
- Open notes are saved before they are locked away.
- Wrong PINs are rate-limited, with an increasing lockout.

## Sharing

Nothing is shared unless you share it.

- As the owner, share a folder (with everything inside it) or a single note from its menu, with specific users, as **Can view** or **Can edit**.
- People with edit access can create, edit, rename and move inside the shared folder. Only the owner can delete things or change sharing.
- Shared items appear under **Shared with me**. Recipients can remove them from there.
- Notes show who edited them last, and the conflict dialog says who saved the other version.
- A recipient can make a shared folder private just for themselves.

## Import and export

**Export** (Settings → Import & export, or a folder's menu) downloads a zip with:

- a file the app can import again exactly, and
- every note as a readable file (Markdown, text, code) in your folder structure.

Single notes can be downloaded from their menu. Private folders are only included while they are unlocked; notes shared with you are not included.

**Import** (Settings, a folder's menu, or drop files onto a folder) understands:

- an export of this app
- **browser bookmarks**: the HTML file Chrome, Firefox, Edge and Safari export. Folders are kept, bookmarks become link notes.
- Markdown (`.md`), text (`.txt`) and code files, or a zip of them (e.g. from another notes app)
- mind maps from OPML and FreeMind (`.opml`, `.mm`)
- `.url` and `.webloc` shortcuts

Imports can be up to 64 MB.

## Live updates

Changes made by other people or on your other devices appear right away, without reloading: folders, note lists, shares, link previews and open notes.

- An open note updates while you are not typing in it. If two people type at the same time, the conflict dialog appears; nothing is overwritten silently.
- Your theme follows you across devices.

## Install as an app

Magpie can be installed and then runs in its own window, with its own icon. This needs HTTPS (or `localhost`).

- **Chrome, Edge (desktop and Android):** user menu → **Install app**, or the install icon in the address bar.
- **iPhone and iPad:** in Safari, Share → **Add to Home Screen**.
- **Firefox desktop:** can't install web apps; use Chrome or Edge for that.

On Android, the installed app appears in the **Share** menu of other apps: sharing a web page creates a link note, sharing text creates a text note. New shared notes go to Home.

Notes stay on the server, not on the device. When the server can't be reached, the app shows a "Can't reach the server" screen.

## Settings

Under **Settings** in the user menu:

- **Profile:** username and display name
- **Appearance:** light, dark or system theme (saved per user)
- **Private folders:** set or change the PIN, and how long unlocking lasts
- **Import & export**
- **Sign-in methods:** connect GitHub or your organisation's sign-in (when your admin turned them on)
- **Password**
- **Storage** (admins only): see [Administration](administration.md#storage)

## Source code and issues

**Magpie on GitHub** in the user menu opens the project's repository, where you can report problems, suggest features and see what changed in each release.
