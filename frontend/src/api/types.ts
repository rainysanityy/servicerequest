export type Role = 'user' | 'first-level' | 'admin';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type ColorRole = 'neutral' | 'primary' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'error';

export interface Me {
  sub: string;
  username: string;
  name: string;
  email: string | null;
  roles: Role[];
}

export interface FieldOption { value: string; label: string }
export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'email' | 'number' | 'date' | 'checkbox' | 'select';
  required?: boolean;
  help?: string;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  options?: FieldOption[];
}
export interface FormSchema { fields: FieldDef[] }

export interface CatalogItem {
  id: string;
  category_id: string;
  name: string;
  description: string;
  requires_approval: boolean;
  popular: boolean;
}
export interface Category {
  id: string;
  name: string;
  description: string;
  icon: string;
  items: CatalogItem[];
}
export interface CatalogItemDetail extends CatalogItem {
  category_name: string;
  form_schema: FormSchema;
  default_priority: Priority;
}

export interface TicketListItem {
  id: string;
  number: string;
  title: string;
  status: string;
  status_label: string;
  status_color: ColorRole;
  is_final: boolean;
  priority: Priority;
  category_id: string;
  category_name: string;
  item_name: string | null;
  requester_sub: string;
  requester_name: string;
  assignee_sub: string | null;
  assignee_name: string | null;
  response_due_at: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  version: number;
  overdue: boolean;
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export interface Comment {
  id: string;
  body: string;
  internal: boolean;
  author_role: string;
  author_name: string;
  created_at: string;
  mine: boolean;
}
export interface TicketEvent {
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
  actor_name: string | null;
}
export interface TicketDetail {
  ticket: TicketListItem & {
    description: string;
    form_data: Record<string, unknown>;
    form_schema: FormSchema | null;
    first_response_at: string | null;
    anonymized: boolean;
    requester_email?: string | null;
  };
  comments: Comment[];
  events: TicketEvent[];
  allowedTransitions: { code: string; label: string }[];
  canComment: boolean;
  canInternalComment: boolean;
}

export interface Agent { sub: string; display_name: string; email: string | null }
export interface Solution { id: string; category_id: string | null; title: string; body: string; active?: boolean }
