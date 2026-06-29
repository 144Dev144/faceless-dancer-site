import { useEffect, useState } from "preact/hooks";
import { HeroSection } from "../components/HeroSection";
import { HomeTopNav } from "../components/home/HomeTopNav";
import { PlatformVisionSection } from "../components/home/PlatformVisionSection";
import { ApplicationsSection } from "../components/home/ApplicationsSection";
import { RoadmapSection } from "../components/home/RoadmapSection";
import { WhyMattersSection } from "../components/home/WhyMattersSection";
import { HomeFooter } from "../components/home/HomeFooter";
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
    <main className="home-v2">
      <div className="home-v2-shell">
        <HomeTopNav session={session} setSession={setSession} />
        <HeroSection settings={siteSettings} />
        <PlatformVisionSection />
        <ApplicationsSection />
        <RoadmapSection />
        <WhyMattersSection />
        <HomeFooter />
      </div>
    </main>
  );
}
