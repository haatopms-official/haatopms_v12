import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PriceSlot {
  guest: number;
  resident: number;
  non_resident: number;
}

export interface SidePanelRow {
  No: number;
  Category: string;
  'Room numbers': string;
  Price: PriceSlot[];
  category_id: string;
  room_number_list: number[];
  max_guests: number;
}

export function useSidePanel() {
  const [rows, setRows] = useState<SidePanelRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchSidePanel = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('side_panel')
        .select('*')
        .order('No', { ascending: true });

      if (!error && data) {
        setRows(data as SidePanelRow[]);
      }
    } catch (err) {
      console.error('Failed to load side_panel view:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSidePanel();

    // Listen to real-time updates on base tables driving the view
    const channel = supabase
      .channel('side-panel-realtime-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_app_state', filter: 'state_key=eq.grid' },
        () => void fetchSidePanel()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => void fetchSidePanel()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchSidePanel]);

  return { rows, loading, refresh: fetchSidePanel };
}