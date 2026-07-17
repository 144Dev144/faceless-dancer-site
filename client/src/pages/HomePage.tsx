import { useEffect, useState } from "preact/hooks";
import { HomeTopNav } from "../components/home/HomeTopNav";
import { HomeFooter } from "../components/home/HomeFooter";
import { HomeDashboard } from "../components/home/HomeDashboard";
import { api, type SiteSettings } from "../lib/api";
import type { SessionState } from "../hooks/useSession";

const defaultSiteSettings: SiteSettings = {
  twitterUrl: "",
  showTwitter: true,
  youtubeUrl: "",
  showYoutube: true,
  showYoutubeEmbed: true,
  youtubeLiveChannelId: "",
  telegramUrl: "",
  showTelegram: true,
  dexscreenerUrl: "",
  showDexscreener: true,
  pumpFunUrl: "",
  autotransitionGithubUrl: "",
  tokenAddress: "",
};

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
  refreshSession: () => Promise<void>;
}

export function HomePage({ session, setSession, refreshSession }: Props): JSX.Element {
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(defaultSiteSettings);

  useEffect(() => {
    document.body.classList.add("home-page-body");
    return () => {
      document.body.classList.remove("home-page-body");
    };
  }, []);

  useEffect(() => {
    api.siteSettings()
      .then((settings) => setSiteSettings({ ...defaultSiteSettings, ...settings }))
      .catch(() => null);
  }, []);

  return (
    <main className="homepage">
      <div className="home-v2-shell">
        <HomeTopNav session={session} setSession={setSession} />
        <HomeDashboard settings={siteSettings} session={session} />
        <HomeFooter settings={siteSettings} />
      </div>
    </main>
  );
}
