// Where to look: your profile folder by default, or one you choose.

import { useEffect, useState } from "preact/hooks";
import { homeDir, pickPaths } from "../../core/api";
import { t } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";

export function useFolder(start: string) {
  const [folder, setFolder] = useState(start);
  useEffect(() => {
    if (!start) void homeDir().then(setFolder);
  }, []);
  return [folder, setFolder] as const;
}

export function FolderPick({ folder, set }: { folder: string; set: (f: string) => void }) {
  return (
    <div class="folder-pick">
      <Icon name="folder" />
      <span class="folder-path" title={folder}>
        {folder || "…"}
      </span>
      <button
        class="btn text small"
        onClick={async () => {
          const [p] = await pickPaths({ directory: true, multiple: false, title: t("Choose a folder") });
          if (p) set(p);
        }}
      >
        {t("Change")}
      </button>
    </div>
  );
}
