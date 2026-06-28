import { useEffect, useState } from "preact/hooks";
import { useSession } from "./hooks/useSession";
import { HomePage } from "./pages/HomePage";
import { AdminGamePage } from "./pages/AdminGamePage";
import { GamePage } from "./pages/GamePage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { LibraryPage } from "./pages/LibraryPage";
import { DanceStationPage } from "./pages/DanceStationPage";

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

  if (path === "/admin/game") {
    return (
      <AdminGamePage
        session={state}
        setSession={setState}
        refreshSession={refreshSession}
      />
    );
  }

  if (path === "/game") {
    return (
      <GamePage
        session={state}
        setSession={setState}
        refreshSession={refreshSession}
      />
    );
  }

  if (path === "/playground") {
    return <PlaygroundPage />;
  }

  if (path === "/library") {
    return <LibraryPage />;
  }

  if (path === "/dance-station") {
    return <DanceStationPage session={state} setSession={setState} />;
  }

  return (
    <HomePage
      session={state}
      setSession={setState}
      refreshSession={refreshSession}
    />
  );
}
