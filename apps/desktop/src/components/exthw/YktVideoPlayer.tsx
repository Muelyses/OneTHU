import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * 内嵌 HLS/MP4 播放器（R27）：雨课堂视频是 HLS（m3u8），Chromium 内核不原生支持，
 * 因此按需动态加载 hls.js（仅视频内容才加载，不影响首屏体积）；mp4 直接交给 <video>。
 *
 * 不打开官方页、不在应用内 WebView 里播——真正的内嵌 <video>。
 * 失败态明确：错误文案 + 「复制直链」（用户仍可自行处置），不静默白屏。
 */
import { useEffect, useRef, useState } from "react";
import type HlsType from "hls.js";

export function YktVideoPlayer({ src, title }: { src: string; title?: string }) {
  const uiLocale = useUiLocale();

  const ref = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"loading" | "hls" | "direct" | "failed">("loading");

  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;
    let hls: HlsType | null = null;
    let cancelled = false;
    const isHls = /\.m3u8(?:[?#]|$)/i.test(src);
    const nativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";

    if (isHls && !nativeHls) {
      void import("hls.js")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setErr(i18n("components.exthw.yktvideoplayer.19a7e7a919c4"));
            setMode("failed");
            return;
          }
          hls = new Hls({ enableWorker: true, lowLatencyMode: false });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            setErr(
              data.type === Hls.ErrorTypes.NETWORK_ERROR
                ? i18n("components.exthw.yktvideoplayer.e76486fc8553")
                : i18n("components.exthw.yktvideoplayer.6a4fbd94df3d"),
            );
            setMode("failed");
            hls?.destroy();
          });
          hls.loadSource(src);
          hls.attachMedia(video);
          setMode("hls");
        })
        .catch(() => {
          setErr(i18n("components.exthw.yktvideoplayer.0e09b5f31d3c"));
          setMode("failed");
        });
    } else {
      video.src = src;
      setMode("direct");
    }
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src]);

  const copy = () => {
    void navigator.clipboard?.writeText(src).catch(() => undefined);
  };

  return (
    <div className="ykt-video">
      {err ? (
        <div className="ykt-ans-empty">
          {err}
          <Btn variant="ghost" onClick={copy}>{i18n("components.exthw.yktvideoplayer.aedc355f35ae")}</Btn>
        </div>
      ) : null}
      {/* 失败时保留控件条以便用户重试；成功路径由 hls.js 或浏览器直接驱动 */}
      <video
        ref={ref}
        className="ykt-video-el"
        controls
        playsInline
        preload="metadata"
        title={title}
        style={mode === "failed" ? { display: "none" } : undefined}
      />
    </div>
  );
}
