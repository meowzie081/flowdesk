export const helpReasons = { file: 'Жду файл', access: 'Нужен доступ', decision: 'Нужно решение', other: 'Другое' } as const;
export type HelpRequest = {
    id: string;
    task_id: string;
    requester_id: string;
    helper_id: string;
    reason: keyof typeof helpReasons;
    detail: string;
    status: 'open' | 'answered' | 'resolved' | 'cancelled';
    response: string;
    created_at: string;
    task_title?: string;
    requester_name?: string;
    helper_name?: string;
};
export type DayTask = {
    id: string;
    title: string;
    priority: 'low' | 'medium' | 'high';
    due_date: string | null;
    blocked_reason: string | null;
    planned: boolean;
};
export function localDay(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function todayTasks(tasks: DayTask[], day: string) { const priority = { high: 0, medium: 1, low: 2 }; return tasks.filter(t => t.planned || !!t.due_date && t.due_date <= day).sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || priority[a.priority] - priority[b.priority] || a.id.localeCompare(b.id)); }
export function resumeKey(dep: string, user: string) { return `flowdesk:resume:${user}:${dep}`; }
