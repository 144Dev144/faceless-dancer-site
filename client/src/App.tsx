import { useEffect, useState } from "preact/hooks";
import { useSession } from "./hooks/useSession";
import { HomePage } from "./pages/HomePage";
import { GamePage } from "./pages/GamePage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { LibraryPage } from "./pages/LibraryPage";
import { DanceStationPage } from "./pages/DanceStationPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SiteAudioPlayerProvider } from "./components/audio/SiteAudioPlayer";

function currentPath(): string {
  return window.location.pathname || "/";
}

export function App() {
  const { state, setState, refreshSession } = useSession();
  const [path, setPath] = useState<string>(currentPath());
  const [danceEnginePage, setDanceEnginePage] = useState<JSX.Element | null>(null);

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (path !== "/dance-engine") {
      setDanceEnginePage(null);
      return;
    }
    let cancelled = false;
    void import("./pages/DanceEnginePage").then(({ DanceEnginePage }) => {
      if (!cancelled) setDanceEnginePage(<DanceEnginePage />);
    });
    return () => { cancelled = true; };
  }, [path]);

  let page: JSX.Element;
  if (path === "/game") {
    page = (
      <GamePage
        session={state}
        setSession={setState}
        refreshSession={refreshSession}
      />
    );
  } else if (path === "/playground") {
    page = <PlaygroundPage />;
  } else if (path === "/library") {
    page = <LibraryPage session={state} setSession={setState} />;
  } else if (path === "/dance-station") {
    page = <DanceStationPage session={state} setSession={setState} />;
  } else if (path === "/profile") {
    page = <ProfilePage session={state} setSession={setState} />;
  } else if (path === "/dance-engine") {
    page = danceEnginePage ?? <main className="dance-engine-route-loading">Loading Dance Engine Lab...</main>;
  } else {
    page = (
      <HomePage
        session={state}
        setSession={setState}
        refreshSession={refreshSession}
      />
    );
  }

  return <SiteAudioPlayerProvider>{page}</SiteAudioPlayerProvider>;
}
