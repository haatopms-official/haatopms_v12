import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCountries() {
  return useQuery({
    queryKey: ["countries"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("countries")
        .select("code,name_ru,name_en,flag")
        .order("name_ru");
      if (error) throw error;
      return data;
    },
  });
}