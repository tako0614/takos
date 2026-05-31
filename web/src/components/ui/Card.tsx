import { splitProps } from "solid-js";
import type { JSX } from "solid-js";

type CardVariant = "default" | "elevated" | "outlined";

interface CardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingMap = {
  none: "0",
  sm: "0.75rem",
  md: "1rem",
  lg: "1.5rem",
};

export function Card(props: CardProps) {
  const [local, rest] = splitProps(props, [
    "variant",
    "padding",
    "children",
    "class",
    "style",
  ]);

  const variantStyles: Record<CardVariant, JSX.CSSProperties> = {
    default: {
      border: "1px solid var(--color-border-primary)",
    },
    elevated: {
      "box-shadow": "var(--shadow-md)",
      "background-color": "var(--color-surface-elevated)",
    },
    outlined: {
      border: "1px solid var(--color-border-secondary)",
      "background-color": "transparent",
    },
  };

  const baseStyle = (): JSX.CSSProperties => ({
    "background-color": "var(--color-surface-primary)",
    "border-radius": "var(--radius-lg)",
    padding: paddingMap[local.padding ?? "md"],
    transition: "var(--transition-colors)",
    ...variantStyles[local.variant ?? "default"],
    ...(typeof local.style === "object" ? local.style : {}),
  });

  return (
    <div
      class={local.class}
      style={baseStyle()}
      {...rest}
    >
      {local.children}
    </div>
  );
}

export function CardHeader(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["children", "class", "style"]);

  return (
    <div
      class={local.class}
      style={{
        "margin-bottom": "1rem",
        "padding-bottom": "0.75rem",
        "border-bottom": "1px solid var(--color-border-primary)",
        ...(typeof local.style === "object" ? local.style : {}),
      }}
      {...rest}
    >
      {local.children}
    </div>
  );
}

export function CardTitle(props: JSX.HTMLAttributes<HTMLHeadingElement>) {
  const [local, rest] = splitProps(props, ["children", "class", "style"]);

  return (
    <h3
      class={local.class}
      style={{
        "font-size": "1rem",
        "font-weight": "600",
        color: "var(--color-text-primary)",
        margin: "0",
        ...(typeof local.style === "object" ? local.style : {}),
      }}
      {...rest}
    >
      {local.children}
    </h3>
  );
}

export function CardContent(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["children", "class", "style"]);

  return (
    <div
      class={local.class}
      style={{
        color: "var(--color-text-secondary)",
        ...(typeof local.style === "object" ? local.style : {}),
      }}
      {...rest}
    >
      {local.children}
    </div>
  );
}

export function CardFooter(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["children", "class", "style"]);

  return (
    <div
      class={local.class}
      style={{
        "margin-top": "1rem",
        "padding-top": "0.75rem",
        "border-top": "1px solid var(--color-border-primary)",
        display: "flex",
        "align-items": "center",
        gap: "0.5rem",
        ...(typeof local.style === "object" ? local.style : {}),
      }}
      {...rest}
    >
      {local.children}
    </div>
  );
}
