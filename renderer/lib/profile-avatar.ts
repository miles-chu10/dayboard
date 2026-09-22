import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@glaze/core/components";
import { useEffect } from "react";

import { errorMessage, invoke } from "./ipc";

export const profileAvatarQueryKey = ["profile-avatar"] as const;

type AvatarResult = { dataUrl: string | null };

export function useProfileAvatar() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: profileAvatarQueryKey,
    queryFn: () => invoke<AvatarResult>("profile:getAvatar"),
    staleTime: Infinity,
  });

  useEffect(() => {
    return window.glazeAPI.glaze.ipc.onNotification("profile:changed", (payload: unknown) => {
      const dataUrl =
        payload &&
        typeof payload === "object" &&
        "dataUrl" in payload &&
        (typeof (payload as AvatarResult).dataUrl === "string" ||
          (payload as AvatarResult).dataUrl === null)
          ? (payload as AvatarResult).dataUrl
          : null;
      queryClient.setQueryData<AvatarResult>(profileAvatarQueryKey, { dataUrl });
    });
  }, [queryClient]);

  const pick = useMutation({
    mutationFn: () => invoke<AvatarResult>("profile:pickAvatar"),
    onSuccess: (result) => queryClient.setQueryData(profileAvatarQueryKey, result),
    onError: (error) => toast.error(`Couldn't update picture: ${errorMessage(error)}`),
  });

  const clear = useMutation({
    mutationFn: () => invoke<AvatarResult>("profile:clearAvatar"),
    onSuccess: (result) => queryClient.setQueryData(profileAvatarQueryKey, result),
    onError: (error) => toast.error(`Couldn't remove picture: ${errorMessage(error)}`),
  });

  return {
    dataUrl: query.data?.dataUrl ?? null,
    isLoading: query.isPending,
    pick: () => pick.mutate(),
    clear: () => clear.mutate(),
    busy: pick.isPending || clear.isPending,
    hasAvatar: Boolean(query.data?.dataUrl),
  };
}
