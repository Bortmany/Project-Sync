// The signed-in person's starred shortcuts: the list the sidebar shows and the helpers the star
// button needs. The fetch/unwrap helper and the DTO shape are the shared ones — readRoute from
// use-api.ts and FavoriteDTO from src/lib/zod-schemas.ts. Nothing is redefined here.

"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import { readRoute } from "@/components/hooks/use-api";
import { FavoriteDTO, type FavoriteTargetName } from "@/lib/zod-schemas";

/** Every favorites query hangs off this key, so one invalidate refreshes the sidebar and the stars. */
export const FAVORITES_KEY = ["favorites"] as const;

/** How many shortcuts the sidebar shows before it stops — the rest stay on their own pages. */
export const SIDEBAR_FAVORITES_LIMIT = 10;

export function useFavorites(): UseQueryResult<FavoriteDTO[]> {
  return useQuery({
    queryKey: FAVORITES_KEY,
    queryFn: () => readRoute("/api/favorites", z.array(FavoriteDTO)),
    staleTime: 60_000,
  });
}

/** Where a shortcut points — the routes named in the DTO's own contract. */
export function favoriteHref(favorite: {
  targetType: FavoriteTargetName;
  targetId: string;
}): string {
  if (favorite.targetType === "PROJECT") return `/projects/${favorite.targetId}`;
  if (favorite.targetType === "MAIN_TASK") return `/tasks/${favorite.targetId}`;
  return `/discipline-tasks/${favorite.targetId}`;
}

/** True when this exact thing is already starred. */
export function isFavorited(
  favorites: FavoriteDTO[] | undefined,
  targetType: FavoriteTargetName,
  targetId: string,
): boolean {
  return (favorites ?? []).some(
    (item) => item.targetType === targetType && item.targetId === targetId,
  );
}
