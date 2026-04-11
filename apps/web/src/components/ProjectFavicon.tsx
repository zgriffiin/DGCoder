import { FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthenticatedAssetUrl } from "~/hooks/useAuthenticatedAssetUrl";
import { resolveServerUrl } from "~/lib/utils";

const loadedProjectFaviconSrcs = new Set<string>();

export function ProjectFavicon({ cwd, className }: { cwd: string; className?: string }) {
  const requestUrl = resolveServerUrl({
    protocol: window.location.protocol === "https:" ? "https" : "http",
    pathname: "/api/project-favicon",
    searchParams: { cwd },
  });

  return (
    <ProjectFaviconImage
      key={requestUrl}
      requestUrl={requestUrl}
      {...(className !== undefined ? { className } : {})}
    />
  );
}

function ProjectFaviconImage({
  requestUrl,
  className,
}: {
  requestUrl: string;
  className?: string;
}) {
  const authenticatedAsset = useAuthenticatedAssetUrl(requestUrl);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() =>
    loadedProjectFaviconSrcs.has(requestUrl) ? "loaded" : "loading",
  );

  useEffect(() => {
    if (authenticatedAsset.status === "error") {
      setStatus("error");
      return;
    }
    if (authenticatedAsset.status === "loading" && !loadedProjectFaviconSrcs.has(requestUrl)) {
      setStatus("loading");
    }
  }, [authenticatedAsset.status, requestUrl]);

  return (
    <>
      {status !== "loaded" ? (
        <FolderIcon className={`size-3.5 shrink-0 text-muted-foreground/50 ${className ?? ""}`} />
      ) : null}
      <img
        src={authenticatedAsset.src}
        alt=""
        className={`size-3.5 shrink-0 rounded-sm object-contain ${status === "loaded" ? "" : "hidden"} ${className ?? ""}`}
        onLoad={() => {
          loadedProjectFaviconSrcs.add(requestUrl);
          setStatus("loaded");
        }}
        onError={() => setStatus("error")}
      />
    </>
  );
}
