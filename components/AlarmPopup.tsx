
import React, { useEffect } from 'react';
import { AppEvent } from '../types';
import { Bell, Calendar, Clock } from 'lucide-react';
import { getNextOccurrence } from '../services/timeService';

interface AlarmPopupProps {
  event: AppEvent | null;
  onClose: () => void;
  onSnooze: () => void;
}

export const AlarmPopup: React.FC<AlarmPopupProps> = ({ event, onClose, onSnooze }) => {
  if (!event) return null;

  const next = getNextOccurrence(event);

  // Simple alert sound effect
  useEffect(() => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);

        gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.5);
      }
    } catch (e) {
      console.error("Audio play failed", e);
    }
  }, [event]);

  return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 transform transition-all">
          <div className="bg-indigo-600 p-6 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full bg-white/10 blur-3xl scale-150 animate-pulse"></div>
            <div className="relative z-10 mx-auto w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-3 backdrop-blur-md">
              <Bell className="w-8 h-8 text-white animate-bounce" />
            </div>
            <h2 className="relative z-10 text-white text-lg font-medium opacity-90">Reminder</h2>
          </div>

          <div className="p-6 text-center">
            <h3 className="text-2xl font-bold text-slate-800 mb-2">{event.title}</h3>
            <p className="text-slate-500 mb-6">{event.description || 'No description provided'}</p>

            <div className="bg-slate-50 rounded-lg p-3 mb-6 flex items-center justify-center gap-4 text-sm text-slate-600">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-indigo-500" />
                <span>{next.date.toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-indigo-500" />
                <span>{next.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                  onClick={onSnooze}
                  className="py-3 px-4 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
              >
                Snooze
              </button>
              <button
                  onClick={onClose}
                  className="py-3 px-4 rounded-xl bg-indigo-600 text-white font-medium shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
  );
};
