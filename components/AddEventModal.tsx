import React, { useState, useEffect } from 'react';
import { AppEvent, RecurrenceRule } from '../types';
import { X, Clock, Moon, Sun, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { Lunar } from 'lunar-javascript';

interface AddEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (event: AppEvent) => void;
  initialEvent?: AppEvent | null;
}

interface CustomReminder {
  value: number;
  unit: 'minutes' | 'hours' | 'days';
}

const TIMEZONE_CN = 'Asia/Shanghai';
const TIMEZONE_CA = 'America/Toronto';

export const AddEventModal: React.FC<AddEventModalProps> = ({ isOpen, onClose, onSave, initialEvent }) => {
  // Form States
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Date/Time Logic
  const [inputType, setInputType] = useState<'solar' | 'lunar'>('solar');
  const [dateStr, setDateStr] = useState(''); // YYYY-MM-DD
  const [timeStr, setTimeStr] = useState('09:00');

  // Simplified Timezone: Default to Toronto if creating new, or use existing
  const [timezone, setTimezone] = useState(TIMEZONE_CA);

  // Lunar Input Specifics
  const [lunarYear, setLunarYear] = useState(new Date().getFullYear());
  const [lunarMonth, setLunarMonth] = useState(1);
  const [lunarDay, setLunarDay] = useState(1);

  // Recurrence Logic
  const [recurrenceType, setRecurrenceType] = useState<string>('none');
  const [customInterval, setCustomInterval] = useState(1);
  const [customUnit, setCustomUnit] = useState<'hour' | 'day' | 'week' | 'month' | 'year'>('day');

  // Reminders Logic
  const [reminders, setReminders] = useState<CustomReminder[]>([]);
  const [newReminderVal, setNewReminderVal] = useState(1);
  const [newReminderUnit, setNewReminderUnit] = useState<'minutes'|'hours'|'days'>('hours');

  // Initialize form when opening
  useEffect(() => {
    if (isOpen) {
      if (initialEvent) {
        // EDIT MODE
        setTitle(initialEvent.title);
        setDescription(initialEvent.description || '');
        setTimezone(initialEvent.timezone);

        // Parse Date in the event's timezone
        const dt = DateTime.fromISO(initialEvent.startAt).setZone(initialEvent.timezone);
        setDateStr(dt.toFormat('yyyy-MM-dd'));
        setTimeStr(dt.toFormat('HH:mm'));

        // Recurrence setup
        if (initialEvent.recurrenceRule) {
          setRecurrenceType(initialEvent.recurrenceRule.type);
          if (initialEvent.recurrenceRule.type === 'custom') {
            setCustomInterval(initialEvent.recurrenceRule.interval || 1);
            setCustomUnit(initialEvent.recurrenceRule.unit || 'day');
          }
          if (initialEvent.recurrenceRule.type === 'yearly_lunar' && initialEvent.recurrenceRule.lunarData) {
            setInputType('lunar');
            setLunarMonth(initialEvent.recurrenceRule.lunarData.month);
            setLunarDay(initialEvent.recurrenceRule.lunarData.day);
          } else {
            setInputType('solar');
          }
        } else {
          setRecurrenceType('none');
          setInputType('solar');
        }

        // Reminders setup
        const parsedReminders: CustomReminder[] = (initialEvent.reminders || []).map(m => {
          if (m === 0) return { value: 0, unit: 'minutes' };
          if (m % 1440 === 0) return { value: m / 1440, unit: 'days' };
          if (m % 60 === 0) return { value: m / 60, unit: 'hours' };
          return { value: m, unit: 'minutes' };
        });
        setReminders(parsedReminders);

      } else {
        // CREATE MODE (Reset)
        setTitle('');
        setDescription('');
        setDateStr(new Date().toISOString().split('T')[0]);
        setTimeStr('09:00');
        setTimezone(TIMEZONE_CA); // Default to Canada
        setInputType('solar');
        setRecurrenceType('none');
        setReminders([]);

        const lunarNow = Lunar.fromDate(new Date());
        setLunarYear(lunarNow.getYear());
        setLunarMonth(lunarNow.getMonth());
        setLunarDay(lunarNow.getDay());
      }
    }
  }, [isOpen, initialEvent]);

  if (!isOpen) return null;

  const handleAddReminder = () => {
    setReminders([...reminders, { value: newReminderVal, unit: newReminderUnit }]);
  };

  const removeReminder = (index: number) => {
    setReminders(reminders.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Calculate Start Date (ISO)
    let finalIsoStart = '';

    if (inputType === 'lunar') {
      try {
        const lunar = Lunar.fromYmd(lunarYear, lunarMonth, lunarDay);
        const solar = lunar.getSolar();
        const solarDateStr = `${solar.getYear()}-${String(solar.getMonth()).padStart(2, '0')}-${String(solar.getDay()).padStart(2, '0')}`;
        // Create DT in the selected timezone
        const dt = DateTime.fromISO(`${solarDateStr}T${timeStr}`, { zone: timezone });
        finalIsoStart = dt.toISO() || new Date().toISOString();
      } catch (err) {
        alert("Invalid Lunar Date");
        return;
      }
    } else {
      const dt = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: timezone });
      finalIsoStart = dt.toISO() || new Date().toISOString();
    }

    // 2. Build Recurrence Rule
    let rule: RecurrenceRule | null = null;
    if (recurrenceType !== 'none') {
      rule = { type: recurrenceType as any };

      if (recurrenceType === 'custom') {
        rule.interval = customInterval;
        rule.unit = customUnit;
      }

      if (inputType === 'lunar' || recurrenceType === 'yearly_lunar') {
        if (inputType === 'lunar') {
          rule.type = 'yearly_lunar';
          rule.lunarData = { month: lunarMonth, day: lunarDay };
        } else {
          const dt = DateTime.fromISO(finalIsoStart).setZone(timezone);
          const lunar = Lunar.fromDate(dt.toJSDate());
          rule.type = 'yearly_lunar';
          rule.lunarData = { month: lunar.getMonth(), day: lunar.getDay() };
        }
      }
    }

    // 3. Convert Reminders
    const reminderMinutes = reminders.map(r => {
      if (r.value === 0) return 0;
      if (r.unit === 'days') return r.value * 1440;
      if (r.unit === 'hours') return r.value * 60;
      return r.value;
    });

    const eventPayload: AppEvent = {
      id: initialEvent?.id || crypto.randomUUID(),
      title,
      description,
      startAt: finalIsoStart,
      isAllDay: false,
      timezone,
      recurrenceRule: rule,
      reminders: reminderMinutes,
      createdAt: initialEvent?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    onSave(eventPayload);
    onClose();
  };

  return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl shrink-0">
            <h2 className="text-xl font-bold text-slate-800">
              {initialEvent ? 'Edit Event' : 'New Event'}
            </h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded-full transition">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="p-6 overflow-y-auto space-y-6">

            {/* Title & Description */}
            <div className="space-y-3">
              <input
                  required
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full text-lg font-semibold placeholder:text-slate-300 border-0 border-b-2 border-slate-100 focus:border-indigo-500 focus:ring-0 px-0 py-2 transition-colors"
                  placeholder="Event Title (e.g., Mom's Birthday)"
              />
              <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  className="w-full text-sm text-slate-600 placeholder:text-slate-300 border border-slate-200 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all resize-none"
                  placeholder="Add details..."
              />
            </div>

            {/* Region / Timezone Selector - SIMPLIFIED */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide">Where is this event?</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                    type="button"
                    onClick={() => setTimezone(TIMEZONE_CN)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${timezone === TIMEZONE_CN ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200'}`}
                >
                  <span className="text-2xl mb-1">🇨🇳</span>
                  <span className="font-semibold text-sm">China</span>
                  <span className="text-[10px] opacity-70">Beijing Time</span>
                </button>

                <button
                    type="button"
                    onClick={() => setTimezone(TIMEZONE_CA)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${timezone === TIMEZONE_CA ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200'}`}
                >
                  <span className="text-2xl mb-1">🇨🇦</span>
                  <span className="font-semibold text-sm">Canada</span>
                  <span className="text-[10px] opacity-70">Toronto Time</span>
                </button>
              </div>
            </div>

            {/* Date & Time Section */}
            <div className="bg-slate-50 p-4 rounded-xl space-y-4 border border-slate-100">
              {/* Input Type Toggle */}
              <div className="flex bg-white rounded-lg p-1 border border-slate-200 w-fit">
                <button
                    type="button"
                    onClick={() => setInputType('solar')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${inputType === 'solar' ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Sun className="w-4 h-4" /> Solar
                </button>
                <button
                    type="button"
                    onClick={() => setInputType('lunar')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${inputType === 'lunar' ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Moon className="w-4 h-4" /> Lunar
                </button>
              </div>

              {/* Date Inputs */}
              <div className="grid grid-cols-2 gap-4">
                {inputType === 'solar' ? (
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Date</label>
                      <input
                          type="date"
                          value={dateStr}
                          onChange={e => setDateStr(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 outline-none"
                      />
                    </div>
                ) : (
                    <div className="col-span-2 grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Year</label>
                        <input type="number" value={lunarYear} onChange={e => setLunarYear(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm text-center" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Month</label>
                        <select value={lunarMonth} onChange={e => setLunarMonth(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm">
                          {Array.from({length: 12}, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Day</label>
                        <select value={lunarDay} onChange={e => setLunarDay(Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm">
                          {Array.from({length: 30}, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                    </div>
                )}

                <div className={inputType === 'lunar' ? 'col-span-2' : ''}>
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Time</label>
                  <input
                      type="time"
                      value={timeStr}
                      onChange={e => setTimeStr(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Recurrence & Reminder Split */}
            <div className="grid grid-cols-1 gap-6">
              {/* Recurrence */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2 tracking-wide">Repeat</label>
                <div className="flex flex-wrap gap-2">
                  {['none', 'daily', 'weekly', 'monthly', 'yearly_solar', 'yearly_lunar', 'custom'].map((type) => (
                      <button
                          key={type}
                          type="button"
                          onClick={() => setRecurrenceType(type)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${recurrenceType === type ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                      >
                        {type === 'yearly_solar' ? 'Yearly' : type === 'yearly_lunar' ? 'Yearly (Lunar)' : type === 'none' ? 'Never' : type.replace('_', ' ')}
                      </button>
                  ))}
                </div>

                {recurrenceType === 'custom' && (
                    <div className="mt-3 flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-100 w-fit">
                      <span className="text-sm text-slate-600">Every</span>
                      <input
                          type="number" min="1"
                          value={customInterval}
                          onChange={e => setCustomInterval(Math.max(1, parseInt(e.target.value)))}
                          className="w-14 px-2 py-1 border border-slate-200 rounded-md text-sm text-center"
                      />
                      <select
                          value={customUnit}
                          onChange={e => setCustomUnit(e.target.value as any)}
                          className="px-2 py-1 border border-slate-200 rounded-md text-sm bg-white"
                      >
                        <option value="hour">Hours</option>
                        <option value="day">Days</option>
                        <option value="week">Weeks</option>
                        <option value="month">Months</option>
                        <option value="year">Years</option>
                      </select>
                    </div>
                )}
              </div>

              {/* Reminders */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2 tracking-wide flex items-center gap-2">
                  <Clock className="w-3 h-3" /> Reminders
                </label>

                <div className="flex flex-wrap gap-2 mb-3">
                  {reminders.map((rem, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-100">
                    <span className="text-xs font-medium text-amber-800">
                      {rem.value === 0 ? 'Exact Time' : `${rem.value} ${rem.unit} before`}
                    </span>
                        <button type="button" onClick={() => removeReminder(idx)} className="text-amber-500 hover:text-red-500">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                  ))}
                </div>

                <div className="flex gap-2 items-center">
                  <input
                      type="number" min="0"
                      value={newReminderVal}
                      onChange={e => setNewReminderVal(Math.max(0, parseInt(e.target.value)))}
                      className="w-16 px-2 py-1.5 border border-slate-200 rounded-md text-sm"
                  />
                  <select
                      value={newReminderUnit}
                      onChange={e => setNewReminderUnit(e.target.value as any)}
                      className="px-2 py-1.5 border border-slate-200 rounded-md text-sm bg-white"
                  >
                    <option value="minutes">Mins</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                  <span className="text-sm text-slate-400">before</span>
                  <button
                      type="button"
                      onClick={handleAddReminder}
                      className="ml-auto flex items-center gap-1 bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-indigo-100"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-xl shrink-0">
            <button
                onClick={handleSubmit}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 rounded-lg shadow-lg shadow-slate-200 transition-all active:scale-[0.98]"
            >
              {initialEvent ? 'Save Changes' : 'Create Event'}
            </button>
          </div>
        </div>
      </div>
  );
};