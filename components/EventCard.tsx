
import React from 'react';
import { AppEvent } from '../types';
import { getNextOccurrence } from '../services/timeService';
import { downloadIcs } from '../services/calendar';
import { RotateCw, Moon, Trash2, Edit2, CalendarPlus } from 'lucide-react';

interface EventCardProps {
  event: AppEvent;
  onEdit: (event: AppEvent) => void;
  onDelete: (id: string) => void;
}

export const EventCard: React.FC<EventCardProps> = ({ event, onEdit, onDelete }) => {
  const next = getNextOccurrence(event);

  const getRecurrenceLabel = () => {
    if (!event.recurrenceRule) return 'One-time';
    const r = event.recurrenceRule;
    switch(r.type) {
      case 'daily': return 'Daily';
      case 'weekly': return 'Weekly';
      case 'monthly': return 'Monthly';
      case 'yearly_solar': return 'Yearly';
      case 'yearly_lunar':
        const { month, day } = r.lunarData || {};
        return `Lunar ${month}/${day}`;
      case 'custom':
        return `Every ${r.interval} ${r.unit}(s)`;
      default: return 'Custom';
    }
  };

  const isLunar = event.recurrenceRule?.type === 'yearly_lunar';

  const getFlag = () => {
    if (event.timezone === 'Asia/Shanghai') return '🇨🇳 CN';
    if (event.timezone === 'America/Toronto') return '🇨🇦 CA';
    return '🌍';
  };

  return (
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-all relative group">
        <div className="flex justify-between items-start mb-2">
          <div className="pr-8">
            <h3 className="font-semibold text-lg text-slate-800 line-clamp-1 flex items-center gap-2">
              <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 shrink-0">{getFlag()}</span>
              {event.title}
            </h3>
            {event.description && <p className="text-sm text-slate-500 mt-1 line-clamp-2">{event.description}</p>}
          </div>

          <div className="flex gap-1 shrink-0">
            <button
                onClick={() => downloadIcs(event)}
                className="text-slate-300 hover:text-green-600 hover:bg-green-50 transition-colors p-1.5 rounded-md"
                title="Add to Phone Calendar"
                aria-label="Add to Phone Calendar"
            >
              <CalendarPlus className="w-4 h-4" />
            </button>
            <button
                onClick={() => onEdit(event)}
                className="text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors p-1.5 rounded-md"
                aria-label="Edit event"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
                onClick={() => onDelete(event.id)}
                className="text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors p-1.5 rounded-md"
                aria-label="Delete event"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-4 text-xs sm:text-sm">
          {event.recurrenceRule?.type !== 'none' && (
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${isLunar ? 'bg-indigo-50 border-indigo-100 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                {isLunar ? <Moon className="w-3.5 h-3.5" /> : <RotateCw className="w-3.5 h-3.5" />}
                <span>{getRecurrenceLabel()}</span>
              </div>
          )}
        </div>

        <div className={`mt-4 pt-3 border-t border-slate-100 flex items-center justify-between ${next.isToday ? 'text-amber-600 bg-amber-50/50 -mx-5 px-5 py-2 -mb-2' : 'text-slate-500'}`}>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Next Occurrence</span>
            <span className="text-sm font-medium mt-0.5">
            {next.displayString}
          </span>
          </div>
          <div className="text-right">
           <span className={`text-sm font-bold ${next.remainingText === 'Past' ? 'text-slate-400' : 'text-indigo-600'}`}>
             {next.remainingText}
           </span>
          </div>
        </div>
      </div>
  );
};
