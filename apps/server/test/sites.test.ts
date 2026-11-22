import { describe, expect, it } from 'vitest';
import { articleFacts, bookFacts, cleanUrl, durationMinutes, encyclopediaFacts, formatBookFacts, formatFacts, formatMediaFacts, formatMinutes, formatMusicFacts, formatPodcastFacts, formatRecipeFacts, formatVideoFacts, mediaFacts, musicFacts, pageFactsText, podcastFacts, productFacts, questionFacts, recipeFacts, softwareFacts, videoFacts } from '@notes/note-types';
import { extractMetadata } from '../src/links/extract';
import { looksBlocked } from '../src/links/flaresolverr';
import {
  githubApiUrl,
  needsBrowser,
  parsePrice,
  redditOembedUrl,
  redditPageFromOembed,
  redditPostUrl,
  stackExchangePage,
  stackExchangeQuestion,
  titleFromUrl,
  withGitHubApi,
} from '../src/links/sites';

describe('titleFromUrl (name for pages that block previews)', () => {
  it('reads the product or article name from the address', () => {
    expect(titleFromUrl('https://www.walmart.ca/en/ip/WD-Red-Plus-WD80EFPX-Hard-drive-8-TB-internal-3-5-SATA-6Gb-s-5640-rpm-buffer-256-MB/30LWQC75P0D4')).toBe(
      'WD Red Plus WD80EFPX Hard drive 8 TB internal 3 5 SATA 6Gb s 5640 rpm buffer 256 MB',
    );
    expect(titleFromUrl('https://www.bestbuy.ca/en-ca/product/ubiquiti-25-gbps-multi-mode-optical-module-silver-udm-se/19862978')).toBe(
      'Ubiquiti 25 gbps multi mode optical module silver udm se',
    );
    expect(titleFromUrl('https://www.amazon.ca/UCTRONICS-Raspberry-Mounting-Thumbscrews-Removable/dp/B09QQ9TQWL?crid=2M62&sr=8-9')).toBe(
      'UCTRONICS Raspberry Mounting Thumbscrews Removable',
    );
    expect(titleFromUrl('https://blog.test/2024/05/caf%C3%A9_au_lait_recipe.html')).toBe('Café au lait recipe');
  });

  it('gives up on addresses without a name', () => {
    expect(titleFromUrl('https://www.amazon.ca/dp/B09QQ9TQWL')).toBeUndefined();
    expect(titleFromUrl('https://www.bestbuy.ca/en-ca/product/19862978')).toBeUndefined();
    expect(titleFromUrl('https://shop.test/item/46c93973-e628-11f1-9760-7d1fd7fb5f8f')).toBeUndefined();
    expect(titleFromUrl('https://shop.test/')).toBeUndefined();
    expect(titleFromUrl('not a url')).toBeUndefined();
  });
});

/** The parts of an Amazon product page the site rule reads (Amazon has no JSON-LD or og: tags). */
const AMAZON_PAGE = `<!doctype html><html><head>
<title>Amazon.ca: WD Red Plus 8TB NAS Internal Hard Drive : Electronics</title>
<meta name="description" content="Buy WD Red Plus 8TB online at low price in Canada on Amazon.ca">
</head><body>
<span id="productTitle" class="a-size-large product-title-word-break">
   WD Red Plus 8TB NAS Internal Hard Drive HDD - 5640 RPM, SATA 6 Gb/s &amp; CMR
</span>
<div id="averageCustomerReviews"><span id="acrPopover" class="reviewCountTextLinkedHistogram" title="4.6 out of 5 stars">
<i class="a-icon a-icon-star"><span class="a-icon-alt">4.6 out of 5 stars</span></i></span>
<span id="acrCustomerReviewText" class="a-size-base">12,345 ratings</span></div>
<div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">$289.99</span><span aria-hidden="true">$289<span>.99</span></span></span></div>
<div id="imgTagWrapperId"><img alt="WD Red" src="https://m.media-amazon.com/images/I/small._AC_SX38_.jpg"
  data-old-hires="" id="landingImage"
  data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/a._AC_SX300_.jpg&quot;:[300,300],&quot;https://m.media-amazon.com/images/I/a._AC_SL1500_.jpg&quot;:[1500,1500]}"></div>
<div id="feature-bullets"><ul>
<li><span class="a-list-item"> Specifically designed for NAS systems with up to 8 bays </span></li>
<li><span class="a-list-item"> CMR technology </span></li>
<li><span class="a-list-item"> 3-year limited warranty </span></li>
<li><span class="a-list-item"> Fourth bullet is not shown </span></li>
</ul></div>
</body></html>`;

describe('Amazon pages', () => {
  it('reads the product name, image, price, rating and bullet points', () => {
    const md = extractMetadata(AMAZON_PAGE, 'https://www.amazon.ca/dp/B0CMQ6SK7W');
    expect(md).toMatchObject({
      title: 'WD Red Plus 8TB NAS Internal Hard Drive HDD - 5640 RPM, SATA 6 Gb/s & CMR',
      siteName: 'Amazon.ca',
      image: 'https://m.media-amazon.com/images/I/a._AC_SL1500_.jpg',
      description: 'Specifically designed for NAS systems with up to 8 bays · CMR technology · 3-year limited warranty',
    });
    expect(md.jsonLd).toContainEqual({
      '@type': 'Product',
      name: 'WD Red Plus 8TB NAS Internal Hard Drive HDD - 5640 RPM, SATA 6 Gb/s & CMR',
      image: 'https://m.media-amazon.com/images/I/a._AC_SL1500_.jpg',
      sku: 'B0CMQ6SK7W',
      offers: { '@type': 'Offer', price: 289.99, priceCurrency: 'CAD' },
      aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.6, reviewCount: 12345 },
    });
    const facts = productFacts(md.jsonLd)!;
    expect(facts).toMatchObject({ rating: 4.6, reviews: 12345 });
    expect(facts.price).toMatch(/289\.99/);
    expect(formatFacts(facts)).toMatch(/289\.99 · ★ 4\.6 \(12,345\)$/);
  });

  it('leaves other sites alone, and only strips the "Amazon.ca:" prefix when nothing better is found', () => {
    expect(extractMetadata('<title>Amazon.ca: Something</title>', 'https://www.amazon.ca/s?k=x').title).toBe('Something');
    expect(extractMetadata('<title>Amazon.ca: Something</title>', 'https://example.com/').title).toBe('Amazon.ca: Something');
  });

  it('parses prices in different formats', () => {
    expect(parsePrice('$289.99')).toBe(289.99);
    expect(parsePrice('CDN$ 1,234.56')).toBe(1234.56);
    expect(parsePrice('1.234,56 €')).toBe(1234.56);
    expect(parsePrice('¥1,980')).toBe(1980);
    expect(parsePrice('Currently unavailable')).toBeUndefined();
  });

  it('recognises captcha pages that keep the normal title', () => {
    const captcha = '<title>Amazon.ca</title><form method="get" action="/errors/validateCaptcha"><input name="field-keywords"></form>';
    expect(looksBlocked(200, captcha)).toBe(true);
    expect(looksBlocked(200, '<title>Robot Check</title>')).toBe(true);
    expect(looksBlocked(200, '<title>Pardon Our Interruption</title>')).toBe(true);
    expect(looksBlocked(200, AMAZON_PAGE)).toBe(false);
  });
});

describe('cleanUrl', () => {
  it('shortens shop product links', () => {
    const long =
      'https://www.amazon.ca/Western-Digital-Plus-Internal-Drive/dp/B0CMQ6SK7W?crid=SWUN57BLBZ9E&dib=eyJ2IjoiMSJ9.BOC&dib_tag=se&keywords=wd%2Bred&qid=1794965711&s=electronics&sr=1-1&th=1';
    expect(cleanUrl(long)).toBe('https://www.amazon.ca/dp/B0CMQ6SK7W');
    expect(cleanUrl('https://www.amazon.com/gp/product/b0cmq6sk7w/ref=ox_sc_act_title_1?smid=A1&psc=1')).toBe('https://www.amazon.com/dp/B0CMQ6SK7W');
    expect(cleanUrl('https://www.ebay.ca/itm/Some-Title/123456789012?hash=item1&_trkparms=x')).toBe('https://www.ebay.ca/itm/123456789012');
    expect(cleanUrl('https://www.aliexpress.com/item/1005001234567890.html?spm=a2g0o&algo_pvid=x')).toBe('https://www.aliexpress.com/item/1005001234567890.html');
    expect(cleanUrl('https://www.walmart.ca/en/ip/WD-Red-Plus-WD80EFPX/30LWQC75P0D4?fulfillmentIntent=Delivery&filters=%5B%5D&classType=REGULAR')).toBe(
      'https://www.walmart.ca/en/ip/WD-Red-Plus-WD80EFPX/30LWQC75P0D4',
    );
    expect(cleanUrl('https://www.walmart.com/ip/Some-Product/123456789?athbdg=L1600&from=/search')).toBe('https://www.walmart.com/ip/Some-Product/123456789');
    // Other Walmart pages keep their query (it is the search).
    expect(cleanUrl('https://www.walmart.ca/en/search?q=hard+drive')).toBe('https://www.walmart.ca/en/search?q=hard+drive');
  });

  it('drops tracking parameters and keeps the rest', () => {
    expect(cleanUrl('https://example.com/post?id=7&utm_source=news&utm_medium=mail&fbclid=abc#top')).toBe('https://example.com/post?id=7#top');
    expect(cleanUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz&t=42')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42');
    expect(cleanUrl('https://youtu.be/dQw4w9WgXcQ?si=xyz')).toBe('https://youtu.be/dQw4w9WgXcQ');
    // Unchanged links keep their exact text.
    expect(cleanUrl(' https://example.com/a b?q=1 ')).toBe('https://example.com/a b?q=1');
    expect(cleanUrl('not a url')).toBe('not a url');
    expect(cleanUrl('mailto:me@example.com?utm_source=x')).toBe('mailto:me@example.com?utm_source=x');
  });
});

describe('product facts', () => {
  it('reads offers, price ranges and ratings from JSON-LD', () => {
    expect(productFacts([{ '@type': 'WebSite' }])).toBeUndefined();
    const range = productFacts([{ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: '10', highPrice: '20', priceCurrency: 'USD' } }]);
    expect(range?.price).toMatch(/10.*–.*20/);
    const spec = productFacts([{ '@type': ['Product'], offers: [{ priceSpecification: { price: 5.5, priceCurrency: 'EUR' } }] }]);
    expect(spec?.price).toMatch(/5[.,]50/);
  });
});

/** AliExpress as fetched directly: name and image only; the product data is built in the browser. */
const ALI_PLAIN = `<html><head><title>Kingston NV3 NVMe SSD 1TB - AliExpress 7</title>
<meta property="og:url" content="//www.aliexpress.com/item/1005007791079105.html?src=ibdm">
<meta property="og:title" content="Kingston NV3 NVMe SSD 1TB - AliExpress 7">
<meta property="og:type" content="product">
<meta property="og:image" content="https://ae-pic-a1.aliexpress-media.com/kf/S598a.jpg">
<meta property="og:description" content="Smarter Shopping, Better Living! Aliexpress.com">
<meta property="og:site_name" content="aliexpress.">
</head><body><script>window._d_c_.isCSR = true;</script></body></html>`;

/** The same page rendered by a browser (FlareSolverr), which adds JSON-LD. */
const ALI_RENDERED = ALI_PLAIN.replace(
  '</head>',
  `<script type="application/ld+json">[{"@context":"https://schema.org/","@type":"Product","name":"Kingston NV3 NVMe SSD 1TB - AliExpress 7",
  "description":"Kingston NV3 PCIe 4.0 M.2 2280 NVMe SSD, up to 6000MB/s read.","brand":{"@type":"Brand","name":"KingSton"},
  "offers":{"@type":"Offer","availability":"https://schema.org/InStock","priceCurrency":"CAD","price":"128.74"},
  "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"53"}},
  {"@type":"VideoObject","name":"Kingston NV3 NVMe SSD 1TB - AliExpress 7"}]</script></head>`,
);

describe('AliExpress pages', () => {
  const url = 'https://www.aliexpress.com/item/1005007791079105.html';

  it('cleans up name, site name and the slogan description of the plain page', () => {
    const md = extractMetadata(ALI_PLAIN, url);
    expect(md).toMatchObject({ title: 'Kingston NV3 NVMe SSD 1TB', siteName: 'AliExpress', ogType: 'product', description: undefined });
    expect(md.canonicalUrl).toBe('https://www.aliexpress.com/item/1005007791079105.html?src=ibdm');
    expect(productFacts(md.jsonLd)).toBeUndefined();
  });

  it('reads price, rating and description from the rendered page', () => {
    const md = extractMetadata(ALI_RENDERED, url);
    expect(md.title).toBe('Kingston NV3 NVMe SSD 1TB');
    expect(md.description).toBe('Kingston NV3 PCIe 4.0 M.2 2280 NVMe SSD, up to 6000MB/s read.');
    expect(md.jsonLd.map((o) => (o as { name: string }).name)).toEqual(['Kingston NV3 NVMe SSD 1TB', 'Kingston NV3 NVMe SSD 1TB']);
    const facts = productFacts(md.jsonLd);
    expect(facts).toMatchObject({ rating: 4.8, reviews: 53 });
    expect(facts?.price).toMatch(/128[.,]74/);
  });

  it('knows which pages need a browser to show their product data', () => {
    const needs = (html: string, url = 'https://shop.test/p/1') => needsBrowser(extractMetadata(html, url));
    expect(needs(ALI_PLAIN, 'https://www.aliexpress.com/item/1.html')).toBe(true);
    expect(needs(ALI_RENDERED, 'https://www.aliexpress.com/item/1.html')).toBe(false);
    expect(needs('<meta content="product" property="og:type">')).toBe(true);
    expect(needs('<meta property="og:type" content="product.item">')).toBe(true);
    expect(needs('<meta property="og:type" content="article">')).toBe(false);
    expect(needs('<title>No og:type</title>')).toBe(false);
    expect(needs('<meta property="og:type" content="product"><script type="application/ld+json">{"@type": ["Product"]}</script>')).toBe(false);
    // A site rule that reads the product from the markup makes the browser unnecessary.
    expect(needs(LIQUORMARTS, LIQUORMARTS_URL)).toBe(false);
  });
});

// Excerpt of a real product page (Drupal Commerce): no JSON-LD, the data is in the markup.
const LIQUORMARTS_URL = 'https://www.liquormarts.ca/product/moosehead-lager/15-x-355-ml';
const LIQUORMARTS = `<head><meta property="og:site_name" content="Manitoba Liquor Mart" />
<meta property="og:type" content="product" /><meta property="og:title" content="MOOSEHEAD LAGER" />
<link rel="icon" href="/themes/custom/mbll_lm/favicon.png" type="image/png" /></head>
<body><h1><div class="field field--name-field-web-description field--type-string field--label-hidden field__item">MOOSEHEAD LAGER</div></h1>
<div class="product_image"><div data-zooming-gallery class="blazy blazy--zooming field field--name-field-product-image-front field--type-image field--label-hidden field__item">
<img alt="Moosehead Lager" decoding="async" class="media__element b-lazy zooming" loading="lazy" data-src="/sites/mbll-lm/files/styles/product/public/import/images/7246_d671.png?itok=OReoEJ-b" data-original="/sites/mbll-lm/files/import/images/7246_d671.png" src="data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E" width="496" height="350" /></div></div>
<div class="col-md-8 product_basic_details"> <div> <p> <span>Item # 7246 </span> <span> | UPC 776029701876</span> <span> | 15 x 355 ml</span> </p> </div>
<div class="product_price_marketing_program"> <div class="product_price"> $32.79 </div> </div>
<div class="field field--name-field-tasting-notes field--type-string-long field--label-hidden field__item">Moosehead Breweries&#039;flagship brand is a golden lager that is light in body and highly refreshing.</div></div>
<div class="product-specifications-content"> <span class="product_details_title">Category:</span><span class="product_details_detail">
<div class="field field--name-field-category-type field--type-entity-reference field--label-hidden field__items"> <div class="field__item"><a href="/category-type/beer" hreflang="en">Beer</a> <span class="separator"> &gt; </span> <a href="/category-type/lager" hreflang="en">Lager</a> <span class="separator"> &gt; </span> <a href="/category-type/pale-0" hreflang="en">Pale</a> </div> </div></span></div></body>`;

describe('Liquor Marts', () => {
  it('reads name, size, image, price and tasting notes from the page markup', () => {
    const md = extractMetadata(LIQUORMARTS, LIQUORMARTS_URL);
    expect(md).toMatchObject({
      title: 'Moosehead Lager (15 x 355 ml)',
      description: "Moosehead Breweries'flagship brand is a golden lager that is light in body and highly refreshing.",
      siteName: 'Manitoba Liquor Mart',
      image: 'https://www.liquormarts.ca/sites/mbll-lm/files/import/images/7246_d671.png',
    });
    expect(md.jsonLd).toEqual([
      {
        '@type': 'Product',
        name: 'Moosehead Lager',
        image: 'https://www.liquormarts.ca/sites/mbll-lm/files/import/images/7246_d671.png',
        sku: '7246',
        gtin: '776029701876',
        size: '15 x 355 ml',
        category: 'Beer > Lager > Pale',
        description: "Moosehead Breweries'flagship brand is a golden lager that is light in body and highly refreshing.",
        offers: { '@type': 'Offer', price: 32.79, priceCurrency: 'CAD' },
      },
    ]);
    expect(formatFacts(productFacts(md.jsonLd)!)).toMatch(/32\.79/);
  });
});

describe('Reddit posts', () => {
  const post = 'https://www.reddit.com/r/canada/comments/1xyre73/gta_fever_sick_leaves/';

  it('recognises post links on all Reddit hosts and drops the query', () => {
    expect(redditPostUrl(`${post}?utm_source=app_first_navigation&mweb_loid=t2_x`)).toBe(post);
    expect(redditPostUrl('https://old.reddit.com/r/canada/comments/1xyre73/gta_fever_sick_leaves/')).toBe(post);
    expect(redditPostUrl('https://reddit.com/comments/1xyre73')).toBe('https://www.reddit.com/comments/1xyre73');
    expect(redditPostUrl('https://www.reddit.com/user/someone/comments/abc123/my_post/')).toBe('https://www.reddit.com/user/someone/comments/abc123/my_post/');
    expect(redditPostUrl('https://www.reddit.com/r/canada/')).toBeUndefined();
    expect(redditPostUrl('https://www.reddit.com/r/canada/s/AbCdEf')).toBeUndefined();
    expect(redditPostUrl('https://notreddit.com/r/x/comments/abc/')).toBeUndefined();
    expect(redditOembedUrl(post)).toBe(`https://www.reddit.com/oembed?url=${encodeURIComponent(post)}`);
  });

  it('turns the oEmbed answer into title, author and subreddit', () => {
    const html = redditPageFromOembed({ title: `GTA fever: 'Grand Theft Auto VI' <day> & "more"`, author_name: 'NeverEndingDClock', provider_name: 'reddit' }, post)!;
    const md = extractMetadata(html, post);
    expect(md).toMatchObject({
      title: `GTA fever: 'Grand Theft Auto VI' <day> & "more"`,
      description: 'u/NeverEndingDClock in r/canada',
      siteName: 'Reddit',
      canonicalUrl: post,
    });
    expect(md.icons[0]).toBe('https://www.redditstatic.com/shreddit/assets/favicon/64x64.png');
    expect(redditPageFromOembed({ author_name: 'x' }, post)).toBeUndefined();
    expect(redditPageFromOembed(null, post)).toBeUndefined();
  });

  it('removes Reddit share tracking from links', () => {
    expect(cleanUrl(`${post}?utm_source=app_first_navigation&mweb_loid=t2_2mtithx6s8`)).toBe(post);
    expect(cleanUrl(`${post}?share_id=abc&context=3`)).toBe(`${post}?context=3`);
    // Only on Reddit: other sites may use these names for real parameters.
    expect(cleanUrl('https://example.com/?share_id=abc')).toBe('https://example.com/?share_id=abc');
  });

  it('recognises Reddit\'s captcha page', () => {
    expect(looksBlocked(200, '<title>Reddit - Prove your humanity</title>')).toBe(true);
  });
});

describe('recipe facts', () => {
  it('reads time, servings and rating', () => {
    // Allrecipes: total time, yield as ["2", "2 lattes"].
    const latte = recipeFacts([{ '@type': ['Recipe'], prepTime: 'PT5M', cookTime: 'PT5M', totalTime: 'PT10M', recipeYield: ['2', '2 lattes'] }]);
    expect(latte).toEqual({ time: '10 min', servings: '2 lattes', rating: undefined, reviews: undefined });
    expect(formatRecipeFacts(latte!)).toBe('10 min · 2 lattes');

    const stew = recipeFacts([
      { '@type': 'WebSite' },
      { '@type': 'Recipe', prepTime: 'PT20M', cookTime: 'PT1H35M', recipeYield: 6, aggregateRating: { ratingValue: '4.7', ratingCount: '1234' } },
    ]);
    expect(stew).toMatchObject({ time: '1 h 55 min', servings: '6 servings', rating: 4.7, reviews: 1234 });
    expect(formatRecipeFacts(stew!)).toMatch(/^1 h 55 min · 6 servings · ★ 4\.7 \(1.234\)$/);
  });

  it('handles the many ways sites write durations and yields', () => {
    expect(durationMinutes('PT1H30M')).toBe(90);
    expect(durationMinutes('P0DT0H10M')).toBe(10);
    expect(durationMinutes('PT90M')).toBe(90);
    expect(durationMinutes('P1DT2H')).toBe(1560);
    expect(durationMinutes('PT0M')).toBeUndefined();
    expect(durationMinutes('10 minutes')).toBeUndefined();
    expect(formatMinutes(120)).toBe('2 h');
    expect(recipeFacts([{ '@type': 'Recipe', recipeYield: '1' }])?.servings).toBe('1 serving');
    expect(recipeFacts([{ '@type': 'Recipe', recipeYield: '4 - 6' }])?.servings).toBe('4-6 servings');
    expect(recipeFacts([{ '@type': 'Recipe', recipeYield: 'Makes 12 cookies' }])?.servings).toBe('Makes 12 cookies');
    expect(recipeFacts([{ '@type': 'Recipe', cookTime: 'PT45M' }])?.time).toBe('45 min');
    // Nothing worth showing.
    expect(recipeFacts([{ '@type': 'Recipe', name: 'Toast' }])).toBeUndefined();
    expect(recipeFacts([{ '@type': 'Product' }])).toBeUndefined();
  });
});

describe('movies and shows', () => {
  /** IMDb (rendered by FlareSolverr): name, rating and genres crammed into og:title. */
  const IMDB_PAGE = `<html><head><title>Project Hail Mary (2026) - IMDb</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Movie","name":"Project Hail Mary",
"description":"A science teacher wakes up alone on a spaceship.","datePublished":"2026-03-20","duration":"PT2H36M",
"genre":["Adventure","Comedy","Sci-Fi"],"contentRating":"PG",
"aggregateRating":{"@type":"AggregateRating","ratingCount":605665,"bestRating":10,"worstRating":1,"ratingValue":8.2}}</script>
<meta property="og:site_name" content="IMDb">
<meta property="og:title" content="Project Hail Mary (2026) ⭐ 8.2 | Adventure, Comedy, Sci-Fi">
<meta property="og:description" content="2h 36m | PG">
<meta property="og:type" content="video.movie"></head></html>`;

  it('gives IMDb pages their plain name, year and plot', () => {
    const md = extractMetadata(IMDB_PAGE, 'https://www.imdb.com/title/tt12042730/');
    expect(md).toMatchObject({ title: 'Project Hail Mary (2026)', description: 'A science teacher wakes up alone on a spaceship.', siteName: 'IMDb' });
    // Without JSON-LD, at least the rating and genres come off the name.
    const plain = extractMetadata(IMDB_PAGE.replace(/<script[\s\S]*?<\/script>/, ''), 'https://www.imdb.com/title/tt12042730/');
    expect(plain.title).toBe('Project Hail Mary (2026)');
    // Other sites keep their titles.
    expect(extractMetadata(IMDB_PAGE, 'https://example.com/').title).toBe('Project Hail Mary (2026) ⭐ 8.2 | Adventure, Comedy, Sci-Fi');
  });

  it('reads year, length, age rating, genres and rating', () => {
    const imdb = mediaFacts(extractMetadata(IMDB_PAGE, 'https://www.imdb.com/title/tt12042730/').jsonLd)!;
    expect(imdb).toMatchObject({ year: '2026', length: '2 h 36 min', contentRating: 'PG', genres: 'Adventure, Comedy', rating: 8.2, bestRating: 10, reviews: 605665 });
    expect(formatMediaFacts(imdb)).toMatch(/^2026 · 2 h 36 min · PG · Adventure, Comedy · ★ 8\.2\/10 \(605.665\)$/);

    // TMDB series: start year, episodes, rating with two decimals.
    const got = mediaFacts([
      { '@type': 'TVSeries', name: 'Game of Thrones', startDate: '2011-04-17T00:00:00Z', dateCreated: '2013-10-10T15:32:46Z', genre: ['Sci-Fi & Fantasy', 'Drama', 'Action & Adventure'], numberOfEpisodes: 73, aggregateRating: { bestRating: 10, ratingValue: 8.5, ratingCount: 28207 } },
      { '@type': 'WebSite', name: 'The Movie Database' },
    ])!;
    expect(formatMediaFacts(got)).toMatch(/^2011 · 73 episodes · Sci-Fi & Fantasy, Drama · ★ 8\.5\/10 \(28.207\)$/);

    // A finished series with seasons; "Not Rated" is left out; 5-star scales look like products.
    const ended = mediaFacts([{ '@type': ['TVSeries'], startDate: '2008', endDate: '2013-09-29', numberOfSeasons: 5, contentRating: 'Not Rated', aggregateRating: { ratingValue: '4.9', bestRating: '5' } }])!;
    expect(formatMediaFacts(ended)).toBe('2008–2013 · 5 seasons · ★ 4.9');
    expect(mediaFacts([{ '@type': 'Movie', name: 'Only a name' }])).toBeUndefined();
    expect(mediaFacts([{ '@type': 'Recipe', totalTime: 'PT10M' }])).toBeUndefined();
  });
});

describe('books', () => {
  /** The parts of a Goodreads book page that are read. */
  const GOODREADS_PAGE = `<html><head><meta property="og:title" content="The Hobbit, or There and Back Again"><meta property="og:type" content="books.book">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Book","name":"The Hobbit, or There and Back Again","bookFormat":"Paperback","numberOfPages":366,
"author":[{"@type":"Person","name":"J.R.R. Tolkien"},{"@type":"Person","name":"Michael Hague"}],"aggregateRating":{"@type":"AggregateRating","ratingValue":4.3,"ratingCount":4671934,"reviewCount":96500}}</script></head>
<body><p data-testid="pagesFormat">366 pages, Paperback</p><p data-testid="publicationInfo">First published September 21, 1937</p>
<div data-testid="genresList"><ul aria-label="Top genres for this book"><span class="BookPageMetadataSection__genreButton"><a href="/genres/fantasy"><span class="Button__labelItem">Fantasy</span></a></span>
<span class="BookPageMetadataSection__genreButton"><a href="/genres/classics"><span class="Button__labelItem">Classics</span></a></span>
<span class="BookPageMetadataSection__genreButton"><a href="/genres/fiction"><span class="Button__labelItem">Fiction</span></a></span>
<span class="Button__labelItem">...more</span></ul></div></body></html>`;

  it('adds the first publication year and genres on Goodreads', () => {
    const md = extractMetadata(GOODREADS_PAGE, 'https://www.goodreads.com/book/show/5907.The_Hobbit');
    expect(md.jsonLd[0]).toMatchObject({ '@type': 'Book', datePublished: '1937', genre: ['Fantasy', 'Classics', 'Fiction'] });
    const facts = bookFacts(md.jsonLd)!;
    expect(facts).toMatchObject({ author: 'J.R.R. Tolkien', year: '1937', pages: '366 pages', genres: 'Fantasy, Classics', rating: 4.3, reviews: 4671934 });
    expect(formatBookFacts(facts)).toMatch(/^J\.R\.R\. Tolkien · 1937 · 366 pages · Fantasy, Classics · ★ 4\.3 \(4.671.934\)$/);
    // Other sites are not changed.
    expect(extractMetadata(GOODREADS_PAGE, 'https://example.com/book').jsonLd[0]).not.toHaveProperty('datePublished');
  });

  it('reads Book data from any site', () => {
    expect(formatBookFacts(bookFacts([{ '@type': 'Book', author: 'Ursula K. Le Guin', datePublished: '1969-03-01', numberOfPages: '304' }])!)).toBe('Ursula K. Le Guin · 1969 · 304 pages');
    expect(bookFacts([{ '@type': 'Book', name: 'Only a name' }])).toBeUndefined();
    expect(bookFacts([{ '@type': 'Movie', datePublished: '2020' }])).toBeUndefined();
  });
});

describe('videos', () => {
  /** The parts of a YouTube watch page that are read: sparse JSON-LD, microdata, player data. */
  const YOUTUBE_PAGE = `<html><head><meta property="og:title" content="Rick Astley - Never Gonna Give You Up"><meta property="og:type" content="video.other">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"Rick Astley - Never Gonna Give You Up","uploadDate":"2009-10-24T23:57:33-07:00"}</script></head>
<body><div itemscope itemtype="http://schema.org/VideoObject"><meta itemprop="duration" content="PT3M34S">
<span itemprop="author" itemscope itemtype="http://schema.org/Person"><link itemprop="url" href="http://www.youtube.com/@RickAstleyYT"><link itemprop="name" content="Rick Astley"></span>
<div itemprop="interactionStatistic" itemscope><meta itemprop="interactionType" content="https://schema.org/LikeAction"><meta itemprop="userInteractionCount" content="19511302"></div>
<div itemprop="interactionStatistic" itemscope><meta itemprop="interactionType" content="https://schema.org/WatchAction"><meta itemprop="userInteractionCount" content="1838557942"></div></div>
<script>var ytInitialPlayerResponse = {"videoDetails":{"lengthSeconds":"213","viewCount":"1838557942","author":"Rick Astley"},"microformat":{"category":"Film \u0026 Animation","ownerChannelName":"Rick Astley"}};</script></body></html>`;

  it('adds length, channel, views and category on YouTube', () => {
    const md = extractMetadata(YOUTUBE_PAGE, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(md.jsonLd[0]).toMatchObject({
      duration: 'PT3M34S',
      author: { name: 'Rick Astley' },
      genre: 'Film & Animation',
      interactionStatistic: [
        { interactionType: 'https://schema.org/WatchAction', userInteractionCount: 1838557942 },
        { interactionType: 'https://schema.org/LikeAction', userInteractionCount: 19511302 },
      ],
    });
    const facts = videoFacts(md.jsonLd)!;
    expect(facts).toMatchObject({ channel: 'Rick Astley', length: '3:34' });
    expect(facts.views).toMatch(/^1[.,]8\s?B views$/);
    expect(facts.date).toMatch(/Oct\w*\.? 24,? 2009|24\.? Oct/);
    expect(formatVideoFacts(facts)).toMatch(/^Rick Astley · 3:34 · 1[.,]8\s?B views · /);
  });

  it('only describes pages that are about the video', () => {
    expect(videoFacts([{ '@type': 'VideoObject', duration: 'PT1H2M15S', author: 'Someone' }])).toMatchObject({ length: '1:02:15', channel: 'Someone' });
    expect(videoFacts([{ '@type': 'WebSite' }, { '@type': 'VideoObject', duration: 'PT45S' }])?.length).toBe('0:45');
    // A news article with an embedded clip is about the article.
    expect(videoFacts([{ '@type': 'NewsArticle', headline: 'News' }, { '@type': 'VideoObject', duration: 'PT2M' }])).toBeUndefined();
    expect(videoFacts([{ '@type': 'VideoObject', name: 'Only a name' }])).toBeUndefined();
  });
});

describe('music', () => {
  /** The parts of Spotify song and album pages that are read. */
  const SPOTIFY_SONG = `<html><head><meta property="og:title" content="Never Gonna Give You Up"><meta property="og:type" content="music.song">
<meta property="og:description" content="Rick Astley · Whenever You Need Somebody · Song · 1987">
<meta name="music:duration" content="214"><meta name="music:album" content="https://open.spotify.com/album/6eUW0wxWtzkFdaEFsTJto6">
<meta name="music:release_date" content="1987-11-16"><meta name="music:musician_description" content="Rick Astley">
<script type="application/ld+json">{"@context":"http://schema.googleapis.com/","@type":["CreativeWork","MusicRecording"],"name":"Never Gonna Give You Up","datePublished":"1987-11-16"}</script></head></html>`;
  const SPOTIFY_ALBUM = `<html><head><meta property="og:title" content="Listen to Whenever You Need Somebody - Single by Rick Astley | Spotify">
<meta property="og:description" content="Rick Astley · single · 1987 · 10 songs"><meta property="og:type" content="music.album">
<script type="application/ld+json">{"@type":"MusicAlbum","name":"Whenever You Need Somebody","datePublished":"1987-11-16"}</script></head></html>`;

  it('reads artist, album and length of Spotify songs', () => {
    const md = extractMetadata(SPOTIFY_SONG, 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8');
    expect(md.description).toBeUndefined();
    expect(formatMusicFacts(musicFacts(md.jsonLd)!)).toBe('Rick Astley · Whenever You Need Somebody · 3:34 · 1987');
  });

  it('reads artist, type and songs of Spotify albums, with a clean name', () => {
    const md = extractMetadata(SPOTIFY_ALBUM, 'https://open.spotify.com/album/6eUW0wxWtzkFdaEFsTJto6');
    expect(md.title).toBe('Whenever You Need Somebody');
    expect(formatMusicFacts(musicFacts(md.jsonLd)!)).toBe('Rick Astley · Single · 1987 · 10 songs');
    // Other sites keep their title and description.
    expect(extractMetadata(SPOTIFY_ALBUM, 'https://example.com/a').description).toBe('Rick Astley · single · 1987 · 10 songs');
  });

  it('reads standard schema.org music data from other sites', () => {
    expect(
      formatMusicFacts(musicFacts([{ '@type': 'MusicAlbum', byArtist: [{ '@type': 'MusicGroup', name: 'Pink Floyd' }], albumReleaseType: 'https://schema.org/AlbumRelease', datePublished: '1973-03-01', track: { '@type': 'ItemList', itemListElement: [{}, {}, {}] } }])!),
    ).toBe('Pink Floyd · Album · 1973 · 3 songs');
    expect(musicFacts([{ '@type': 'MusicRecording', byArtist: 'Daft Punk', duration: 'PT5M37S' }])).toMatchObject({ artist: 'Daft Punk', length: '5:37' });
    expect(musicFacts([{ '@type': 'MusicGroup', name: 'Rick Astley' }])).toBeUndefined();
  });
});

describe('Apple Music', () => {
  const ALBUM = `<html><head><meta name="apple:title" content="The Dark Side of the Moon">
<meta property="og:title" content="The Dark Side of the Moon by Pink Floyd on Apple Music"><meta property="og:description" content="Album · 1973 · 10 Songs">
<meta property="og:site_name" content="Apple Music - Web Player"><meta property="og:type" content="music.album">
<script type="application/ld+json">{"@context":"http://schema.org","@type":"MusicAlbum","name":"The Dark Side of the Moon","datePublished":"1973-03-01",
"genre":["Rock","Music","Progressive Rock"],"byArtist":[{"@type":"MusicGroup","name":"Pink Floyd"}],
"tracks":[{"@type":"MusicRecording","name":"Speak to Me","duration":"PT1M4S"},{"@type":"MusicRecording","name":"Breathe (In the Air)","duration":"PT2M49S"},{"@type":"MusicRecording","name":"On the Run","duration":"PT3M36S"}]}</script></head></html>`;
  const SONG = `<html><head><meta name="apple:title" content="Breathe (In the Air)">
<meta property="og:title" content="Breathe (In the Air) by Pink Floyd on Apple Music"><meta property="og:description" content="Song · 1973 · Duration 2:49">
<meta property="og:site_name" content="Apple Music - Web Player"><meta property="og:type" content="music.song">
<script type="application/ld+json">{"@context":"http://schema.org","@type":"MusicComposition","name":"Breathe (In the Air)","datePublished":"1973-03-01","timeRequired":"PT2M49S",
"audio":{"@type":"MusicRecording","name":"Breathe (In the Air)","duration":"PT2M49S","genre":["Rock","Music"],"byArtist":[{"@type":"MusicGroup","name":"Pink Floyd"}],
"inAlbum":{"@type":"MusicAlbum","name":"The Dark Side of the Moon"}}}</script></head></html>`;

  it('reads albums: type, songs, total length and genre, with a plain name', () => {
    const md = extractMetadata(ALBUM, 'https://music.apple.com/us/album/the-dark-side-of-the-moon/1065973699');
    expect(md).toMatchObject({ title: 'The Dark Side of the Moon', siteName: 'Apple Music', description: undefined });
    expect(formatMusicFacts(musicFacts(md.jsonLd)!)).toBe('Pink Floyd · Album · 1973 · 3 songs · 7 min · Rock');
  });

  it('reads songs from the recording inside the composition', () => {
    const md = extractMetadata(SONG, 'https://music.apple.com/us/song/breathe-in-the-air/1065973704');
    expect(md.title).toBe('Breathe (In the Air)');
    expect(formatMusicFacts(musicFacts(md.jsonLd)!)).toBe('Pink Floyd · The Dark Side of the Moon · 2:49 · 1973 · Rock');
  });

  it('tidies artist pages too', () => {
    const md = extractMetadata('<meta property="og:title" content="Pink Floyd on Apple Music"><meta property="og:site_name" content="Apple Music - Web Player">', 'https://music.apple.com/us/artist/pink-floyd/487143');
    expect(md).toMatchObject({ title: 'Pink Floyd', siteName: 'Apple Music' });
  });
});

describe('podcasts', () => {
  const APPLE_SHOW = `<html><head><meta name="apple:title" content="The Daily"><meta property="og:title" content="The Daily">
<meta property="og:description" content="Daily News Podcast · Updated Daily · This is what the news should sound like.">
<script type="application/ld+json">{"@context":"http://schema.org","@type":"CreativeWorkSeries","name":"The Daily","description":"This is what the news should sound like.",
"genre":["Daily News","Podcasts","News"],"aggregateRating":{"@type":"AggregateRating","ratingValue":4.3,"reviewCount":106219}}</script></head>
<body><script type="application/json">{"provider":"The New York Times","providerId":null,"trackCount":549,"trailerCount":0}</script></body></html>`;
  const APPLE_EPISODE = `<html><head><meta name="apple:title" content="How Stable Is the A.I. Industry?">
<meta property="og:description" content="Podcast Episode · The Daily · November 18 · 26m">
<script type="application/ld+json">{"@context":"http://schema.org","@type":"PodcastEpisode","productionCompany":"The New York Times","datePublished":"2026-11-18",
"description":"Anthropic is a barometer of the economy.","duration":"PT26M9S","genre":["Daily News"],"name":"How Stable Is the A.I. Industry?",
"partOfSeries":{"@type":"CreativeWorkSeries","name":"The Daily"}}</script></head></html>`;
  const SPOTIFY_EPISODE = `<html><head><meta property="og:title" content="#2582 - Greg Anderson"><meta property="og:description" content="The Joe Rogan Experience · Episode">
<meta name="music:duration" content="9634"><meta property="og:type" content="music.song">
<script type="application/ld+json">{"@type":"PodcastEpisode","name":"#2582 - Greg Anderson","description":"Listen to this episode from The Joe Rogan Experience on Spotify. Greg Anderson is a black belt.","datePublished":"2026-11-18"}</script>
<script type="application/ld+json">{"@type":"VideoObject","name":"#2582 - Greg Anderson - The Joe Rogan Experience | Video Podcast","duration":"PT2H40M34S"}</script></head></html>`;

  it('reads Apple Podcasts shows: publisher, episodes, genre, rating', () => {
    const md = extractMetadata(APPLE_SHOW, 'https://podcasts.apple.com/us/podcast/the-daily/id1200361736');
    expect(md.description).toBe('This is what the news should sound like.');
    expect(pageFactsText(md.jsonLd)).toMatch(/^The New York Times · 549 episodes · Daily News · ★ 4\.3 \(106.219\)$/);
  });

  it('reads episodes: show, length and day', () => {
    const apple = extractMetadata(APPLE_EPISODE, 'https://podcasts.apple.com/us/podcast/x/id1200361736?i=1000802680076');
    expect(apple.description).toBe('Anthropic is a barometer of the economy.');
    expect(podcastFacts(apple.jsonLd)).toMatchObject({ type: 'episode', show: 'The Daily', length: '26 min' });
    expect(pageFactsText(apple.jsonLd)).toMatch(/^The Daily · 26 min · Nov\w*\.? 18,? 2026$|^The Daily · 26 min · 18/);

    const spotify = extractMetadata(SPOTIFY_EPISODE, 'https://open.spotify.com/episode/0xarCHZuFIANUeQup5YtHz');
    expect(spotify.description).toBe('Greg Anderson is a black belt.');
    // The episode, not its video version, is what the page is about.
    expect(formatPodcastFacts(podcastFacts(spotify.jsonLd)!)).toMatch(/^The Joe Rogan Experience · 2 h 41 min · /);
  });

  it('reads standard schema.org podcast data from other sites', () => {
    expect(pageFactsText([{ '@type': 'PodcastSeries', author: { '@type': 'Person', name: 'Joe Rogan' } }])).toBe('Joe Rogan');
    expect(podcastFacts([{ '@type': 'CreativeWorkSeries', name: 'A book series' }])).toBeUndefined();
  });
});

describe('articles', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const page = (body: string, ld: object) => `<html><head><meta property="og:type" content="article">
<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>${body}</body></html>`;
  const NEWS = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: 'Banking outages', datePublished: '2026-11-18T15:57:52-05:00', articleSection: 'Consumer',
    author: { '@type': 'Person', name: 'Ariel Rabinovitch' }, publisher: { '@type': 'Organization', name: 'Global News' } };

  it('counts the words of the article for a reading time', () => {
    // Related-story teasers (shorter <article>s) and text outside paragraphs do not count.
    const html = page(`<nav><p>${words(50)}</p></nav><article><h1>Title</h1><p>${words(600)}</p><p>${words(320)}</p></article><article><p>${words(30)}</p></article>`, NEWS);
    const md = extractMetadata(html, 'https://globalnews.ca/news/1/x/');
    expect(md.jsonLd[0]).toMatchObject({ wordCount: 920 });
    expect(pageFactsText(md.jsonLd)).toMatch(/^Ariel Rabinovitch · Nov\w*\.? 18,? 2026 · 4 min read · Consumer$|^Ariel Rabinovitch · 18/);
  });

  it('leaves teasers without a reading time, and replaces an embedded articleBody by its length', () => {
    const teaser = extractMetadata(page(`<article><p>${words(80)}</p><p>Subscribe to read more.</p></article>`, NEWS), 'https://example.com/a');
    expect(teaser.jsonLd[0]).not.toHaveProperty('wordCount');
    expect(articleFacts(teaser.jsonLd)).toMatchObject({ by: 'Ariel Rabinovitch', section: 'Consumer', reading: undefined });

    const embedded = extractMetadata(page('', { ...NEWS, articleBody: words(1150) }), 'https://example.com/b');
    expect(embedded.jsonLd[0]).toMatchObject({ wordCount: 1150 });
    expect(embedded.jsonLd[0]).not.toHaveProperty('articleBody');
    expect(articleFacts(embedded.jsonLd)?.reading).toBe('5 min read');
  });

  it('names several authors, and lets the page subject win over the article', () => {
    expect(articleFacts([{ '@type': 'BlogPosting', author: [{ name: 'A' }, { name: 'B' }] }])?.by).toBe('A and B');
    expect(articleFacts([{ '@type': 'ReportageNewsArticle', author: ['A', 'B', 'C'] }])?.by).toBe('A and 2 others');
    expect(articleFacts([{ '@type': 'WebSite' }, { '@type': 'WebPage' }, { '@type': 'NewsArticle', author: { name: 'Kyle Orland' } }])?.by).toBe('Kyle Orland');
    // A recipe page that is also marked as an article shows the recipe.
    expect(pageFactsText([{ '@type': ['Recipe', 'NewsArticle'], totalTime: 'PT10M', author: { name: 'Chef' } }])).toBe('10 min');
    expect(articleFacts([{ '@type': 'NewsArticle', headline: 'No author, no date' }])).toBeUndefined();
  });
});

describe('Wikipedia', () => {
  const LD = {
    '@context': 'https://schema.org', '@type': 'Article', name: 'Albert Einstein', url: 'https://en.wikipedia.org/wiki/Albert_Einstein',
    sameAs: 'http://www.wikidata.org/entity/Q937', mainEntity: 'http://www.wikidata.org/entity/Q937',
    author: { '@type': 'Organization', name: 'Contributors to Wikimedia projects' },
    datePublished: '2001-11-05T18:26:16Z', dateModified: '2026-11-17T17:32:00Z', headline: 'German-born theoretical physicist (1879–1955)',
  };
  const PAGE = `<html><head><title>Albert Einstein - Wikipedia</title><meta property="og:title" content="Albert Einstein - Wikipedia">
<script type="application/ld+json">${JSON.stringify(LD)}</script></head><body>
<div id="mw-content-text" class="mw-body-content"><p class="mw-empty-elt" id="mwBQ"></p>
<p id="mwMw"><b>Albert Einstein</b> (14&#160;March 1879 – 18&#160;April 1955) was a German-born <a href="./Theoretical_physicist">theoretical physicist</a>
best known for developing the <a href="./Relativity">theory of relativity</a>.<sup class="mw-ref reference" id="cite_ref-1"><a href="#cite_note-1"><span class="cite-bracket">[</span>1<span class="cite-bracket">]</span></a></sup>
His formula <i>E</i> = <i>mc</i><sup>2</sup> is famous.</p>
<p>${'Second paragraph words. '.repeat(100)}</p></div></body></html>`;

  it('names the article, describes it with its lead paragraph and shows its short description as facts', () => {
    const md = extractMetadata(PAGE, 'https://en.wikipedia.org/wiki/Albert_Einstein');
    expect(md.title).toBe('Albert Einstein');
    expect(md.siteName).toBe('Wikipedia');
    expect(md.description).toBe(
      'Albert Einstein (14 March 1879 – 18 April 1955) was a German-born theoretical physicist best known for developing the theory of relativity. His formula E = mc² is famous.',
    );
    expect(pageFactsText(md.jsonLd)).toMatch(/^German-born theoretical physicist \(1879–1955\) · 1 min read · edited (Nov\w*\.? 17,? 2026|17)/);
  });

  it('is recognised by its Wikidata item; other articles keep the article facts', () => {
    expect(encyclopediaFacts([{ ...LD, wordCount: 14136 }])).toMatchObject({ about: LD.headline, reading: '61 min read' });
    expect(encyclopediaFacts([{ ...LD, headline: 'city in Manitoba, Canada' }])?.about).toBe('City in Manitoba, Canada');
    const other = [{ ...LD, sameAs: undefined, mainEntity: undefined }];
    expect(encyclopediaFacts(other)).toBeUndefined();
    expect(pageFactsText(other)).toMatch(/^Contributors to Wikimedia projects · /);
  });
});

describe('GitHub repositories', () => {
  const ABOUT = {
    description: 'The library for web and native user interfaces.',
    formattedDescription: '<img class="emoji" title=":atom:" alt=":atom:" src="https://github.githubassets.com/images/icons/emoji/atom.png"> The library for web and {native} user interfaces.',
    website: 'https://react.dev',
    topics: [{ name: 'javascript' }, { name: 'ui' }],
    stargazerCount: 252735,
    forksCount: 52811,
    ownerLogin: 'react',
    repoName: 'react',
    repo: { isArchived: false, license: { spdxId: 'MIT', name: 'MIT License' } },
  };
  const page = (about: object) => `<html><head><title>GitHub - react/react: The library for web and native user interfaces.</title>
<meta property="og:description" content="The library for web and native user interfaces. Contribute to react/react development by creating an account on GitHub.">
</head><body><script type="application/json" data-target="react-app.embeddedData">{"payload":{"overview":{"sidebarAboutData":${JSON.stringify(about)},"other":{"a":"}"}}}}</script></body></html>`;

  it('reads the repository from the page data, and the language and last push from the API', () => {
    const md = extractMetadata(page(ABOUT), 'https://github.com/react/react');
    expect(md.title).toBe('react/react');
    expect(md.description).toBe('The library for web and {native} user interfaces.');
    expect(md.siteName).toBe('GitHub');
    expect(md.jsonLd).toEqual([expect.objectContaining({ '@type': 'SoftwareSourceCode', license: 'MIT', keywords: ['javascript', 'ui'], url: 'https://react.dev' })]);
    expect(githubApiUrl(md)).toBe('https://api.github.com/repos/react/react');
    expect(pageFactsText(md.jsonLd)).toBe('★ 252.7K · 52.8K forks · MIT');

    const full = withGitHubApi(md, { language: 'JavaScript', pushed_at: '2026-11-18T19:11:19Z' });
    expect(pageFactsText(full.jsonLd)).toMatch(/^JavaScript · ★ 252.7K · 52.8K forks · MIT · updated (Nov\w*\.? 18,? 2026|18)/);
  });

  it('marks archived repositories and leaves out what is not there', () => {
    const md = extractMetadata(
      page({ ...ABOUT, description: '', formattedDescription: '', stargazerCount: 0, forksCount: 1, repo: { isArchived: true, license: { spdxId: 'NOASSERTION' } } }),
      'https://github.com/react/react',
    );
    expect(md.description).toBeUndefined();
    expect(softwareFacts(md.jsonLd)).toEqual({ archived: true, forks: '1 fork' });
    expect(pageFactsText(withGitHubApi(md, { language: 'C' }).jsonLd)).toBe('Archived · C · 1 fork');
  });

  it('leaves other GitHub pages (profiles, issues) to the generic metadata', () => {
    const md = extractMetadata('<html><head><title>torvalds - Overview</title></head></html>', 'https://github.com/torvalds');
    expect(md).toMatchObject({ title: 'torvalds - Overview', siteName: 'GitHub', jsonLd: [] });
    expect(githubApiUrl(md)).toBeUndefined();
  });
});

describe('Stack Overflow and Stack Exchange questions', () => {
  const API = {
    items: [
      {
        tags: ['git', 'version-control'],
        owner: { display_name: 'Hamza Yerlikaya' },
        is_answered: true,
        view_count: 16826850,
        accepted_answer_id: 927386,
        answer_count: 105,
        score: 27250,
        creation_date: 1243620554,
        question_id: 927358,
        title: 'How do I undo the most recent local commits in &quot;Git&quot;?',
        body: '<p>I <em>accidentally</em> committed the wrong files to <code>git</code>.</p>\n<pre><code>git log\n</code></pre>\n<p>How do I undo those commits?</p>',
      },
    ],
  };

  it('recognises question links on all Stack Exchange sites', () => {
    expect(stackExchangeQuestion('https://stackoverflow.com/questions/927358/how-do-i-undo?utm_source=x#answer-1')).toEqual({
      site: 'stackoverflow.com',
      id: '927358',
      url: 'https://stackoverflow.com/questions/927358',
    });
    expect(stackExchangeQuestion('https://stackoverflow.com/q/11227809/123')?.id).toBe('11227809');
    expect(stackExchangeQuestion('https://unix.stackexchange.com/questions/4126/x')?.site).toBe('unix.stackexchange.com');
    expect(stackExchangeQuestion('https://www.superuser.com/questions/1/')?.site).toBe('superuser.com');
    expect(stackExchangeQuestion('https://stackoverflow.com/users/89904')).toBeUndefined();
    expect(stackExchangeQuestion('https://example.com/questions/1')).toBeUndefined();
  });

  it('builds the question page from the API answer, with votes, answers, views and date as facts', () => {
    const q = stackExchangeQuestion('https://stackoverflow.com/questions/927358')!;
    const html = stackExchangePage(API, q)!;
    const md = extractMetadata(html, q.url);
    expect(md.title).toBe('How do I undo the most recent local commits in "Git"?');
    expect(md.siteName).toBe('Stack Overflow');
    expect(md.description).toBe('I accidentally committed the wrong files to git. … How do I undo those commits?');
    expect(md.icons[0]).toBe('https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico');
    expect(pageFactsText(md.jsonLd)).toMatch(/^27.3K votes · ✓ 105 answers · 16.8M views · asked (May\w*\.? 29,? 2009|29)/);
  });

  it('shows closed and unanswered questions, and gives up on unknown ones', () => {
    const q = stackExchangeQuestion('https://math.stackexchange.com/questions/5')!;
    const item = { ...API.items[0], accepted_answer_id: undefined, answer_count: 0, score: 1, closed_reason: 'Duplicate' };
    const md = extractMetadata(stackExchangePage({ items: [item] }, q)!, q.url);
    expect(md.siteName).toBe('Math Stack Exchange');
    expect(questionFacts(md.jsonLd)).toMatchObject({ status: 'Closed: Duplicate', votes: '1 vote', answers: 'No answers', accepted: undefined });
    expect(stackExchangePage({ items: [] }, q)).toBeUndefined();
  });
});

describe('Walmart', () => {
  it('recognises the "press and hold" check as blocked (so FlareSolverr is asked)', () => {
    const check = `<html><head><title>Verify Your Identity</title></head><body><h1>We like real shoppers, not robots!</h1>
<p>Please press and hold the button</p><div id=px-captcha> </div><script>window._pxAppId = 'PXnp9B16Cq';</script></body></html>`;
    expect(looksBlocked(200, check)).toBe(true);
    expect(looksBlocked(200, check.replace('<title>Verify Your Identity</title>', '<title>Walmart</title>'))).toBe(true);
    // Real pages load PerimeterX too, but have no captcha element.
    expect(looksBlocked(200, '<title>WD Red - Walmart.ca</title><script src="/px/client.js"></script><script>var c="px-captcha-modal"</script>')).toBe(false);
  });

  it('names the product and replaces the sales line by the product description', () => {
    const ld = {
      '@context': 'https://schema.org', '@type': 'Product', name: 'WD Red Plus WD80EFPX - Hard drive - 8 TB',
      description: 'WD Red Plus WD80EFPX - hard drive - 8 TB - SATA 6Gb/s',
      offers: [{ '@type': 'Offer', priceCurrency: 'CAD', price: 534.99 }],
      aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.6, reviewCount: 38 },
    };
    const page = (product: object) => `<html><head><title>WD Red Plus WD80EFPX - Hard drive - 8 TB - Walmart.ca</title>
<meta property="og:description" content="Buy WD Red Plus WD80EFPX - Hard drive - 8 TB from Walmart Canada. Shop for more Internal Hard Drives available online at Walmart.ca">
<script type="application/ld+json">${JSON.stringify(product)}</script></head></html>`;
    const md = extractMetadata(page(ld), 'https://www.walmart.ca/en/ip/WD-Red/30LWQC75P0D4');
    expect(md).toMatchObject({ title: 'WD Red Plus WD80EFPX - Hard drive - 8 TB', siteName: 'Walmart', description: 'WD Red Plus WD80EFPX - hard drive - 8 TB - SATA 6Gb/s' });
    expect(pageFactsText(md.jsonLd)).toMatch(/534\.99 · ★ 4\.6 \(38\)$/);
    // A description that only repeats the name is left out.
    expect(extractMetadata(page({ ...ld, description: ld.name }), 'https://www.walmart.com/ip/x/1').description).toBeUndefined();
  });
});
