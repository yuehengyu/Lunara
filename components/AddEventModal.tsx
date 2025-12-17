
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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [inputType, setInputType] = useState<'solar' | 'lunar'>('solar');
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('09:00');
  const [timezone, setTimezone] = useState(TIMEZONE_CA);

  const [lunarYear, setLunarYear] = useState(new Date().getFullYear());
  const [lunarMonth, setLunarMonth] = useState(1);
  const [lunarDay, setLunarDay] = useState(1);

  const [recurrenceType, setRecurrenceType] = useState<string>('none');
  const [customInterval, setCustomInterval] = useState(1);
  const [customUnit, setCustomUnit] = useState<'hour' | 'day' | 'week' | 'month' | 'year'>('day');

  const [reminders, setReminders] = useState<CustomReminder[]>([]);
  const [newReminderVal, setNewReminderVal] = useState<number | ''>('');
  const [newReminderUnit, setNewReminderUnit] = useState<'minutes'|'hours'|'days'>('minutes');

  useEffect(() => {
    if (isOpen) {
      if (initialEvent) {
        // EDIT MODE
        setTitle(initialEvent.title);
        setDescription(initialEvent.description || '');
        setTimezone(initialEvent.timezone);

        // Parse from nextAlertAt
        const dt = DateTime.fromISO(initialEvent.nextAlertAt).setZone(initialEvent.timezone);
        setDateStr(dt.toFormat('yyyy-MM-dd'));
        setTimeStr(dt.toFormat('HH:mm'));

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

        const parsedReminders: CustomReminder[] = (initialEvent.reminders || []).map(m => {
          if (m === 0) return { value: 0, unit: 'minutes' };
          if (m % 1440 === 0) return { value: m / 1440, unit: 'days' };
          if (m % 60 === 0) return { value: m / 60, unit: 'hours' };
          return { value: m, unit: 'minutes' };
        });
        setReminders(parsedReminders);
        setNewReminderVal('');

      } else {
        // CREATE MODE
        setTitle('');
        setDescription('');

        // Default date: Today
        setDateStr(DateTime.now().setZone(TIMEZONE_CA).toFormat('yyyy-MM-dd'));
        setTimeStr('09:00');
        setTimezone(TIMEZONE_CA);
        setInputType('solar');
        setRecurrenceType('none');

        setReminders([{ value: 0, unit: 'minutes' }]);
        setNewReminderVal('');

        const lunarNow = Lunar.fromDate(new Date());
        setLunarYear(lunarNow.getYear());
        setLunarMonth(lunarNow.getMonth());
        setLunarDay(lunarNow.getDay());
      }
    }
  }, [isOpen, initialEvent]);

  if (!isOpen) return null;

  const handleAddReminder = () => {
    if (newReminderVal === '' || newReminderVal < 0) return;
    setReminders([...reminders, { value: Number(newReminderVal), unit: newReminderUnit }]);
    setNewReminderVal('');
  };

  const removeReminder = (index: number) => {
    setReminders(reminders.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Calculate Next Alert Time
    // We strictly use the selected Timezone to construct the ISO string.
    let dt: DateTime;

    if (inputType === 'lunar') {
      try {
        const lunar = Lunar.fromYmd(lunarYear, lunarMonth, lunarDay);
        const solar = lunar.getSolar();
        const solarDateStr = `${solar.getYear()}-${String(solar.getMonth()).padStart(2, '0')}-${String(solar.getDay()).padStart(2, '0')}`;
        dt = DateTime.fromISO(`${solarDateStr}T${timeStr}`, { zone: timezone });
      } catch (err) {
        alert("Invalid Lunar Date");
        return;
      }
    } else {
      dt = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: timezone });
    }

    // IMPORTANT: Ensure we send the full ISO string WITH the timezone offset.
    // e.g. "2024-12-18T09:00:00.000-05:00"
    const nextAlertAt = dt.toISO();

    if (!nextAlertAt) {
      alert("Invalid Date/Time selection");
      return;
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
          // If they selected Solar but want Lunar recurrence, convert current date to Lunar
          const lunar = Lunar.fromDate(dt.toJSDate());
          rule.type = 'yearly_lunar';
          rule.lunarData = { month: lunar.getMonth(), day: lunar.getDay() };
        }
      }
    }

    // 3. Reminders
    let finalReminders = [...reminders];
    if (newReminderVal !== '' && Number(newReminderVal) >= 0) {
      const pendingVal = Number(newReminderVal);
      const isDuplicate = finalReminders.some(r => r.value === pendingVal && r.unit === newReminderUnit);
      if (!isDuplicate) finalReminders.push({ value: pendingVal, unit: newReminderUnit });
    }

    const reminderMinutes = finalReminders.map(r => {
      if (r.value === 0) return 0;
      if (r.unit === 'days') return r.value * 1440;
      if (r.unit === 'hours') return r.value * 60;
      return r.value;
    });

    const eventPayload: AppEvent = {
      id: initialEvent?.id || crypto.randomUUID(),
      title,
      description,
      nextAlertAt: nextAlertAt, // THE SOURCE OF TRUTH
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
          <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl shrink-0">
            <h2 className="text-xl font-bold text-slate-800">
              {initialEvent ? 'Edit Event' : 'New Event'}
            </h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded-full transition">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto space-y-6">
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
                  placeholder="Add description..."
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide">Timezone</label>
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

            <div className="bg-slate-50 p-4 rounded-xl space-y-4 border border-slate-100">
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
                          {Array.from({length: 12}, (_, i) => i + 1).map(m => <option key={m} value={m}>{m} Month</option>)}
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

            <div className="grid grid-cols-1 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2 tracking-wide">Recurrence</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'none', label: 'None' },
                    { id: 'daily', label: 'Daily' },
                    { id: 'weekly', label: 'Weekly' },
                    { id: 'monthly', label: 'Monthly' },
                    { id: 'yearly_solar', label: 'Yearly' },
                    { id: 'yearly_lunar', label: 'Yearly (Lunar)' },
                    { id: 'custom', label: 'Custom' }
                  ].map((item) => (
                      <button
                          key={item.id}
                          type="button"
                          onClick={() => setRecurrenceType(item.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${recurrenceType === item.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                      >
                        {item.label}
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
                        <option value="hour">hour</option>
                        <option value="day">day</option>
                        <option value="week">week</option>
                        <option value="month">month</option>
                        <option value="year">year</option>
                      </select>
                    </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2 tracking-wide flex items-center gap-2">
                  <Clock className="w-3 h-3" /> Reminders
                </label>

                {reminders.length === 0 && (
                    <div className="text-xs text-slate-400 mb-2 italic">
                      No reminders set. Add one below.
                    </div>
                )}

                <div className="flex flex-wrap gap-2 mb-3">
                  {reminders.map((rem, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-100">
                    <span className="text-xs font-medium text-amber-800">
                      {rem.value === 0 ? 'On time' : `Before ${rem.value} ${rem.unit === 'minutes' ? 'min' : rem.unit === 'hours' ? 'hr' : 'day'}`}
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
                      placeholder="#"
                      onChange={e => setNewReminderVal(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value)))}
                      className="w-16 px-2 py-1.5 border border-slate-200 rounded-md text-sm"
                  />
                  <select
                      value={newReminderUnit}
                      onChange={e => setNewReminderUnit(e.target.value as any)}
                      className="px-2 py-1.5 border border-slate-200 rounded-md text-sm bg-white"
                  >
                    <option value="minutes">min</option>
                    <option value="hours">hr</option>
                    <option value="days">day</option>
                  </select>
                  <span className="text-sm text-slate-400">before</span>
                  <button
                      type="button"
                      onClick={handleAddReminder}
                      className="ml-auto flex items-center gap-1 bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-indigo-100 border border-indigo-100"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
              </div>
            </div>
          </div>

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
