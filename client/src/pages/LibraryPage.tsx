import { useEffect, useMemo, useState } from "preact/hooks";
import { HomeTopNav } from "../components/home/HomeTopNav";
import { LibraryAssetCard } from "../components/library/LibraryAssetCard";
import { api } from "../lib/api";
import type { SessionState } from "../hooks/useSession";

const kindOptions = [
  { value: "", label: "All" },
  { value: "generation", label: "Generations" },
  { value: "transition", label: "Transitions" },
  { value: "extraction", label: "Extractions" },
  { value: "stem", label: "Stems" },
  { value: "dataset", label: "Datasets" },
  { value: "lokr", label: "LoKr Adapters" },
  { value: "rhythm_game", label: "Rhythm Games" },
  { value: "tool", label: "Tools" },
];

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
}

export function LibraryPage({ session, setSession }: Props): JSX.Element {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("home-page-body");
    return () => document.body.classList.remove("home-page-body");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.publicLibrary({ kind: kind || undefined, limit: 80 })
      .then((payload) => {
        if (!cancelled) setItems(payload.items);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.title, item.description ?? "", item.kind, item.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [items, query]);

  return (
    <main className="home-v2 library-page-shell">
      <div className="home-v2-shell">
        <HomeTopNav session={session} setSession={setSession} />

        <section className="library-hero">
          <p className="home-v2-kicker">Public Library</p>
          <h1>Shared music, datasets, adapters, and creative assets</h1>
          <p>
            The library is the bridge between Dance Station and the public Faceless Dancer platform. Published assets
            will be browsable here.
          </p>
        </section>

        <section className="library-toolbar" aria-label="Library filters">
          <label>
            <span>Kind</span>
            <select value={kind} onChange={(event) => setKind((event.currentTarget as HTMLSelectElement).value)}>
              {kindOptions.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Search</span>
            <input
              value={query}
              onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
              placeholder="title, kind, tag"
            />
          </label>
        </section>

        {loading ? <div className="library-empty">Loading public library...</div> : null}
        {error ? <div className="library-empty library-empty--error">{error}</div> : null}
        {!loading && !error && filteredItems.length === 0 ? (
          <div className="library-empty">
            <strong>No published items yet.</strong>
            <span>Publishing from Dance Station and moderation tools are coming next.</span>
          </div>
        ) : null}

        <section className="library-grid">
          {filteredItems.map((item) => (
            <LibraryAssetCard key={item.id} item={item} />
          ))}
        </section>
      </div>
    </main>
  );
}
