// The star that adds a project or a task to the sidebar shortcuts. One quiet button, one press to
// star or un-star. Nothing is announced when it works — the star itself is the answer; only a
// failure raises a toast.

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toggleFavorite } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { FAVORITES_KEY, isFavorited, useFavorites } from "@/components/hooks/use-favorites";
import { StarIcon } from "@/components/shell/icons";
import type { FavoriteTargetName } from "@/lib/zod-schemas";

export function FavoriteStar({
  targetType,
  targetId,
  className = "",
}: {
  targetType: FavoriteTargetName;
  targetId: string;
  className?: string;
}) {
  const favorites = useFavorites();
  const queryClient = useQueryClient();
  const { run, pending } = useAction();
  const on = isFavorited(favorites.data, targetType, targetId);

  return (
    <button
      type="button"
      disabled={pending || favorites.isPending}
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      title={on ? "Remove from favorites" : "Add to favorites"}
      onClick={() =>
        run(() => toggleFavorite({ targetType, targetId }), {
          failure: "Couldn't change your favorites. Try again.",
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: FAVORITES_KEY });
          },
        })
      }
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] transition-colors hover:bg-[var(--page-bg)] disabled:cursor-not-allowed ${
        on ? "text-[var(--brand-accent)]" : "text-[var(--brand-gray)] hover:text-[var(--brand-primary)]"
      } ${className}`}
    >
      <StarIcon filled={on} />
    </button>
  );
}
