import { useRef, useState, type ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import { Building2, Upload, Save, RotateCcw, Trash2, Check, Info, Phone, Globe, Mail, Hash, Wallet, AlertTriangle } from 'lucide-react';
import { useHotelDetails, type HotelDetails } from '@/contexts/HotelDetailsContext';
import { HotelNavbar } from '@/components/hotel/HotelNavbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props { embedded?: boolean }

type FieldDef = {
  key: keyof Omit<HotelDetails, 'logo'>;
  label: string;
  placeholder: string;
  type?: string;
  icon: typeof Building2;
  full?: boolean;
};

const FIELDS: FieldDef[] = [
  { key: 'hotelName',      label: 'Hotel name',     placeholder: 'Отель Саёхат',              icon: Building2 },
  { key: 'companyName',    label: 'Company name',   placeholder: 'ООО "Sayohat Group"',       icon: Info },
  { key: 'inn',            label: 'INN',            placeholder: '123456789',                 icon: Hash },
  { key: 'raschetnyiSchet',label: 'Расчётный счёт', placeholder: '2020 8000 0000 0000 0000',  icon: Wallet, full: true },
  { key: 'telephone',      label: 'Telephone',      placeholder: '+998 71 000-00-00',         icon: Phone, type: 'tel' },
  { key: 'site',           label: 'Site',           placeholder: 'https://sayohat.uz',        icon: Globe },
  { key: 'email',          label: 'E-mail',         placeholder: 'info@sayohat.uz',           icon: Mail, type: 'email' },
];

export default function HotelDetailsPage({ embedded = false }: Props) {
  const { details, setDetails, reset } = useHotelDetails();
  const [draft, setDraft] = useState<HotelDetails>(details);
  const [saved, setSaved] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const detailsKey = JSON.stringify(details);
  const [lastLoaded, setLastLoaded] = useState(detailsKey);
  if (lastLoaded !== detailsKey) {
    setDraft(details);
    setLastLoaded(detailsKey);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(details);

  const onLogoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDraft((p) => ({ ...p, logo: String(reader.result || '') }));
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    setDetails(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const handleClearAll = () => {
    reset();
    setDraft({ logo:'', hotelName:'', companyName:'', inn:'', raschetnyiSchet:'', telephone:'', site:'', email:'' });
    setConfirmClear(false);
  };

  const inner = (
    <div className="mx-auto w-full max-w-5xl px-4 pt-8 pb-16 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[hsl(265_85%_55%)]">Administration</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-black tracking-tight text-foreground">
            <Building2 className="h-6 w-6 text-[hsl(265_85%_55%)]" />
            Hotel details
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Информация появляется в квитанциях об оплате.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setDraft(details); }}
            disabled={!dirty}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Отменить
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty}
            className="gap-1.5 bg-gradient-to-r from-[hsl(265_85%_55%)] to-[hsl(280_85%_60%)] text-white shadow-md shadow-purple-500/30"
          >
            {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saved ? 'Сохранено' : 'Сохранить'}
          </Button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-slate-200/70 bg-white/70 p-6 shadow-xl shadow-purple-500/5 backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
      >
        <div className="grid gap-6 md:grid-cols-[240px_1fr]">
          {/* Logo card */}
          <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/60 p-4 dark:border-white/10 dark:from-white/5 dark:to-white/[0.02]">
            <Label className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Logo</Label>
            <div className="mt-2 flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white dark:border-white/15 dark:bg-white/5">
              {draft.logo ? (
                <img src={draft.logo} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground">Нет логотипа</span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onLogoChange}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1 gap-1.5"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" /> Загрузить
              </Button>
              {draft.logo && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDraft((p) => ({ ...p, logo: '' }))}
                  title="Удалить логотип"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Fields */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.key}
                  className={`group rounded-2xl border border-slate-200/70 bg-white/80 p-3.5 transition hover:border-[hsl(265_85%_75%)] hover:shadow-sm dark:border-white/10 dark:bg-white/[0.03] ${f.full ? 'sm:col-span-2' : ''}`}
                >
                  <Label
                    htmlFor={`hd-${f.key}`}
                    className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    <Icon className="h-3 w-3 text-[hsl(265_85%_55%)]" />
                    {f.label}
                  </Label>
                  <Input
                    id={`hd-${f.key}`}
                    type={f.type ?? 'text'}
                    placeholder={f.placeholder}
                    value={draft[f.key]}
                    onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="mt-1.5 border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none text-sm font-medium"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-slate-200/60 pt-4 text-xs text-muted-foreground dark:border-white/10">
          <span>Данные сохраняются локально на этом устройстве.</span>
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="inline-flex items-center gap-1.5 font-semibold text-destructive hover:underline"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Очистить всё
          </button>
        </div>
      </motion.div>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-4 w-4" />
              </span>
              Очистить все реквизиты?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Это удалит логотип и все поля отеля (название, ИНН, счёт, контакты). Действие нельзя отменить, а информация исчезнет из будущих квитанций.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Да, очистить всё
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (embedded) return inner;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-[hsl(265_60%_98%)] dark:to-background">
      <HotelNavbar totalRooms={0} viewMode="timeline" onViewModeChange={() => {}} />
      {inner}
    </div>
  );
}
