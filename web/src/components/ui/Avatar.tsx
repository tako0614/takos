import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { useI18n } from "../../store/i18n.ts";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

interface AvatarProps extends JSX.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  name?: string;
  size?: AvatarSize;
}

const sizeMap: Record<AvatarSize, { size: string; fontSize: string }> = {
  xs: { size: "1.5rem", fontSize: "0.625rem" },
  sm: { size: "2rem", fontSize: "0.75rem" },
  md: { size: "2.5rem", fontSize: "0.875rem" },
  lg: { size: "3rem", fontSize: "1rem" },
  xl: { size: "4rem", fontSize: "1.25rem" },
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 50%)`;
}

export function Avatar(props: AvatarProps) {
  const { t } = useI18n();
  const [local, rest] = splitProps(props, [
    "src",
    "alt",
    "name",
    "size",
    "class",
    "style",
  ]);

  const dimension = () => sizeMap[local.size ?? "md"].size;
  const fontSize = () => sizeMap[local.size ?? "md"].fontSize;

  const baseStyle = (): JSX.CSSProperties => ({
    width: dimension(),
    height: dimension(),
    "border-radius": "var(--radius-full)",
    overflow: "hidden",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    "flex-shrink": "0",
    "background-color": local.name
      ? stringToColor(local.name)
      : "var(--color-bg-tertiary)",
    color: "white",
    "font-size": fontSize(),
    "font-weight": "500",
    ...(typeof local.style === "object" ? local.style : {}),
  });

  if (local.src) {
    return (
      <div class={local.class} style={baseStyle()} {...rest}>
        <img
          src={local.src}
          alt={local.alt || local.name || t("avatar")}
          style={{ width: "100%", height: "100%", "object-fit": "cover" }}
        />
      </div>
    );
  }

  return (
    <div class={local.class} style={baseStyle()} {...rest}>
      {local.name ? getInitials(local.name) : "?"}
    </div>
  );
}
