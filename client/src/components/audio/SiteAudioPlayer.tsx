import { createContext, type ComponentChildren } from "preact";
import { useContext, useRef, useState } from "preact/hooks";
import { ChevronDown, ChevronUp, Pause, Play, X } from "lucide-preact";

export interface SiteAudioTrack {
  id: string;
  title: string;
  url: string;
  mimeType?: string;
}

interface SiteAudioPlayerContextValue {
  currentTrack: SiteAudioTrack | null;
  isPlaying: boolean;
  playTrack: (track: SiteAudioTrack) => void;
  togglePlayback: () => void;
}

const SiteAudioPlayerContext = createContext<SiteAudioPlayerContextValue | null>(null);

export function SiteAudioPlayerProvider({ children }: { children: ComponentChildren }): JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTrack, setCurrentTrack] = useState<SiteAudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const playTrack = (track: SiteAudioTrack) => {
    const audio = audioRef.current;
    if (currentTrack?.id === track.id && audio) {
      if (audio.paused) {
        void audio.play().catch(() => setIsPlaying(false));
      } else {
        audio.pause();
      }
      return;
    }
    setCurrentTrack(track);
    setCurrentTime(0);
    setDuration(0);
    setCollapsed(false);
    if (audio) {
      audio.src = track.url;
      audio.load();
      void audio.play().catch(() => setIsPlaying(false));
    }
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (audio.paused) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  };

  const closePlayer = () => {
    audioRef.current?.pause();
    setIsPlaying(false);
    setCurrentTrack(null);
  };

  return (
    <SiteAudioPlayerContext.Provider value={{ currentTrack, isPlaying, playTrack, togglePlayback }}>
      {children}
      <audio
        className="site-audio-player__audio"
        ref={(element) => { audioRef.current = element; }}
        preload="metadata"
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(duration);
        }}
      />
      {currentTrack ? (
        <footer className={`site-audio-player${collapsed ? " site-audio-player--collapsed" : ""}`} aria-label="Audio player">
          <button type="button" className="site-audio-player__tab" onClick={() => setCollapsed((value) => !value)} title={collapsed ? "Show audio player" : "Hide audio player"} aria-label={collapsed ? "Show audio player" : "Hide audio player"}>
            {collapsed ? <ChevronUp aria-hidden="true" size={15} strokeWidth={2.2} /> : <ChevronDown aria-hidden="true" size={15} strokeWidth={2.2} />}
          </button>
          <div className="site-audio-player__bar" aria-hidden={collapsed}>
              <button type="button" className="site-audio-player__control site-audio-player__transport" onClick={togglePlayback} title={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? <Pause aria-hidden="true" size={17} strokeWidth={2.2} /> : <Play aria-hidden="true" size={17} strokeWidth={2.2} />}
              </button>
              <div className="site-audio-player__track-info">
                <strong title={currentTrack.title}>{currentTrack.title}</strong>
                <span>Now playing</span>
              </div>
              <div className="site-audio-player__timeline">
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  step="0.01"
                  value={Math.min(currentTime, duration || currentTime)}
                  onInput={(event) => {
                    const nextTime = Number((event.currentTarget as HTMLInputElement).value);
                    if (audioRef.current && Number.isFinite(nextTime)) {
                      audioRef.current.currentTime = nextTime;
                      setCurrentTime(nextTime);
                    }
                  }}
                  disabled={!duration}
                  aria-label="Seek audio"
                />
                <div className="site-audio-player__time">
                  <span>{formatAudioTime(currentTime)}</span>
                  <span>{formatAudioTime(duration)}</span>
                </div>
              </div>
              <button type="button" className="site-audio-player__control site-audio-player__control--quiet" onClick={closePlayer} title="Close audio player">
                <X aria-hidden="true" size={17} strokeWidth={2.2} />
              </button>
          </div>
        </footer>
      ) : null}
    </SiteAudioPlayerContext.Provider>
  );
}

export function useSiteAudioPlayer(): SiteAudioPlayerContextValue {
  const context = useContext(SiteAudioPlayerContext);
  if (!context) throw new Error("useSiteAudioPlayer must be used inside SiteAudioPlayerProvider");
  return context;
}

export function AudioPlayButton({ track }: { track: SiteAudioTrack }): JSX.Element {
  const { currentTrack, isPlaying, playTrack } = useSiteAudioPlayer();
  const active = currentTrack?.id === track.id;
  return (
    <button
      type="button"
      className={`site-audio-play-button${active ? " site-audio-play-button--active" : ""}`}
      onClick={() => playTrack(track)}
      title={active && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
      aria-label={active && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
    >
      {active && isPlaying ? <Pause aria-hidden="true" size={15} strokeWidth={2.2} /> : <Play aria-hidden="true" size={15} strokeWidth={2.2} />}
    </button>
  );
}

function formatAudioTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
