import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { Button } from "../ui/index.ts";

interface ProfileLoadMoreButtonProps {
  onLoadMore: () => void;
}

export function ProfileLoadMoreButton(props: ProfileLoadMoreButtonProps) {
  const { t } = useI18n();

  return (
    <div
      style={{
        display: "flex",
        "justify-content": "center",
        "margin-top": "1.5rem",
      }}
    >
      <Button
        variant="secondary"
        onClick={props.onLoadMore}
        leftIcon={
          <Icons.ChevronDown style={{ width: "1rem", height: "1rem" }} />
        }
      >
        {t("loadMore")}
      </Button>
    </div>
  );
}
