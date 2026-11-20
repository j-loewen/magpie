/**
 * Facts from a page's schema.org data (JSON-LD, or what a site rule on the server derived from
 * the page), shown on link cards and in the link editor: price and rating of products; time,
 * servings and rating of recipes; year, length, genres and rating of movies and shows; author,
 * year, pages, genres and rating of books; channel, length, views and date of videos;
 * artist, album, length and year of songs and albums;
 * host, episodes, length and date of podcasts; author, date and reading time of articles;
 * short description, reading time and last edit of Wikipedia articles; language, stars, forks,
 * license and last change of code repositories; votes, answers, views and date of questions.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const types = (o: Obj) => [o['@type']].flat().map(String);
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export interface ProductFacts {
  /** Formatted, e.g. "CA$489.99" or "$12.99 – $19.99". */
  price?: string;
  rating?: number;
  reviews?: number;
}

function formatPrice(value: number, currency: unknown): string {
  try {
    if (typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
    }
  } catch {
    // Unknown currency code: fall through.
  }
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(value);
}

function priceOf(offers: unknown): string | undefined {
  for (const offer of [offers].flat().filter(isObj)) {
    const spec = isObj(offer.priceSpecification) ? offer.priceSpecification : {};
    const currency = offer.priceCurrency ?? spec.priceCurrency;
    const price = num(offer.price ?? spec.price);
    if (price !== undefined) return formatPrice(price, currency);
    const low = num(offer.lowPrice);
    const high = num(offer.highPrice);
    if (low !== undefined) return high !== undefined && high !== low ? `${formatPrice(low, currency)} – ${formatPrice(high, currency)}` : formatPrice(low, currency);
  }
  return undefined;
}

export function productFacts(jsonLd: unknown[] | undefined): ProductFacts | undefined {
  const product = jsonLd?.filter(isObj).find((o) => types(o).some((t) => t === 'Product' || t === 'ProductGroup'));
  if (!product) return undefined;
  const rating = isObj(product.aggregateRating) ? product.aggregateRating : undefined;
  const facts: ProductFacts = {
    price: priceOf(product.offers),
    rating: rating ? num(rating.ratingValue) : undefined,
    reviews: rating ? num(rating.reviewCount ?? rating.ratingCount) : undefined,
  };
  return facts.price || facts.rating ? facts : undefined;
}

/** "CA$489.99 · ★ 4.6 (1,234)" */
export function formatFacts(f: ProductFacts): string {
  const parts: string[] = [];
  if (f.price) parts.push(f.price);
  if (f.rating) parts.push(`★ ${f.rating.toFixed(1)}${f.reviews ? ` (${f.reviews.toLocaleString()})` : ''}`);
  return parts.join(' · ');
}

// ---- Recipes ----------------------------------------------------------------------------------

export interface RecipeFacts {
  /** Formatted, e.g. "1 h 15 min". */
  time?: string;
  /** e.g. "4 servings", "2 lattes", "Makes 12 cookies". */
  servings?: string;
  rating?: number;
  reviews?: number;
}

/** ISO 8601 duration ("PT1H30M", "P0DT0H10M", "PT90M") in minutes; undefined if unreadable or 0. */
export function durationMinutes(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(v.trim());
  if (!m) return undefined;
  const [, d = '0', h = '0', min = '0', s = '0'] = m;
  const total = Math.round(Number(d) * 1440 + Number(h) * 60 + Number(min) + Number(s) / 60);
  return total > 0 ? total : undefined;
}

/** 75 → "1 h 15 min", 10 → "10 min", 120 → "2 h". */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const min = total % 60;
  return [h && `${h} h`, min && `${min} min`].filter(Boolean).join(' ');
}

/** recipeYield may be 4, "4", "4 servings" or ["2", "2 lattes"]: the descriptive form wins. */
function servingsOf(v: unknown): string | undefined {
  const all = [v].flat().map((x) => (typeof x === 'number' ? String(x) : typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '')).filter(Boolean);
  const text = all.find((x) => /[a-z]/i.test(x)) ?? all[0];
  if (!text) return undefined;
  if (/^\d+(?:\s*[-–]\s*\d+)?$/.test(text)) return `${text.replace(/\s+/g, '')} ${text === '1' ? 'serving' : 'servings'}`;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

export function recipeFacts(jsonLd: unknown[] | undefined): RecipeFacts | undefined {
  const recipe = jsonLd?.filter(isObj).find((o) => types(o).includes('Recipe'));
  if (!recipe) return undefined;
  const prep = durationMinutes(recipe.prepTime);
  const cook = durationMinutes(recipe.cookTime);
  const total = durationMinutes(recipe.totalTime) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : undefined);
  const rating = isObj(recipe.aggregateRating) ? recipe.aggregateRating : undefined;
  const facts: RecipeFacts = {
    time: total ? formatMinutes(total) : undefined,
    servings: servingsOf(recipe.recipeYield),
    rating: rating ? num(rating.ratingValue) : undefined,
    reviews: rating ? num(rating.ratingCount ?? rating.reviewCount) : undefined,
  };
  return facts.time || facts.servings || facts.rating ? facts : undefined;
}

/** "15 min · 4 servings · ★ 4.7 (1,234)" */
export function formatRecipeFacts(f: RecipeFacts): string {
  return [f.time, f.servings, f.rating && formatFacts({ rating: f.rating, reviews: f.reviews })].filter(Boolean).join(' · ');
}

// ---- Movies and shows -------------------------------------------------------------------------

const MEDIA = ['Movie', 'TVSeries', 'TVMiniSeries', 'TVSeason', 'TVEpisode'];

export interface MediaFacts {
  /** "2026", or "2011–2019" for a series that ended. */
  year?: string;
  /** Movies: "2 h 36 min"; series: "8 seasons" or "73 episodes". */
  length?: string;
  /** Age rating, e.g. "PG-13". */
  contentRating?: string;
  /** Up to two, e.g. "Adventure, Comedy". */
  genres?: string;
  rating?: number;
  /** The scale of `rating` (IMDb and TMDB: 10). */
  bestRating?: number;
  reviews?: number;
}

const yearOf = (v: unknown) => (typeof v === 'string' ? /^\d{4}/.exec(v.trim())?.[0] : undefined);
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export function mediaFacts(jsonLd: unknown[] | undefined): MediaFacts | undefined {
  const item = jsonLd?.filter(isObj).find((o) => types(o).some((t) => MEDIA.includes(t)));
  if (!item) return undefined;
  const series = types(item).some((t) => t === 'TVSeries' || t === 'TVMiniSeries');
  // dateCreated is when the database entry was made, not the release: not used.
  const start = yearOf(item.startDate) ?? yearOf(item.datePublished);
  const end = series ? yearOf(item.endDate) : undefined;
  const minutes = durationMinutes(item.duration);
  const seasons = num(item.numberOfSeasons);
  const episodes = num(item.numberOfEpisodes);
  const genres = [item.genre].flat().filter((g): g is string => typeof g === 'string' && g.trim() !== '');
  const rating = isObj(item.aggregateRating) ? item.aggregateRating : undefined;
  const contentRating = typeof item.contentRating === 'string' ? item.contentRating.trim() : undefined;
  const facts: MediaFacts = {
    year: start && end && end !== start ? `${start}–${end}` : start,
    length: series
      ? seasons
        ? plural(seasons, 'season')
        : episodes
          ? plural(episodes, 'episode')
          : undefined
      : minutes
        ? formatMinutes(minutes)
        : undefined,
    // "Not Rated", "Unrated" and the like say nothing.
    contentRating: contentRating && !/^(not ?rated|unrated|n\/?a)$/i.test(contentRating) ? contentRating : undefined,
    genres: genres.length ? genres.slice(0, 2).join(', ') : undefined,
    rating: rating ? num(rating.ratingValue) : undefined,
    bestRating: rating ? num(rating.bestRating) : undefined,
    reviews: rating ? num(rating.ratingCount ?? rating.reviewCount) : undefined,
  };
  return facts.year || facts.length || facts.rating ? facts : undefined;
}

/** "2026 · 2 h 36 min · PG · Adventure, Comedy · ★ 8.2/10 (605,665)" */
export function formatMediaFacts(f: MediaFacts): string {
  // Ratings out of 10 (IMDb, TMDB) say so; out of 5 they read like product stars.
  const scale = f.bestRating && f.bestRating !== 5 ? `/${f.bestRating}` : '';
  const rating = f.rating ? `★ ${f.rating.toFixed(1)}${scale}${f.reviews ? ` (${f.reviews.toLocaleString()})` : ''}` : undefined;
  return [f.year, f.length, f.contentRating, f.genres, rating].filter(Boolean).join(' · ');
}

// ---- Books ------------------------------------------------------------------------------------

export interface BookFacts {
  /** First author, e.g. "J.R.R. Tolkien" (later "authors" are often illustrators or editors). */
  author?: string;
  year?: string;
  /** e.g. "366 pages" */
  pages?: string;
  /** Up to two, e.g. "Fantasy, Classics". */
  genres?: string;
  rating?: number;
  bestRating?: number;
  reviews?: number;
}

export function bookFacts(jsonLd: unknown[] | undefined): BookFacts | undefined {
  const book = jsonLd?.filter(isObj).find((o) => types(o).includes('Book'));
  if (!book) return undefined;
  const firstAuthor = [book.author].flat()[0];
  const author = typeof firstAuthor === 'string' ? firstAuthor : isObj(firstAuthor) && typeof firstAuthor.name === 'string' ? firstAuthor.name : undefined;
  const pages = num(book.numberOfPages);
  const genres = [book.genre].flat().filter((g): g is string => typeof g === 'string' && g.trim() !== '');
  const rating = isObj(book.aggregateRating) ? book.aggregateRating : undefined;
  const facts: BookFacts = {
    author: author?.trim() || undefined,
    year: yearOf(book.datePublished) ?? yearOf(book.copyrightYear === undefined ? undefined : String(book.copyrightYear)),
    pages: pages ? plural(pages, 'page') : undefined,
    genres: genres.length ? genres.slice(0, 2).join(', ') : undefined,
    rating: rating ? num(rating.ratingValue) : undefined,
    bestRating: rating ? num(rating.bestRating) : undefined,
    reviews: rating ? num(rating.ratingCount ?? rating.reviewCount) : undefined,
  };
  return facts.author || facts.year || facts.pages || facts.rating ? facts : undefined;
}

/** "J.R.R. Tolkien · 1937 · 366 pages · Fantasy, Classics · ★ 4.3 (4,671,934)" */
export function formatBookFacts(f: BookFacts): string {
  const scale = f.bestRating && f.bestRating !== 5 ? `/${f.bestRating}` : '';
  const rating = f.rating ? `★ ${f.rating.toFixed(1)}${scale}${f.reviews ? ` (${f.reviews.toLocaleString()})` : ''}` : undefined;
  return [f.author, f.year, f.pages, f.genres, rating].filter(Boolean).join(' · ');
}

// ---- Videos -----------------------------------------------------------------------------------

export interface VideoFacts {
  /** Channel or author, e.g. "Rick Astley". */
  channel?: string;
  /** "3:34", "1:02:15" */
  length?: string;
  /** "1.8B views" */
  views?: string;
  /** Upload date, e.g. "Oct 24, 2009". */
  date?: string;
}

/** Items that describe the site rather than the page, skipped when looking for the page's subject. */
const NOT_SUBJECT = new Set(['WebSite', 'WebPage', 'Organization', 'BreadcrumbList', 'Person', 'ImageObject', 'SiteNavigationElement']);

/** ISO 8601 duration in whole seconds ("PT3M34S" → 214); undefined if unreadable or 0. */
function durationSeconds(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(v.trim());
  if (!m) return undefined;
  const total = Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Math.round(Number(m[4] ?? 0));
  return total > 0 ? total : undefined;
}

/** "PT3M34S" → "3:34", "PT1H2M15S" → "1:02:15" (video players' style). */
function clockTime(v: unknown): string | undefined {
  const total = durationSeconds(v);
  if (!total) return undefined;
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(min).padStart(2, '0')}:${s}` : `${min}:${s}`;
}

function watchCount(stats: unknown): number | undefined {
  for (const s of [stats].flat().filter(isObj)) {
    const type = isObj(s.interactionType) ? s.interactionType['@type'] : s.interactionType;
    if (typeof type === 'string' && /WatchAction$/.test(type)) return num(s.userInteractionCount);
  }
  return undefined;
}

/**
 * Facts of a video page (YouTube and others). Only when the video is what the page is about,
 * not a clip embedded in an article.
 */
export function videoFacts(jsonLd: unknown[] | undefined): VideoFacts | undefined {
  const subject = jsonLd?.filter(isObj).find((o) => !types(o).every((t) => NOT_SUBJECT.has(t)));
  if (!subject || !types(subject).includes('VideoObject')) return undefined;
  const author = [subject.author].flat()[0];
  const channel = typeof author === 'string' ? author : isObj(author) && typeof author.name === 'string' ? author.name : undefined;
  const views = watchCount(subject.interactionStatistic);
  // The calendar day as published ("2009-10-24T23:57:33-07:00" is Oct 24, wherever it is viewed).
  const day = typeof subject.uploadDate === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(subject.uploadDate) : null;
  const uploaded = day ? new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))) : undefined;
  const facts: VideoFacts = {
    channel: channel?.trim() || undefined,
    length: clockTime(subject.duration),
    views: views !== undefined ? `${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(views)} views` : undefined,
    date:
      uploaded && !Number.isNaN(uploaded.getTime())
        ? uploaded.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
        : undefined,
  };
  return facts.channel || facts.length || facts.views ? facts : undefined;
}

/** "Rick Astley · 3:34 · 1.8B views · Oct 24, 2009" */
export function formatVideoFacts(f: VideoFacts): string {
  return [f.channel, f.length, f.views, f.date].filter(Boolean).join(' · ');
}

// ---- Music ------------------------------------------------------------------------------------

export interface MusicFacts {
  type: 'song' | 'album';
  artist?: string;
  /** Songs: the album they are on. */
  album?: string;
  /** Albums: "Album", "Single", "EP", "Compilation". */
  kind?: string;
  /** Songs: "3:34"; albums: "42 min" (when the songs' lengths are known). */
  length?: string;
  year?: string;
  /** Albums: "10 songs". */
  songs?: string;
  /** The main genre, e.g. "Rock". */
  genre?: string;
}

/** A name from a string, an object with a name, or the first of a list of those. */
function nameOf(v: unknown): string | undefined {
  const first = [v].flat()[0];
  const name = typeof first === 'string' ? first : isObj(first) && typeof first.name === 'string' ? first.name : undefined;
  return name?.trim() || undefined;
}

/** "single", "http://schema.org/SingleRelease" → "Single"; "ep" → "EP". */
function releaseKind(v: unknown): string | undefined {
  const raw = typeof v === 'string' ? v.replace(/^.*\//, '').replace(/Release$/i, '').trim() : '';
  if (!raw || /^broadcast$/i.test(raw)) return undefined;
  return /^ep$/i.test(raw) ? 'EP' : raw[0]!.toUpperCase() + raw.slice(1).toLowerCase();
}

/** The album's songs: `track` (schema.org; a list or an ItemList) or `tracks` (Apple Music). */
function trackList(album: Obj): unknown[] | undefined {
  const t = album.track ?? album.tracks;
  if (Array.isArray(t)) return t;
  if (isObj(t) && Array.isArray(t.itemListElement)) return t.itemListElement.map((e) => (isObj(e) && isObj(e.item) ? e.item : e));
  return undefined;
}

/** Facts of a song or album page (Spotify, Apple Music, …), when that is what the page is about. */
export function musicFacts(jsonLd: unknown[] | undefined): MusicFacts | undefined {
  let subject = jsonLd?.filter(isObj).find((o) => !types(o).every((t) => NOT_SUBJECT.has(t)));
  if (!subject) return undefined;
  // Apple Music describes a song as a composition whose `audio` is the recording.
  if (types(subject).includes('MusicComposition') && isObj(subject.audio) && types(subject.audio).includes('MusicRecording')) {
    subject = { datePublished: subject.datePublished, ...subject.audio };
  }
  const t = types(subject);
  const recording = t.includes('MusicRecording');
  if (!recording && !t.includes('MusicAlbum')) return undefined;
  const list = recording ? undefined : trackList(subject);
  const tracks = num(subject.numTracks) ?? list?.length;
  // Album length: the sum of its songs, when every song's length is known.
  const songSeconds = list?.map((s) => (isObj(s) ? durationSeconds(s.duration) : undefined));
  const albumSeconds = songSeconds?.length && songSeconds.every((s) => s !== undefined) ? songSeconds.reduce((a, b) => a! + b!, 0)! : undefined;
  const genre = [subject.genre].flat().find((g): g is string => typeof g === 'string' && g.trim() !== '' && !/^music$/i.test(g.trim()));
  const facts: MusicFacts = {
    type: recording ? 'song' : 'album',
    artist: nameOf(subject.byArtist),
    album: recording ? nameOf(subject.inAlbum) : undefined,
    kind: recording ? undefined : releaseKind(subject.albumReleaseType),
    length: recording ? clockTime(subject.duration) : albumSeconds ? formatMinutes(Math.round(albumSeconds / 60)) : undefined,
    year: yearOf(subject.datePublished),
    songs: !recording && tracks ? plural(tracks, 'song') : undefined,
    genre: genre?.trim(),
  };
  return facts.artist || facts.length || facts.songs ? facts : undefined;
}

/**
 * Songs: "Pink Floyd · The Dark Side of the Moon · 2:49 · 1973";
 * albums: "Pink Floyd · Album · 1973 · 10 songs · 42 min · Rock".
 */
export function formatMusicFacts(f: MusicFacts): string {
  const parts = f.type === 'song' ? [f.artist, f.album, f.length, f.year, f.genre] : [f.artist, f.kind, f.year, f.songs, f.length, f.genre];
  return parts.filter(Boolean).join(' · ');
}

// ---- Podcasts ---------------------------------------------------------------------------------

export interface PodcastFacts {
  type: 'show' | 'episode';
  /** Shows: host or publisher, e.g. "The New York Times". */
  by?: string;
  /** Episodes: the show, e.g. "The Daily". */
  show?: string;
  /** Episodes: "26 min", "2 h 40 min". */
  length?: string;
  /** Episodes: release day, e.g. "Nov 18, 2026". */
  date?: string;
  /** Shows: "549 episodes". */
  episodes?: string;
  genre?: string;
  rating?: number;
  reviews?: number;
}

/** "2026-11-18…" → "Nov 18, 2026" (the calendar day as published, in any time zone). */
function calendarDate(v: unknown): string | undefined {
  const day = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  if (!day) return undefined;
  const date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Facts of a podcast show or episode page (Apple Podcasts, Spotify, …). */
export function podcastFacts(jsonLd: unknown[] | undefined): PodcastFacts | undefined {
  const subject = jsonLd?.filter(isObj).find((o) => !types(o).every((t) => NOT_SUBJECT.has(t)));
  if (!subject) return undefined;
  const t = types(subject);
  const genre = [subject.genre].flat().find((g): g is string => typeof g === 'string' && g.trim() !== '' && !/^podcasts?$/i.test(g.trim()))?.trim();
  if (t.includes('PodcastEpisode')) {
    const seconds = durationSeconds(subject.duration) ?? durationSeconds(subject.timeRequired);
    const facts: PodcastFacts = {
      type: 'episode',
      show: nameOf(subject.partOfSeries),
      length: seconds ? formatMinutes(Math.max(1, Math.round(seconds / 60))) : undefined,
      date: calendarDate(subject.datePublished),
      genre,
    };
    return facts.show || facts.length || facts.date ? facts : undefined;
  }
  if (!t.includes('PodcastSeries')) return undefined;
  const rating = isObj(subject.aggregateRating) ? subject.aggregateRating : undefined;
  const episodes = num(subject.numberOfEpisodes);
  const facts: PodcastFacts = {
    type: 'show',
    by: nameOf(subject.author) ?? nameOf(subject.publisher) ?? nameOf(subject.productionCompany),
    episodes: episodes ? plural(episodes, 'episode') : undefined,
    genre,
    rating: rating ? num(rating.ratingValue) : undefined,
    reviews: rating ? num(rating.ratingCount ?? rating.reviewCount) : undefined,
  };
  return facts.by || facts.episodes || facts.rating ? facts : undefined;
}

/** Shows: "The New York Times · 549 episodes · Daily News · ★ 4.3 (106,219)"; episodes: "The Daily · 26 min · Nov 18, 2026". */
export function formatPodcastFacts(f: PodcastFacts): string {
  const rating = f.rating ? `★ ${f.rating.toFixed(1)}${f.reviews ? ` (${f.reviews.toLocaleString()})` : ''}` : undefined;
  const parts = f.type === 'episode' ? [f.show, f.length, f.date] : [f.by, f.episodes, f.genre, rating];
  return parts.filter(Boolean).join(' · ');
}

// ---- Articles ---------------------------------------------------------------------------------

export interface ArticleFacts {
  /** "Jonathan Beale", "A and B", "A and 2 others" */
  by?: string;
  /** Publication day, e.g. "Nov 18, 2026". */
  date?: string;
  /** "6 min read" */
  reading?: string;
  /** e.g. "Consumer" */
  section?: string;
}

const ARTICLE = /^(\w*NewsArticle|Article|BlogPosting|TechArticle|Report)$/;
/** Words per minute for the reading time. */
const READING_WPM = 230;

/** Facts of an article page (news sites, blogs, …), when the article is what the page is about. */
export function articleFacts(jsonLd: unknown[] | undefined): ArticleFacts | undefined {
  const subject = jsonLd?.filter(isObj).find((o) => !types(o).every((t) => NOT_SUBJECT.has(t)));
  if (!subject || !types(subject).some((t) => ARTICLE.test(t))) return undefined;
  const authors = [subject.author].flat().map((a) => nameOf(a)).filter((a): a is string => Boolean(a));
  const unique = [...new Set(authors)];
  const by = unique.length > 2 ? `${unique[0]} and ${unique.length - 1} others` : unique.join(' and ') || undefined;
  const words = num(subject.wordCount);
  const section = [subject.articleSection].flat().find((x): x is string => typeof x === 'string' && x.trim() !== '')?.trim();
  const facts: ArticleFacts = {
    by,
    date: calendarDate(subject.datePublished),
    reading: words ? `${Math.max(1, Math.round(words / READING_WPM))} min read` : undefined,
    section,
  };
  return facts.by || facts.date ? facts : undefined;
}

/** "Ariel Rabinovitch · Nov 18, 2026 · 5 min read · Consumer" */
export function formatArticleFacts(f: ArticleFacts): string {
  return [f.by, f.date, f.reading, f.section].filter(Boolean).join(' · ');
}

// ---- Encyclopedia articles (Wikipedia) ----------------------------------------------------------

export interface EncyclopediaFacts {
  /** The article's short description, e.g. "German-born theoretical physicist (1879–1955)". */
  about?: string;
  /** "61 min read" */
  reading?: string;
  /** Last edit, e.g. "Nov 17, 2026". */
  edited?: string;
}

/** Wikipedia's articles are about a Wikidata item (and their author is "Contributors to …"). */
const isWikidataEntity = (v: unknown) => typeof v === 'string' && /^https?:\/\/(www\.)?wikidata\.org\/entity\/Q\d+$/.test(v);

export function encyclopediaFacts(jsonLd: unknown[] | undefined): EncyclopediaFacts | undefined {
  const subject = jsonLd?.filter(isObj).find((o) => !types(o).every((t) => NOT_SUBJECT.has(t)));
  if (!subject || !types(subject).some((t) => ARTICLE.test(t))) return undefined;
  if (![subject.mainEntity, subject.sameAs].flat().some(isWikidataEntity)) return undefined;
  const headline = typeof subject.headline === 'string' ? subject.headline.replace(/\s+/g, ' ').trim() : '';
  // Short descriptions are written to follow a name ("city in Manitoba, Canada").
  const about = headline.charAt(0).toLocaleUpperCase() + headline.slice(1);
  const words = num(subject.wordCount);
  const facts: EncyclopediaFacts = {
    about: about || undefined,
    reading: words ? `${Math.max(1, Math.round(words / READING_WPM))} min read` : undefined,
    edited: calendarDate(subject.dateModified),
  };
  return facts.about || facts.reading || facts.edited ? facts : undefined;
}

/** "German-born theoretical physicist (1879–1955) · 61 min read · edited Nov 17, 2026" */
export function formatEncyclopediaFacts(f: EncyclopediaFacts): string {
  return [f.about, f.reading, f.edited && `edited ${f.edited}`].filter(Boolean).join(' · ');
}

// ---- Code repositories (GitHub) ---------------------------------------------------------------

export interface SoftwareFacts {
  /** The repository is archived (read-only, no longer maintained). */
  archived?: boolean;
  /** Main language, e.g. "TypeScript". */
  language?: string;
  /** Stars, e.g. "252.7K". */
  stars?: string;
  /** e.g. "52.8K forks" */
  forks?: string;
  /** e.g. "MIT" */
  license?: string;
  /** Last change, e.g. "Nov 18, 2026". */
  updated?: string;
}

const compactNumber = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function interactionCount(stats: unknown, action: string): number | undefined {
  for (const s of [stats].flat().filter(isObj)) {
    const type = isObj(s.interactionType) ? s.interactionType['@type'] : s.interactionType;
    if (typeof type === 'string' && type.endsWith(action)) return num(s.userInteractionCount);
  }
  return undefined;
}

/** Facts of a code repository page (GitHub: stars are likes, forks are shares). */
export function softwareFacts(jsonLd: unknown[] | undefined): SoftwareFacts | undefined {
  const subject = jsonLd?.filter(isObj).find((o) => !types(o).every((t) => NOT_SUBJECT.has(t)));
  if (!subject || !types(subject).includes('SoftwareSourceCode')) return undefined;
  const stars = interactionCount(subject.interactionStatistic, 'LikeAction');
  const forks = interactionCount(subject.interactionStatistic, 'ShareAction');
  const language = [subject.programmingLanguage].flat().map((l) => nameOf(l)).find(Boolean);
  const license = [subject.license].flat().find((l): l is string => typeof l === 'string' && l.trim() !== '' && !/^https?:/.test(l))?.trim();
  const facts: SoftwareFacts = {
    archived: subject.creativeWorkStatus === 'Archived' || undefined,
    language,
    // No stars yet is not worth a mention (like no forks).
    stars: stars ? compactNumber(stars) : undefined,
    forks: forks ? `${compactNumber(forks)} ${forks === 1 ? 'fork' : 'forks'}` : undefined,
    license,
    updated: calendarDate(subject.dateModified),
  };
  return Object.values(facts).some((v) => v !== undefined) ? facts : undefined;
}

/** "TypeScript · ★ 252.7K · 52.8K forks · MIT · updated Nov 18, 2026" (archived ones start with "Archived"). */
export function formatSoftwareFacts(f: SoftwareFacts): string {
  return [f.archived && 'Archived', f.language, f.stars && `★ ${f.stars}`, f.forks, f.license, f.updated && `updated ${f.updated}`]
    .filter(Boolean)
    .join(' · ');
}

// ---- Questions (Stack Overflow, Stack Exchange) -------------------------------------------------

export interface QuestionFacts {
  /** e.g. "Closed: Duplicate" */
  status?: string;
  /** e.g. "27.3K votes" */
  votes?: string;
  /** e.g. "105 answers", "No answers" */
  answers?: string;
  /** One of the answers was accepted by the asker. */
  accepted?: boolean;
  /** e.g. "16.8M views" */
  views?: string;
  /** Asked on, e.g. "May 29, 2009". */
  asked?: string;
}

/** Facts of a question page (schema.org QAPage or Question: Stack Overflow and other Q&A sites). */
export function questionFacts(jsonLd: unknown[] | undefined): QuestionFacts | undefined {
  const subject = jsonLd?.filter(isObj).find((o) => !types(o).every((t) => NOT_SUBJECT.has(t)));
  if (!subject) return undefined;
  const question = types(subject).includes('QAPage') ? [subject.mainEntity].flat().find(isObj) : subject;
  if (!question || !types(question).includes('Question')) return undefined;
  const votes = num(question.upvoteCount);
  const answers = num(question.answerCount);
  const views = interactionCount(question.interactionStatistic, 'ViewAction');
  const facts: QuestionFacts = {
    status: typeof question.creativeWorkStatus === 'string' ? question.creativeWorkStatus.trim() || undefined : undefined,
    votes: votes !== undefined ? `${compactNumber(votes)} ${Math.abs(votes) === 1 ? 'vote' : 'votes'}` : undefined,
    answers: answers === undefined ? undefined : answers === 0 ? 'No answers' : `${compactNumber(answers)} ${answers === 1 ? 'answer' : 'answers'}`,
    accepted: question.acceptedAnswer !== undefined || undefined,
    views: views !== undefined ? `${compactNumber(views)} views` : undefined,
    asked: calendarDate(question.dateCreated),
  };
  return facts.votes || facts.answers || facts.asked ? facts : undefined;
}

/** "27.3K votes · ✓ 105 answers · 16.8M views · asked May 29, 2009" (✓: an answer was accepted). */
export function formatQuestionFacts(f: QuestionFacts): string {
  const answers = f.answers && (f.accepted ? `✓ ${f.answers}` : f.answers);
  return [f.status, f.votes, answers, f.views, f.asked && `asked ${f.asked}`].filter(Boolean).join(' · ');
}

// ---- All kinds ----------------------------------------------------------------------------------

/** Each kind of page with its facts, in the order they are tried. */
const KINDS: ((jsonLd: unknown[] | undefined) => string | undefined)[] = [
  (ld) => { const f = productFacts(ld); return f && formatFacts(f); },
  (ld) => { const f = recipeFacts(ld); return f && formatRecipeFacts(f); },
  (ld) => { const f = mediaFacts(ld); return f && formatMediaFacts(f); },
  (ld) => { const f = bookFacts(ld); return f && formatBookFacts(f); },
  (ld) => { const f = videoFacts(ld); return f && formatVideoFacts(f); },
  (ld) => { const f = musicFacts(ld); return f && formatMusicFacts(f); },
  (ld) => { const f = podcastFacts(ld); return f && formatPodcastFacts(f); },
  (ld) => { const f = softwareFacts(ld); return f && formatSoftwareFacts(f); },
  (ld) => { const f = questionFacts(ld); return f && formatQuestionFacts(f); },
  (ld) => { const f = encyclopediaFacts(ld); return f && formatEncyclopediaFacts(f); },
  // Last: a page can be an article *about* a product, a recipe, a movie, … (those win).
  (ld) => { const f = articleFacts(ld); return f && formatArticleFacts(f); },
];

/**
 * The page's key facts in one line, from its schema.org data: products ("CA$489.99 · ★ 4.6
 * (1,234)"), recipes ("15 min · 4 servings · ★ 4.7 (210)"), movies and shows ("2026 · 2 h 36 min ·
 * PG · Adventure, Comedy · ★ 8.2/10"), books ("J.R.R. Tolkien · 1937 · 366 pages · Fantasy ·
 * ★ 4.3"), videos ("Rick Astley · 3:34 · 1.8B views · Oct 24, 2009"), songs and albums ("Pink Floyd
 * · Album · 1973 · 10 songs · 43 min · Rock"), podcasts ("The Daily · 26 min · Nov 18, 2026"), Wikipedia articles
 * ("German-born theoretical physicist (1879–1955) · 61 min read · edited Nov 17, 2026"), code
 * repositories ("TypeScript · ★ 252.7K · 52.8K forks · MIT · updated Nov 18, 2026"), questions
 * ("27.3K votes · ✓ 105 answers · 16.8M views · asked May 29, 2009"), articles
 * ("Ariel Rabinovitch · Nov 18, 2026 · 5 min read · Consumer").
 * Empty when the page is none of these.
 */
export function pageFactsText(jsonLd: unknown[] | undefined): string {
  for (const kind of KINDS) {
    const text = kind(jsonLd);
    if (text) return text;
  }
  return '';
}
