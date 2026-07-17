import { useEffect, useRef, useState } from "preact/hooks";
import {
  AudioWaveform,
  CirclePlay,
  Check,
  Grid2X2,
  Image,
  List,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-preact";
import { HomeTopNav } from "../components/home/HomeTopNav";
import { LibraryAssetCard } from "../components/library/LibraryAssetCard";
import { api, type LibraryItem, type PublicLibraryPage } from "../lib/api";
import type { SessionState } from "../hooks/useSession";

const kindOptions = [
  { value: "", label: "All Items" },
  { value: "audio", label: "Audio" },
  { value: "rhythm_game", label: "Rhythm Games" },
  { value: "stem", label: "Stems" },
  { value: "dataset", label: "Datasets" },
  { value: "lokr", label: "Adapters" },
  { value: "generation", label: "Generations" },
  { value: "extraction", label: "Extractions" },
];

const sortOptions = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
] as const;

const LIBRARY_PAGE_SIZE = 10;

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
}

type LibrarySummary = PublicLibraryPage["summary"];

export function LibraryPage({ session, setSession }: Props): JSX.Element {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [playableOnly, setPlayableOnly] = useState(false);
  const [artworkOnly, setArtworkOnly] = useState(false);
  const [licenseDraft, setLicenseDraft] = useState("");
  const [license, setLicense] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const queryKeyRef = useRef("");

  useEffect(() => {
    document.body.classList.add("home-page-body");
    return () => document.body.classList.remove("home-page-body");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const queryKey = JSON.stringify({ artworkOnly, kind, license, playableOnly, search, sort });
    queryKeyRef.current = queryKey;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setLoadMoreError(null);
    setItems([]);
    setOffset(0);
    setTotal(0);
    setHasMore(false);
    setSummary(null);

    api.publicLibrary({
      kind: kind || undefined,
      search: search || undefined,
      sort,
      playable: playableOnly,
      artwork: artworkOnly,
      license: license || undefined,
      limit: LIBRARY_PAGE_SIZE,
      offset: 0,
    })
      .then((payload) => {
        if (cancelled) return;
        setItems(payload.items);
        setOffset(payload.offset + payload.items.length);
        setTotal(payload.total);
        setHasMore(payload.hasMore);
        setSummary(payload.summary);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setHasMore(false);
        setSummary(null);
        setError("The public library is temporarily unavailable. Please try again shortly.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [artworkOnly, kind, license, playableOnly, search, sort]);

  const hasActiveFilters = Boolean(kind || search || playableOnly || artworkOnly || license);

  const selectKind = (nextKind: string) => {
    setKind(nextKind);
  };

  const clearFilters = () => {
    setKind("");
    setQuery("");
    setSearch("");
    setSort("newest");
    setPlayableOnly(false);
    setArtworkOnly(false);
    setLicenseDraft("");
    setLicense("");
  };

  const loadMore = () => {
    if (loading || loadingMore || !hasMore) return;

    const requestKey = queryKeyRef.current;
    const requestOffset = offset;
    setLoadingMore(true);
    setLoadMoreError(null);

    api.publicLibrary({
      kind: kind || undefined,
      search: search || undefined,
      sort,
      playable: playableOnly,
      artwork: artworkOnly,
      license: license || undefined,
      limit: LIBRARY_PAGE_SIZE,
      offset: requestOffset,
    })
      .then((payload) => {
        if (queryKeyRef.current !== requestKey) return;
        setItems((current) => [...current, ...payload.items]);
        setOffset(payload.offset + payload.items.length);
        setTotal(payload.total);
        setHasMore(payload.hasMore);
        setSummary(payload.summary);
      })
      .catch(() => {
        if (queryKeyRef.current === requestKey) {
          setLoadMoreError("Could not load more library items.");
        }
      })
      .finally(() => {
        if (queryKeyRef.current === requestKey) setLoadingMore(false);
      });
  };

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || loading || loadingMore || loadMoreError || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "700px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [artworkOnly, hasMore, kind, license, loadMoreError, loading, loadingMore, offset, playableOnly, search, sort]);

  return (
    <main className="home-v2 library-page-shell">
      <div className="home-v2-shell">
        <HomeTopNav session={session} setSession={setSession} />

        <section className="library-discovery-head">
          <div className="library-discovery-copy">
            <p className="home-v2-kicker">Public Library</p>
            <h1>Public Library</h1>
            <p>Discover music, datasets, adapters, rhythm-game assets, and creative packs published by The Faceless Dancer and the community.</p>
          </div>
          <div className="library-stat-grid" aria-label="Library summary">
            <LibraryStat label="Items" value={summary?.items} tone="cyan" icon={<AudioWaveform aria-hidden="true" size={19} />} />
            <LibraryStat label="Creators" value={summary?.creators} tone="violet" icon={<Users aria-hidden="true" size={19} />} />
            <LibraryStat label="Playable" value={summary?.playable} tone="teal" icon={<CirclePlay aria-hidden="true" size={19} />} />
            <LibraryStat label="With Artwork" value={summary?.artwork} tone="pink" icon={<Image aria-hidden="true" size={19} />} />
          </div>
        </section>

        <section className="library-control-panel" aria-label="Library search and filters">
          <div className="library-control-row">
            <label className="library-search-field">
              <span className="sr-only">Search the library</span>
              <Search aria-hidden="true" size={17} />
              <input
                value={query}
                onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
                placeholder="Search the library..."
              />
              {query ? (
                <button type="button" className="library-inline-clear" onClick={() => setQuery("")} aria-label="Clear search" title="Clear search">
                  <X aria-hidden="true" size={15} />
                </button>
              ) : null}
            </label>
            <label className="library-sort-field">
              <span>Sort by</span>
              <select value={sort} onChange={(event) => setSort((event.currentTarget as HTMLSelectElement).value as "newest" | "oldest")}>
                {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <FilterToggle active={playableOnly} onClick={() => setPlayableOnly((value) => !value)} icon="playable" label="Playable Only" />
            <FilterToggle active={artworkOnly} onClick={() => setArtworkOnly((value) => !value)} icon="artwork" label="With Artwork" />
            <button type="button" className={`library-filter-button${filtersOpen ? " is-active" : ""}`} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}>
              <SlidersHorizontal aria-hidden="true" size={16} />
              <span>More Filters</span>
            </button>
          </div>

          <div className="library-category-row" aria-label="Library categories">
            {kindOptions.map((option) => (
              <button
                key={option.value || "all"}
                type="button"
                className={`library-category-button${kind === option.value ? " is-active" : ""}`}
                onClick={() => selectKind(option.value)}
                aria-pressed={kind === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>

          {filtersOpen ? (
            <div className="library-more-filters">
              <label>
                <span>Exact license</span>
                <input
                  value={licenseDraft}
                  onInput={(event) => setLicenseDraft((event.currentTarget as HTMLInputElement).value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      setLicense(licenseDraft.trim());
                    }
                  }}
                  placeholder="e.g. CC BY 4.0"
                />
              </label>
              <button type="button" className="library-apply-filter" onClick={() => setLicense(licenseDraft.trim())}>
                Apply license filter
              </button>
              {license ? <span className="library-filter-note">Filtering by {license}</span> : null}
              {hasActiveFilters ? <button type="button" className="library-clear-filters" onClick={clearFilters}>Clear all filters</button> : null}
            </div>
          ) : null}
        </section>

        <div className="library-workspace">
          <aside className="library-sidebar" aria-label="Browse library">
            <div className="library-sidebar__heading">
              <span>Browse</span>
              <AudioWaveform aria-hidden="true" size={16} />
            </div>
            <div className="library-browse-list">
              {kindOptions.map((option) => (
                <button key={option.value || "all"} type="button" className={kind === option.value ? "is-active" : ""} onClick={() => selectKind(option.value)}>
                  <span>{option.label}</span>
                  {kind === option.value && <Check aria-hidden="true" size={15} />}
                </button>
              ))}
            </div>
            <div className="library-sidebar__divider" />
            <div className="library-sidebar__heading library-sidebar__heading--small"><span>Filters</span><SlidersHorizontal aria-hidden="true" size={14} /></div>
            <button type="button" className={`library-sidebar-filter${playableOnly ? " is-active" : ""}`} onClick={() => setPlayableOnly((value) => !value)}>
              <span className={`library-checkbox${playableOnly ? " is-checked" : ""}`}>{playableOnly ? <Check aria-hidden="true" size={12} /> : null}</span>
              <span>Playable previews</span>
            </button>
            <button type="button" className={`library-sidebar-filter${artworkOnly ? " is-active" : ""}`} onClick={() => setArtworkOnly((value) => !value)}>
              <span className={`library-checkbox${artworkOnly ? " is-checked" : ""}`}>{artworkOnly ? <Check aria-hidden="true" size={12} /> : null}</span>
              <span>Cover artwork</span>
            </button>
            {hasActiveFilters ? <button type="button" className="library-sidebar-clear" onClick={clearFilters}>Clear all filters</button> : null}
          </aside>

          <section className="library-results" aria-label="Library results">
            <div className="library-results-header">
              <div>
                <p className="library-results-kicker">Published assets</p>
                <h2>{kindOptions.find((option) => option.value === kind)?.label || "All Items"}</h2>
              </div>
              <div className="library-results-actions">
                <span className="library-results-count">{loading ? "Loading..." : `${total.toLocaleString()} items`}</span>
                <div className="library-view-toggle" aria-label="View mode">
                  <button type="button" className={viewMode === "grid" ? "is-active" : ""} onClick={() => setViewMode("grid")} aria-label="Grid view" title="Grid view"><Grid2X2 aria-hidden="true" size={15} /></button>
                  <button type="button" className={viewMode === "list" ? "is-active" : ""} onClick={() => setViewMode("list")} aria-label="List view" title="List view"><List aria-hidden="true" size={16} /></button>
                </div>
              </div>
            </div>

            <div className="library-results-status" aria-live="polite">
              {loading ? "Loading library..." : !error && total ? `Showing ${items.length} of ${total}` : null}
            </div>

            {error ? <div className="library-empty library-empty--error">{error}</div> : null}
            {!loading && !error && items.length === 0 ? (
              <div className="library-empty">
                <strong>{search ? "No public items match your search." : "No published items yet."}</strong>
                <span>{search ? "Try a different title, kind, or filter." : "Published assets will appear here."}</span>
              </div>
            ) : null}

            <div className={`library-grid library-grid--${viewMode}${loading ? " library-grid--loading" : ""}`} aria-busy={loading}>
              {loading
                ? Array.from({ length: LIBRARY_PAGE_SIZE }, (_, index) => <LibraryCardSkeleton key={`library-skeleton-${index}`} />)
                : items.map((item) => <LibraryAssetCard key={item.id} item={item} />)}
            </div>

            {!loading && !error && items.length > 0 && (hasMore || loadingMore || loadMoreError) ? (
              <div ref={loadMoreRef} className="library-load-more" aria-live="polite">
                {loadingMore ? <><LoaderCircle className="library-loading-spinner" aria-hidden="true" size={16} /> Loading more...</> : null}
              </div>
            ) : null}
            {!loading && !error && loadMoreError ? (
              <div className="library-load-more-error" role="status">
                <span>{loadMoreError}</span>
                <button type="button" onClick={loadMore}>Try again</button>
              </div>
            ) : null}
            {!loading && !error && !hasMore && !loadMoreError && items.length > LIBRARY_PAGE_SIZE ? (
              <div className="library-load-more library-load-more--end" aria-live="polite">End of library</div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

function LibraryStat({ label, value, tone, icon }: { label: string; value?: number; tone: string; icon: JSX.Element }): JSX.Element {
  return (
    <div className={`library-stat library-stat--${tone}`}>
      <span className="library-stat__icon">{icon}</span>
      <strong>{value === undefined ? "--" : value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

function FilterToggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: "playable" | "artwork"; label: string }): JSX.Element {
  return (
    <button type="button" className={`library-filter-button${active ? " is-active" : ""}`} onClick={onClick} aria-pressed={active}>
      {icon === "playable" ? <AudioWaveform aria-hidden="true" size={16} /> : <Image aria-hidden="true" size={16} />}
      <span>{label}</span>
    </button>
  );
}

function LibraryCardSkeleton(): JSX.Element {
  return (
    <div className="library-card library-card--skeleton" aria-hidden="true">
      <div className="library-card__art" />
      <div className="library-card__skeleton-line library-card__skeleton-line--wide" />
      <div className="library-card__skeleton-line" />
      <div className="library-card__skeleton-line library-card__skeleton-line--short" />
    </div>
  );
}
