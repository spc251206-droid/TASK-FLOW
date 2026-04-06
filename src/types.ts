export type Priority = 'low' | 'medium' | 'high';

export interface Subtask {
  id: string;
  text: string;
  completed: boolean;
}

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
  priority: Priority;
  dueDate?: string | null; // ISO string with date and time
  reminderTriggered?: boolean;
  amount?: number;
  subtasks?: Subtask[];
  project?: string;
  completedAt?: number;
}

export type FilterType = 'all' | 'active' | 'completed';
