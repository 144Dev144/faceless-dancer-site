import { createContext, type ComponentChildren } from "preact";
import { useContext, useRef, useState } from "preact/hooks";
import { ChevronDown, ChevronUp, Pause, Play, Volume2, VolumeX, X } from "lucide-preact";
import { WaveformVisual } from "./WaveformVisual";

export interface SiteAudioTrack {
  id: string;
  title: string;
  url: string;
  mimeType?: string;
  artworkUrl?: string;
  creatorName?: string;
  waveformUrl?: string;
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
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);

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
      audio.volume = volume;
      audio.muted = muted;
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

  const setPlayerVolume = (nextVolume: number) => {
    const next = Math.min(1, Math.max(0, nextVolume));
    setVolume(next);
    setMuted(next === 0);
    if (audioRef.current) {
      audioRef.current.volume = next;
      audioRef.current.muted = next === 0;
    }
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (audioRef.current) audioRef.current.muted = nextMuted;
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
            <div className="site-audio-player__track">
              {currentTrack.artworkUrl ? <img className="site-audio-player__artwork" src={currentTrack.artworkUrl} alt="" /> : <div className="site-audio-player__artwork site-audio-player__artwork--fallback"><Play aria-hidden="true" size={17} /></div>}
              <div className="site-audio-player__track-info">
                <strong title={currentTrack.title}>{currentTrack.title}</strong>
                <span>{currentTrack.creatorName || "The Faceless Dancer"}</span>
              </div>
            </div>
            <button type="button" className="site-audio-player__control site-audio-player__transport" onClick={togglePlayback} title={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? <Pause aria-hidden="true" size={18} strokeWidth={2.2} /> : <Play aria-hidden="true" size={18} strokeWidth={2.2} />}
            </button>
            <div className="site-audio-player__timeline">
              <WaveformVisual
                className="site-audio-player__waveform"
                seed={currentTrack.id}
                waveformUrl={currentTrack.waveformUrl}
                progress={duration ? Math.min(1, currentTime / duration) : 0}
                interactive={Boolean(duration)}
                onSeek={(ratio) => {
                  const nextTime = ratio * duration;
                  if (audioRef.current && Number.isFinite(nextTime)) {
                    audioRef.current.currentTime = nextTime;
                    setCurrentTime(nextTime);
                  }
                }}
                ariaLabel="Seek audio"
              />
              <div className="site-audio-player__time">
                <span>{formatAudioTime(currentTime)}</span>
                <span>{formatAudioTime(duration)}</span>
              </div>
            </div>
            <div className="site-audio-player__volume">
              <button type="button" className="site-audio-player__control site-audio-player__control--quiet" onClick={toggleMute} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"}>
                {muted ? <VolumeX aria-hidden="true" size={17} /> : <Volume2 aria-hidden="true" size={17} />}
              </button>
              <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onInput={(event) => setPlayerVolume(Number((event.currentTarget as HTMLInputElement).value))} aria-label="Volume" />
            </div>
            <button type="button" className="site-audio-player__control site-audio-player__control--quiet" onClick={closePlayer} title="Close audio player" aria-label="Close audio player">
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
