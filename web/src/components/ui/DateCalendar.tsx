import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

function toLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

interface DateCalendarProps {
  value?: string | null; // YYYY-MM-DD (local)
  onSelect: (date: string) => void;
  /** menor data permitida (YYYY-MM-DD local). Default: hoje. */
  minDate?: string;
}

/** Calendário de mês para escolha de data (somente de hoje em diante). */
export function DateCalendar({ value, onSelect, minDate }: DateCalendarProps) {
  const todayYmd = toLocalYmd(new Date());
  const min = minDate || todayYmd;
  const [view, setView] = useState(() => {
    const base = new Date();
    return { year: base.getFullYear(), month: base.getMonth() }; // 0-based
  });

  const minYear = Number(min.slice(0, 4));
  const minMonth = Number(min.slice(5, 7)) - 1;
  const atMinMonth = view.year === minYear && view.month === minMonth;

  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const offset = (first.getDay() + 6) % 7; // semana começa segunda
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const out: (string | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= daysInMonth; d++) out.push(toLocalYmd(new Date(view.year, view.month, d)));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  const prev = () => {
    if (atMinMonth) return;
    setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  };
  const next = () => setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));

  const disable = (ymd: string) => ymd < min;

  return (
    <div className="rounded-xl border border-black/10 p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prev}
          disabled={atMinMonth}
          className="h-8 w-8 rounded-lg border border-black/15 text-sm font-bold hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          aria-label="Mês anterior"
        >
          ‹
        </button>
        <p className="text-sm font-black uppercase tracking-wide">
          {MONTHS[view.month]} {view.year}
        </p>
        <button
          type="button"
          onClick={next}
          className="h-8 w-8 rounded-lg border border-black/15 text-sm font-bold hover:bg-black/5 cursor-pointer"
          aria-label="Próximo mês"
        >
          ›
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider text-black/40">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((ymd, i) =>
          ymd === null ? (
            <span key={`e${i}`} />
          ) : (
            <button
              key={ymd}
              type="button"
              disabled={disable(ymd)}
              onClick={() => onSelect(ymd)}
              className={cn(
                "aspect-square rounded-lg text-sm font-semibold cursor-pointer transition-all",
                disable(ymd) && "opacity-25 cursor-not-allowed",
                ymd === value && "bg-blue-600 text-white",
                ymd !== value && !disable(ymd) && "hover:bg-blue-600/10"
              )}
            >
              {Number(ymd.slice(8, 10))}
            </button>
          )
        )}
      </div>
    </div>
  );
}
