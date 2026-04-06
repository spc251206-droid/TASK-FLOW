/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Trash2, CheckCircle2, Circle, ListTodo, Filter, Calendar, AlertCircle, ChevronUp, Minus, ChevronDown, Clock, Pencil, Check, X, Bell, BellRing, Volume2, DollarSign, TrendingUp, Download, FileSpreadsheet, ChevronRight, CornerDownRight, MapPin, ExternalLink, Loader2, BarChart3, Target } from 'lucide-react';
import { Todo, FilterType, Priority, Subtask } from './types';
import { GoogleGenAI } from "@google/genai";
import { supabase } from './lib/supabase';
import Auth from './components/Auth';
import { Session } from '@supabase/supabase-js';
import { LogOut, User } from 'lucide-react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [projectValue, setProjectValue] = useState('');
  const [dueDateValue, setDueDateValue] = useState('');
  const [dueTimeValue, setDueTimeValue] = useState('');
  const [currentPriority, setCurrentPriority] = useState<Priority>('medium');
  const [filter, setFilter] = useState<FilterType>('all');
  
  // Subtask input state
  const [subtaskInputs, setSubtaskInputs] = useState<Record<string, string>>({});

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Reminder state
  const [activeReminder, setActiveReminder] = useState<Todo | null>(null);

  // Amount state
  const [completingTodoId, setCompletingTodoId] = useState<string | null>(null);
  const [spendAmount, setSpendAmount] = useState('0');

  // Maps state
  const [isSearching, setIsSearching] = useState(false);
  const [mapResults, setMapResults] = useState<{ text: string, links: { uri: string, title: string }[] } | null>(null);
  const [searchingTodoId, setSearchingTodoId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      fetchTodos();

      // Set up real-time subscription
      const channel = supabase
        .channel(`public:todos:user:${session.user.id}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'todos',
          filter: `user_id=eq.${session.user.id}`
        }, (payload) => {
          if (payload.eventType === 'INSERT') {
            setTodos((prev) => [payload.new as Todo, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setTodos((prev) => prev.map((t) => (t.id === payload.new.id ? (payload.new as Todo) : t)));
          } else if (payload.eventType === 'DELETE') {
            setTodos((prev) => prev.filter((t) => t.id !== payload.old.id));
          }
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      setTodos([]);
    }
  }, [session]);

  const fetchTodos = async () => {
    if (!session) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('todos')
        .select('*')
        .eq('user_id', session.user.id)
        .order('createdAt', { ascending: false });

      if (error) throw error;
      setTodos(data || []);
    } catch (error) {
      console.error('Error fetching todos:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // Background check for reminders every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;

      const upcomingTodo = todos.find(todo => {
        if (!todo.dueDate || todo.completed || todo.reminderTriggered) return false;
        
        const dueTimestamp = new Date(todo.dueDate).getTime();
        const timeUntilDue = dueTimestamp - now;
        
        // Trigger if due in less than 5 minutes (but not already past due by more than a minute)
        return timeUntilDue <= fiveMinutesInMs && timeUntilDue > -60000;
      });

      if (upcomingTodo) {
        setActiveReminder(upcomingTodo);
        // Mark as triggered so it doesn't fire again
        setTodos(prev => prev.map(t => 
          t.id === upcomingTodo.id ? { ...t, reminderTriggered: true } : t
        ));
        
        // Play sound
        try {
          const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
          audio.play().catch(e => console.log('Audio playback failed:', e));
        } catch (e) {
          console.log('Audio failed:', e);
        }
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [todos]);

  const findNearbyStores = async (todo: Todo) => {
    setIsSearching(true);
    setSearchingTodoId(todo.id);
    setMapResults(null);

    try {
      // Get user location
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
      });

      const { latitude, longitude } = position.coords;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Where can I buy items related to "${todo.text}" nearby?`,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: { latitude, longitude }
            }
          }
        },
      });

      const text = response.text || "I couldn't find any specific places nearby.";
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const links = chunks
        .filter((chunk: any) => chunk.maps?.uri)
        .map((chunk: any) => ({
          uri: chunk.maps.uri,
          title: chunk.maps.title || "View on Maps"
        }));

      setMapResults({ text, links });
    } catch (error) {
      console.error("Error finding nearby stores:", error);
      setMapResults({ 
        text: "Sorry, I couldn't search for nearby places. Please make sure location access is enabled.", 
        links: [] 
      });
    } finally {
      setIsSearching(false);
    }
  };

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    let fullDueDate = null;
    if (dueDateValue) {
      const time = dueTimeValue || '00:00';
      fullDueDate = `${dueDateValue}T${time}:00`;
    }

    const newTodo = {
      text: inputValue.trim(),
      completed: false,
      priority: currentPriority,
      dueDate: fullDueDate,
      reminderTriggered: false,
      amount: 0,
      subtasks: [],
      project: projectValue.trim(),
      user_id: session?.user.id
    };

    try {
      const { error } = await supabase.from('todos').insert([newTodo]);
      if (error) throw error;
      
      setInputValue('');
      setProjectValue('');
      setDueDateValue('');
      setDueTimeValue('');
      setCurrentPriority('medium');
    } catch (error) {
      console.error('Error adding todo:', error);
    }
  };

  const toggleTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;

    if (!todo.completed) {
      setCompletingTodoId(id);
      setSpendAmount('0');
    } else {
      try {
        const { error } = await supabase
          .from('todos')
          .update({ completed: false, amount: 0, completedAt: null })
          .eq('id', id);
        if (error) throw error;
      } catch (error) {
        console.error('Error toggling todo:', error);
      }
    }
  };

  const confirmCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingTodoId) return;

    try {
      const { error } = await supabase
        .from('todos')
        .update({ 
          completed: true, 
          amount: parseFloat(spendAmount) || 0, 
          completedAt: new Date().toISOString() 
        })
        .eq('id', completingTodoId);
      
      if (error) throw error;
      
      setCompletingTodoId(null);
      setSpendAmount('0');
    } catch (error) {
      console.error('Error confirming completion:', error);
    }
  };

  const deleteTodo = async (id: string) => {
    try {
      const { error } = await supabase.from('todos').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      console.error('Error deleting todo:', error);
    }
  };

  const startEditing = (todo: Todo) => {
    setEditingId(todo.id);
    setEditingText(todo.text);
  };

  const saveEdit = async (id: string) => {
    if (!editingText.trim()) {
      cancelEdit();
      return;
    }
    try {
      const { error } = await supabase
        .from('todos')
        .update({ text: editingText.trim() })
        .eq('id', id);
      if (error) throw error;
      setEditingId(null);
    } catch (error) {
      console.error('Error saving edit:', error);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText('');
  };

  // Subtask Handlers
  const addSubtask = async (todoId: string) => {
    const text = subtaskInputs[todoId];
    if (!text || !text.trim()) return;

    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;

    const newSubtask: Subtask = {
      id: crypto.randomUUID(),
      text: text.trim(),
      completed: false
    };

    try {
      const { error } = await supabase
        .from('todos')
        .update({ subtasks: [...(todo.subtasks || []), newSubtask] })
        .eq('id', todoId);
      
      if (error) throw error;
      setSubtaskInputs(prev => ({ ...prev, [todoId]: '' }));
    } catch (error) {
      console.error('Error adding subtask:', error);
    }
  };

  const toggleSubtask = async (todoId: string, subtaskId: string) => {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;

    const updatedSubtasks = todo.subtasks?.map(st => 
      st.id === subtaskId ? { ...st, completed: !st.completed } : st
    );

    try {
      const { error } = await supabase
        .from('todos')
        .update({ subtasks: updatedSubtasks })
        .eq('id', todoId);
      if (error) throw error;
    } catch (error) {
      console.error('Error toggling subtask:', error);
    }
  };

  const deleteSubtask = async (todoId: string, subtaskId: string) => {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;

    const updatedSubtasks = todo.subtasks?.filter(st => st.id !== subtaskId);

    try {
      const { error } = await supabase
        .from('todos')
        .update({ subtasks: updatedSubtasks })
        .eq('id', todoId);
      if (error) throw error;
    } catch (error) {
      console.error('Error deleting subtask:', error);
    }
  };

  const filteredTodos = todos.filter(todo => {
    if (filter === 'active') return !todo.completed;
    if (filter === 'completed') return todo.completed;
    return true;
  });

  const completedCount = todos.filter(t => t.completed).length;
  const activeCount = todos.length - completedCount;

  // Monthly spending calculation
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const currentMonthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date());

  const monthlyCompletedTodos = todos.filter(t => {
    const date = new Date(t.createdAt);
    return t.completed && date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  });

  const monthlySpending = monthlyCompletedTodos.reduce((sum, t) => sum + (t.amount || 0), 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const getTimeRemaining = (dueDate: string | null) => {
    if (!dueDate) return null;
    const now = new Date();
    const due = new Date(dueDate);
    const diff = due.getTime() - now.getTime();
    
    if (diff < 0) return { text: 'Overdue', isOverdue: true };
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return { text: `${days}d ${hours}h left`, isOverdue: false };
    if (hours > 0) return { text: `${hours}h ${minutes}m left`, isOverdue: false };
    return { text: `${minutes}m left`, isOverdue: false };
  };

  const exportToExcel = () => {
    if (monthlyCompletedTodos.length === 0) {
      alert("No completed tasks for this month to export.");
      return;
    }

    // CSV Header
    const headers = ["Date", "Task", "Priority", "Due Date", "Amount Spent (INR)"];
    
    // CSV Rows
    const rows = monthlyCompletedTodos.map(todo => [
      new Date(todo.createdAt).toLocaleDateString('en-IN'),
      todo.text,
      todo.priority.toUpperCase(),
      todo.dueDate ? new Date(todo.dueDate).toLocaleString('en-IN') : "N/A",
      todo.amount?.toFixed(2) || "0.00"
    ]);

    // Combine into CSV string
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `TaskFlow_Report_${currentMonthName}_${currentYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalTasks = todos.length;
  const completedTasks = todos.filter(t => t.completed).length;
  const pendingTasks = totalTasks - completedTasks;
  const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const tasksCompletedToday = todos.filter(t => {
    if (!t.completed || !t.completedAt) return false;
    const today = new Date();
    const completedDate = new Date(t.completedAt);
    return today.toDateString() === completedDate.toDateString();
  }).length;

  const getLast7Days = () => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({
        date: d.toDateString(),
        label: d.toLocaleDateString('en-IN', { weekday: 'short' }),
        count: 0
      });
    }
    return days;
  };

  const weeklyData = getLast7Days().map(day => {
    const count = todos.filter(t => {
      if (!t.completed || !t.completedAt) return false;
      return new Date(t.completedAt).toDateString() === day.date;
    }).length;
    return { ...day, count };
  });

  const maxWeeklyCount = Math.max(...weeklyData.map(d => d.count), 1);

  const priorityConfig = {
    high: { color: 'text-rose-500', bg: 'bg-rose-50', border: 'border-rose-100', icon: ChevronUp, label: 'High' },
    medium: { color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-100', icon: Minus, label: 'Medium' },
    low: { color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-100', icon: ChevronDown, label: 'Low' },
  };

  if (!session) {
    return <Auth />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100">
      <div className="max-w-2xl mx-auto px-4 py-12 md:py-20">
        {/* User Info & Logout */}
        <div className="flex items-center justify-between mb-8 px-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
              <User className="w-6 h-6" />
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Logged in as</p>
              <p className="text-sm font-semibold text-slate-700 truncate max-w-[150px]">{session.user.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all font-semibold text-sm"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>

        {/* Header */}
        <header className="mb-12 text-center">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-3 mb-4"
          >
            <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-200">
              <ListTodo className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900">TaskFlow</h1>
          </motion.div>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-slate-500 text-lg"
          >
            Organize your day, one task at a time.
          </motion.p>
        </header>

        {/* Monthly Spending Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-indigo-600 text-white p-6 rounded-3xl shadow-xl shadow-indigo-100 mb-8 flex items-center justify-between overflow-hidden relative"
        >
          <div className="relative z-10">
            <p className="text-indigo-100 text-sm font-medium mb-1 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Monthly Spending ({currentMonthName})
            </p>
            <h2 className="text-3xl font-bold tracking-tight mb-4">
              {formatCurrency(monthlySpending)}
            </h2>
            <button
              onClick={exportToExcel}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 transition-colors rounded-xl text-sm font-semibold backdrop-blur-sm"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Download Report (CSV)
            </button>
          </div>
          <div className="p-4 bg-white/10 rounded-2xl relative z-10">
            <span className="text-4xl font-bold opacity-50">₹</span>
          </div>
          {/* Decorative background element */}
          <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-white/5 rounded-full blur-2xl" />
        </motion.div>

        {/* Productivity Dashboard */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8"
        >
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-500" />
                Overall Progress
              </h3>
              <span className="text-2xl font-bold text-slate-900">{progressPercentage}%</span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden mb-4">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${progressPercentage}%` }}
                className="h-full bg-indigo-500 rounded-full"
              />
            </div>
            <div className="flex justify-between text-xs font-medium">
              <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                {completedTasks} Completed
              </span>
              <span className="text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
                {pendingTasks} Pending
              </span>
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-500" />
                Weekly Productivity
              </h3>
              <div className="text-right">
                <span className="text-2xl font-bold text-slate-900">{tasksCompletedToday}</span>
                <p className="text-[10px] text-slate-400 font-bold uppercase">Today</p>
              </div>
            </div>
            <div className="flex items-end justify-between h-16 gap-1">
              {weeklyData.map((day, idx) => (
                <div key={idx} className="flex flex-col items-center gap-1 flex-1">
                  <motion.div 
                    initial={{ height: 0 }}
                    animate={{ height: `${(day.count / maxWeeklyCount) * 100}%` }}
                    className={`w-full rounded-t-md transition-all ${
                      day.date === new Date().toDateString() ? 'bg-emerald-500' : 'bg-slate-200'
                    }`}
                    title={`${day.count} tasks`}
                  />
                  <span className="text-[10px] text-slate-400 font-bold">{day.label}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Input Section */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm mb-8"
        >
          <form onSubmit={addTodo} className="space-y-4">
            <div className="relative">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="What needs to be done?"
                className="w-full pl-6 pr-16 py-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-lg"
              />
              <button
                type="submit"
                className="absolute right-2 top-2 bottom-2 px-4 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center shadow-md shadow-indigo-200"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-400 ml-2">Project:</span>
                <input
                  type="text"
                  value={projectValue}
                  onChange={(e) => setProjectValue(e.target.value)}
                  placeholder="Project name (optional)"
                  className="px-3 py-1.5 bg-slate-50 border-2 border-transparent rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-slate-600 w-40"
                />
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-400">Priority:</span>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high'] as Priority[]).map((p) => {
                    const config = priorityConfig[p];
                    const Icon = config.icon;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCurrentPriority(p)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border-2 ${
                          currentPriority === p 
                            ? `${config.bg} ${config.color} ${config.border}` 
                            : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {config.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-400">Due:</span>
                <div className="flex gap-2">
                  <div className="relative">
                    <input
                      type="date"
                      value={dueDateValue}
                      onChange={(e) => setDueDateValue(e.target.value)}
                      className="pl-9 pr-4 py-1.5 bg-slate-50 border-2 border-transparent rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-slate-600 appearance-none"
                    />
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  </div>
                  <div className="relative">
                    <input
                      type="time"
                      value={dueTimeValue}
                      onChange={(e) => setDueTimeValue(e.target.value)}
                      className="pl-9 pr-4 py-1.5 bg-slate-50 border-2 border-transparent rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-slate-600 appearance-none"
                    />
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>
          </form>
        </motion.div>

        {/* Controls & Stats */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8 p-4 bg-white rounded-2xl border border-slate-100 shadow-sm"
        >
          <div className="flex gap-1 bg-slate-50 p-1 rounded-xl">
            {(['all', 'active', 'completed'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  filter === f 
                    ? 'bg-white text-indigo-600 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          
          <div className="flex items-center gap-6 text-sm font-medium text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
              {activeCount} Active
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              {completedCount} Done
            </span>
          </div>
        </motion.div>

        {/* Todo List */}
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredTodos.length > 0 ? (
              filteredTodos.map((todo) => {
                const config = priorityConfig[todo.priority];
                const PriorityIcon = config.icon;
                
                return (
                  <motion.div
                    key={todo.id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`group flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                      todo.completed 
                        ? 'bg-slate-50/50 border-slate-100' 
                        : 'bg-white border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-100'
                    }`}
                  >
                    <button
                      onClick={() => toggleTodo(todo.id)}
                      className={`flex-shrink-0 transition-colors ${
                        todo.completed ? 'text-emerald-500' : 'text-slate-300 hover:text-indigo-400'
                      }`}
                    >
                      {todo.completed ? (
                        <CheckCircle2 className="w-6 h-6" />
                      ) : (
                        <Circle className="w-6 h-6" />
                      )}
                    </button>
                    
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {editingId === todo.id ? (
                          <div className="flex items-center gap-2 w-full">
                            <input
                              autoFocus
                              type="text"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit(todo.id);
                                if (e.key === 'Escape') cancelEdit();
                              }}
                              className="w-full px-2 py-1 bg-slate-50 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-lg text-slate-700"
                            />
                            <button
                              onClick={() => saveEdit(todo.id)}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <p className={`text-lg transition-all truncate ${
                              todo.completed ? 'text-slate-400 line-through' : 'text-slate-700'
                            }`}>
                              {todo.text}
                            </p>
                            {!todo.completed && (
                              <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${config.bg} ${config.color} border ${config.border}`}>
                                <PriorityIcon className="w-2.5 h-2.5" />
                                {todo.priority}
                              </span>
                            )}
                            {todo.completed && todo.amount && todo.amount > 0 && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">
                                ₹{todo.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </span>
                            )}
                            {todo.project && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">
                            {todo.project}
                          </span>
                        )}
                        {todo.subtasks && todo.subtasks.length > 0 && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                {todo.subtasks.filter(st => st.completed).length}/{todo.subtasks.length} Subtasks
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3" />
                          {new Date(todo.createdAt).toLocaleDateString()}
                        </div>
                        {todo.dueDate && (
                          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border transition-all ${
                            getTimeRemaining(todo.dueDate)?.isOverdue && !todo.completed
                              ? 'bg-rose-50 text-rose-500 border-rose-100 animate-pulse'
                              : 'bg-slate-50 text-slate-500 border-slate-100'
                          }`}>
                            <Clock className="w-3 h-3" />
                            <span className="font-medium">
                              {getTimeRemaining(todo.dueDate)?.text}
                            </span>
                            <span className="opacity-60 text-[10px]">
                              ({new Date(todo.dueDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })})
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Subtasks Section */}
                      {!todo.completed && (
                        <div className="mt-3 space-y-2">
                          <AnimatePresence>
                            {todo.subtasks?.map((subtask) => (
                              <motion.div
                                key={subtask.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 10 }}
                                className="flex items-center gap-2 group/sub"
                              >
                                <button
                                  onClick={() => toggleSubtask(todo.id, subtask.id)}
                                  className={`transition-colors ${subtask.completed ? 'text-emerald-500' : 'text-slate-300 hover:text-slate-400'}`}
                                >
                                  {subtask.completed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                                </button>
                                <span className={`text-sm flex-grow ${subtask.completed ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
                                  {subtask.text}
                                </span>
                                <button
                                  onClick={() => deleteSubtask(todo.id, subtask.id)}
                                  className="opacity-0 group-hover/sub:opacity-100 p-1 text-slate-300 hover:text-rose-500 transition-all"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </motion.div>
                            ))}
                          </AnimatePresence>
                          
                          <div className="flex items-center gap-2 mt-2">
                            <CornerDownRight className="w-4 h-4 text-slate-300" />
                            <input
                              type="text"
                              value={subtaskInputs[todo.id] || ''}
                              onChange={(e) => setSubtaskInputs(prev => ({ ...prev, [todo.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && addSubtask(todo.id)}
                              placeholder="Add a subtask..."
                              className="flex-grow text-sm bg-transparent border-b border-slate-100 focus:border-indigo-300 focus:outline-none py-1 text-slate-600 placeholder:text-slate-300"
                            />
                            {subtaskInputs[todo.id] && (
                              <button
                                onClick={() => addSubtask(todo.id)}
                                className="p-1 text-indigo-500 hover:bg-indigo-50 rounded-md transition-colors"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      {!todo.completed && editingId !== todo.id && (
                        <button
                          onClick={() => startEditing(todo)}
                          className="p-2 text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-all"
                        >
                          <Pencil className="w-5 h-5" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteTodo(todo.id)}
                        className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                      {!todo.completed && (
                        <button
                          onClick={() => findNearbyStores(todo)}
                          disabled={isSearching && searchingTodoId === todo.id}
                          className="p-2 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all disabled:opacity-50"
                          title="Find nearby places to buy this"
                        >
                          {isSearching && searchingTodoId === todo.id ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <MapPin className="w-5 h-5" />
                          )}
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-100"
              >
                <div className="inline-flex p-4 bg-slate-50 rounded-full mb-4">
                  <Filter className="w-8 h-8 text-slate-300" />
                </div>
                <h3 className="text-lg font-medium text-slate-900">No tasks found</h3>
                <p className="text-slate-500">
                  {filter === 'all' 
                    ? "Time to start something new!" 
                    : `No ${filter} tasks to show.`}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Nearby Places Modal */}
        <AnimatePresence>
          {mapResults && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-white w-full max-w-lg rounded-3xl p-8 shadow-2xl border border-slate-100"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-indigo-100 rounded-2xl text-indigo-600">
                      <MapPin className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Nearby Places</h3>
                      <p className="text-slate-500 text-sm">Suggested stores for your task</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setMapResults(null)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                <div className="space-y-6">
                  <div className="prose prose-slate max-w-none">
                    <p className="text-slate-600 leading-relaxed">
                      {mapResults.text}
                    </p>
                  </div>

                  {mapResults.links.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Locations on Maps</h4>
                      <div className="grid gap-2">
                        {mapResults.links.map((link, idx) => (
                          <a
                            key={idx}
                            href={link.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl hover:border-indigo-200 hover:bg-indigo-50/30 transition-all group"
                          >
                            <span className="font-medium text-slate-700 group-hover:text-indigo-600">{link.title}</span>
                            <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-indigo-500" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                <button
                  onClick={() => setMapResults(null)}
                  className="w-full mt-8 py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                >
                  Got it
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Completion Amount Modal */}
        <AnimatePresence>
          {completingTodoId && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-white w-full max-w-sm rounded-3xl p-8 shadow-2xl border border-slate-100"
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-emerald-100 rounded-2xl">
                    <span className="text-xl font-bold text-emerald-600">₹</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Task Completed!</h3>
                    <p className="text-slate-500 text-sm">Amount spent in Rupees?</p>
                  </div>
                </div>
                
                <form onSubmit={confirmCompletion} className="space-y-6">
                  <div className="relative">
                    <input
                      autoFocus
                      type="number"
                      step="0.01"
                      value={spendAmount}
                      onChange={(e) => setSpendAmount(e.target.value)}
                      className="w-full pl-10 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-2xl font-bold text-slate-700"
                      placeholder="0.00"
                    />
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-400">₹</span>
                  </div>
                  
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setCompletingTodoId(null)}
                      className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-100"
                    >
                      Confirm
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Alarm Overlay */}
        <AnimatePresence>
          {activeReminder && (
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4"
            >
              <div className="bg-indigo-600 text-white p-6 rounded-3xl shadow-2xl shadow-indigo-200 border border-indigo-500 flex items-center gap-4">
                <div className="p-3 bg-white/20 rounded-2xl animate-bounce">
                  <BellRing className="w-8 h-8 text-white" />
                </div>
                <div className="flex-grow">
                  <h4 className="font-bold text-lg">Task Reminder!</h4>
                  <p className="text-indigo-100 line-clamp-1">"{activeReminder.text}" is due in 5 minutes.</p>
                </div>
                <button
                  onClick={() => setActiveReminder(null)}
                  className="px-4 py-2 bg-white text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition-colors shadow-sm"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
