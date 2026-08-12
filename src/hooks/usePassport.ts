import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Passport } from "@/types/passport";

const key = (guestId: string) => ["passport", guestId];

export function usePassport(guestId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: key(guestId ?? "none"),
    enabled: !!guestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("passports")
        .select("*")
        .eq("guest_id", guestId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Passport | null;
    },
  });

  // Realtime updates across all active sessions
  useEffect(() => {
    if (!guestId) return;
    const ch = supabase
      .channel(`passport:${guestId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "passports", filter: `guest_id=eq.${guestId}` },
        (payload) => qc.setQueryData(key(guestId), (payload.new ?? null) as Passport | null),
      )
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [guestId, qc]);

  const save = useMutation({
    mutationFn: async (patch: Partial<Passport>) => {
      const { data, error } = await supabase.rpc("upsert_passport", {
        p_guest_id: guestId,
        p_last_name: patch.last_name ?? null,
        p_first_name: patch.first_name ?? null,
        p_middle_name: patch.middle_name ?? null,
        p_birth_date: patch.birth_date ?? null,
        p_issue_date: patch.issue_date ?? null,
        p_citizenship: patch.citizenship ?? "TJ",
        p_gender: patch.gender ?? null,
      });
      if (error) throw error;
      return data as Passport;
    },
    onSuccess: (row) => qc.setQueryData(key(guestId!), row),
  });

  return { passport: query.data ?? null, isLoading: query.isLoading, save };
}