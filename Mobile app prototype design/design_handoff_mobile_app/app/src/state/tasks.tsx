import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

import * as portal from '../api/portal';
import { StaffTask } from '../data/types';

type TasksState = {
  tasks: StaffTask[];
  /** How many are still open — the number in the Today header. */
  openCount: number;
  toggle: (id: string) => void;
};

const TasksContext = createContext<TasksState | null>(null);

export function useTasks() {
  const value = useContext(TasksContext);
  if (!value) throw new Error('useTasks must be used inside <TasksProvider>');
  return value;
}

export function TasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<StaffTask[]>(() => portal.loadTasks());

  const toggle = useCallback((id: string) => {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)),
    );
  }, []);

  const value = useMemo(
    () => ({ tasks, openCount: tasks.filter((task) => !task.done).length, toggle }),
    [tasks, toggle],
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}
