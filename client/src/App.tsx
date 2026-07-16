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

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
