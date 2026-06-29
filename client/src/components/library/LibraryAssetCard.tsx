import type { LibraryItem } from "../../lib/api";

interface Props {
  item: LibraryItem;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionTitle?: string;
  onAction?: (() => void) | null;
  className?: string;
}

export function LibraryAssetCard({
  item,
  actionLabel,
  actionDisabled = false,
  actionTitle,
  onAction,
  className = "",
}: Props): JSX.Element {
  const audioFile = item.files.find((file) => file.role === "audio" || file.role === "preview");
  const coverFile = item.files.find((file) => file.role === "cover");
  const datasetSamples = item.files.filter((file) => file.role === "dataset_sample").length;
  const fileCount = item.files.length;
  const updated = new Date(item.updatedAt);
  const creatorName = item.creator?.displayName || item.creator?.creatorSlug || "Faceless creator";
  const cardImage = coverFile?.publicUrl || item.creator?.bannerUrl || item.creator?.avatarUrl || "";

  return (
    <article
      className={`library-card${className ? ` ${className}` : ""}${cardImage ? " library-card--image" : ""}`}
      style={cardImage ? { backgroundImage: `linear-gradient(180deg, rgba(4, 10, 19, 0.2), rgba(4, 10, 19, 0.9)), url(${cardImage})` } : undefined}
    >
      <div className="library-card__content">
        <div className="library-card__meta">
          <span className="home-v2-tag">{formatKind(item.kind)}</span>
          <span className="home-v2-tag">By {creatorName}</span>
        </div>
        <div className="library-card__topline">
          <span>{Number.isNaN(updated.getTime()) ? "Recent" : updated.toLocaleDateString()}</span>
          <span>{fileCount} files</span>
          {item.kind === "dataset" ? <span>{datasetSamples} samples</span> : null}
        </div>
        <h2>{item.title}</h2>
        <p>{item.description || fallbackDescription(item.kind)}</p>
        <div className="library-card__facts">
          {item.license ? <span>{item.license}</span> : null}
        </div>
        {item.tags.length ? (
          <div className="library-card__tags">
            {item.tags.slice(0, 6).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
        {audioFile?.publicUrl ? (
          <audio className="library-card__audio" controls preload="metadata" src={audioFile.publicUrl}></audio>
        ) : null}
        {actionLabel ? (
          <button
            type="button"
            className="home-v2-btn home-v2-btn--primary"
            disabled={actionDisabled}
            title={actionTitle}
            onClick={() => onAction?.()}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function fallbackDescription(kind: string): string {
  if (kind === "dataset") return "Captioned training dataset prepared for creator workflows.";
  if (kind === "lokr") return "Trained LoKr adapter for compatible Dance Station generation workflows.";
  if (kind === "rhythm_game") return "Rhythm-game-ready music and metadata package.";
  return "Published Dance Station library item.";
}
