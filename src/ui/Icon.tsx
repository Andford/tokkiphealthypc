import { ICONS, ICON_VIEWBOX, type IconName } from "./icons";

export function Icon({ name, size = 24, class: cls }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg class={`icon ${cls ?? ""}`} width={size} height={size} viewBox={ICON_VIEWBOX} aria-hidden="true" focusable="false">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  );
}
