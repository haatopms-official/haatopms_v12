import React from 'react';
import { useSidePanel } from '@/hooks/useSidePanel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, LayoutGrid } from 'lucide-react';

export function SidePanel() {
  const { rows, loading, refresh } = useSidePanel();

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('ru-RU').format(val) + ' сум';
  };

  return (
    <div className="w-full rounded-[24px] border border-border/70 bg-card/60 p-5 shadow-lg backdrop-blur-md">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-foreground">Сводка категорий и номеров</h3>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background/80 text-muted-foreground hover:text-foreground"
          title="Обновить"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/60 hover:bg-transparent">
                <TableHead className="w-12 font-black text-xs uppercase">№</TableHead>
                <TableHead className="font-black text-xs uppercase">Категория</TableHead>
                <TableHead className="font-black text-xs uppercase">Номера (Гости)</TableHead>
                <TableHead className="font-black text-xs uppercase">Цены / Цены по гостям</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.category_id || row.No} className="border-border/40">
                  <TableCell className="font-bold text-muted-foreground">{row.No}</TableCell>
                  <TableCell className="font-extrabold text-foreground">{row.Category}</TableCell>
                  <TableCell className="font-medium text-foreground/90">
                    <div className="max-w-md break-words font-mono text-xs">
                      {row['Room numbers'] || '—'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {row.Price && row.Price.length > 0 ? (
                        row.Price.map((slot) => (
                          <div
                            key={slot.guest}
                            className="rounded-xl border border-border/50 bg-background/50 p-2 text-xs"
                          >
                            <div className="font-bold text-primary mb-1">Гость {slot.guest}</div>
                            <div className="flex justify-between gap-2 text-[11px]">
                              <span className="text-muted-foreground">Рез:</span>
                              <span className="font-semibold">{formatCurrency(slot.resident)}</span>
                            </div>
                            <div className="flex justify-between gap-2 text-[11px]">
                              <span className="text-muted-foreground">Нерез:</span>
                              <span className="font-semibold">{formatCurrency(slot.non_resident)}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">Нет цен</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}